import os
import re
import json
import uuid
import shutil
import asyncio
import platform
from typing import Any, Dict, List, Optional, Union
from PyPDF2 import PdfMerger
import httpx
import pandas as pd
from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import JSONResponse
from ingestion import ingest_from_upload
from fastapi import UploadFile, File, Form
import tempfile
# from supabase import create_client, Client
from utils.supabase_client import supabase

# ✅ Gemini v1 SDK
from google import genai  # type: ignore


# CloudConvert setup - lazy init to avoid startup errors
cloudConvert = None

def get_cloudconvert_client():
    """Configure and return cloudconvert module if API key is set."""
    api_key = os.getenv("CLOUDCONVERT_API_KEY", "")
    if not api_key:
        return None

    try:
        import cloudconvert
        cloudconvert.configure(api_key=api_key, sandbox=False)
        return cloudconvert
    except Exception as e:
        print(f"[openai_upload] CloudConvert import/init failed: {e}")
        return None

router = APIRouter()

# -------------------------
# Supabase client (same role as "../../../lib/supabase")
# -------------------------
# supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
# supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY", "")

# print(supabase_url)
# if not supabase_url:
#     print("[openai_upload] ERROR: NEXT_PUBLIC_SUPABASE_URL not set!")
# if not supabase_key:
#     print("[openai_upload] ERROR: Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_ANON_KEY is set!")
# else:
#     key_preview = f"{supabase_key[:20]}...{supabase_key[-10:]}" if len(supabase_key) > 30 else "***"
#     print(f"[openai_upload] Using Supabase key: {key_preview}")

# supabase: Client = create_client(supabase_url, supabase_key)

# -------------------------
# CloudConvert setup
# -------------------------
async def convertDocToPdf(inputPath: str, outputPath: str):
    cloudconvert = get_cloudconvert_client()
    if not cloudconvert:
        raise Exception("CloudConvert client not initialized. Set CLOUDCONVERT_API_KEY environment variable.")

    # Create a job with upload, convert, and export tasks
    job = cloudconvert.Job.create(payload={
        "tasks": {
            "upload-file": {
                "operation": "import/upload"
            },
            "convert-file": {
                "operation": "convert",
                "input": "upload-file",
                "output_format": "pdf"
            },
            "export-file": {
                "operation": "export/url",
                "input": "convert-file"
            }
        }
    })

    # Find the upload task and upload the file
    upload_task_id = job['tasks'][0]['id']
    upload_task = cloudconvert.Task.find(id=upload_task_id)

    with open(inputPath, "rb") as f:
        cloudconvert.Task.upload(file_name=inputPath, task=upload_task)

    # Wait for the job to complete
    completed_job = cloudconvert.Job.wait(id=job['id'])

    # Get the export task and download the result
    export_task = None
    for task in completed_job.get("tasks", []):
        if task.get("name") == "export-file":
            export_task = task
            break

    if not export_task:
        raise Exception("CloudConvert export task not found.")

    result_file = export_task.get("result", {}).get("files", [])
    if not result_file:
        raise Exception("CloudConvert export URL missing.")

    file_url = result_file[0].get("url")
    if not file_url:
        raise Exception("CloudConvert file URL is empty.")

    print(f"[convertDocToPdf] Converted PDF URL: {file_url}")

    # Download the PDF
    async with httpx.AsyncClient() as client:
        response = await client.get(file_url)
        response.raise_for_status()
        buffer = response.content

    with open(outputPath, "wb") as out:
        out.write(buffer)


# -------------------------
# Gemini setup (replaces OpenAI Assistants file upload)
# -------------------------
# ✅ No other logic changes
# ✅ Uses Gemini Files API (v1) SDK
if not os.getenv("GEMINI_API_KEY"):
    print("[openai_upload] CRITICAL: GEMINI_API_KEY is not set in environment variables!")

gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or "")

SOURCE_FACT_INDEX_PROMPT = """
You are extracting FACTS from a single source document.

Your task:
- Identify ONLY facts explicitly stated in the document.
- Facts must be domain-specific and concrete.
- Do NOT infer, generalize, or teach.

FACT TYPES TO EXTRACT:
- Core domain concepts explicitly defined
- Named frameworks, models, or methods
- Rules, constraints, or principles
- Named risks or limitations
- Explicitly described outcomes or goals

DO NOT INCLUDE:
- Analogies
- Examples not present in the text
- Organizational theory unless explicitly mentioned
- Cross-domain interpretations

OUTPUT FORMAT (JSON ONLY):

{
  "source_facts": [
    {
      "id": "F1",
      "fact": "<verbatim or near-verbatim statement>",
      "type": "concept | framework | risk | rule | goal"
    }
  ]
}

If something is not clearly stated in the document, do NOT include it.
"""

INSTRUCTION_PROMPT = """
You are an expert instructional designer analyzing a SINGLE provided learning asset.

Your task is to decompose the asset into learning modules that are STRICTLY AND EXCLUSIVELY
grounded in the source content.

Treat extracted text, headings, tables, product names, timelines, numeric limits, and
regulatory references as authoritative source material.

CRITICAL: You must first extract an internal SOURCE FACT INDEX and then generate
learning modules using ONLY those facts.

-------------------------------------------------
STEP 1 — SOURCE FACT INDEX (INTERNAL, NON-OUTPUT)
-------------------------------------------------

Before creating modules, internally extract a list of facts from the document.

Rules for SOURCE FACT INDEX:
- Include ONLY facts explicitly stated in the document
- No inference, no teaching, no cross-domain reasoning
- No organizational theory unless explicitly present
- No examples unless present in the document

Fact types allowed:
- Defined concepts
- Named frameworks, models, or methods
- Explicit risks or limitations
- Explicit goals or outcomes
- Explicit metrics or constraints

If a fact is not clearly stated in the document, it MUST NOT appear later.

-------------------------------------------------
NON-NEGOTIABLE GROUNDING RULES
-------------------------------------------------

1. FACT-LOCK
- Every module title, topic, and objective MUST map to at least one source fact.
- If a concept could exist without this document, DO NOT include it.

2. NO CROSS-DOMAIN LEAKAGE
- Do NOT introduce organizational theory, productivity models, security metrics,
  system design concepts, or management frameworks unless explicitly named
  in the document.

3. NO GENERIC KNOWLEDGE
- Do NOT “educate beyond the document” by adding external frameworks.
- Elaboration is allowed ONLY to clarify document facts.

4. VERBATIM ANCHORING
- Reuse document terminology exactly (framework names, prompt patterns, risks).
- Do not rename or abstract them.

5. COMPANY CONTEXT ENFORCEMENT (CRITICAL)

If the source document explicitly names:
- a company,
- brand,
- organization,
- founders,
- locations,
- mission statements,
- strategic positioning,
- product portfolios tied to the organization,
- products

THEN:

- The company name MUST appear explicitly in module titles, topics, or explanatory text where relevant.
- Use direct, natural phrasing such as:
  “At <Company Name>…”
  “For sales representatives at <Company Name>…”
  “<Company Name>’s mission emphasizes…”

- Do NOT anonymize, generalize, or abstract company identity.
- This is a company onboarding asset, not a generic industry guide.

If the document is company-specific, the learning modules MUST be company-specific.

-------------------------------------------------
PROCESSING STEPS
-------------------------------------------------
1. Identify ONE overall learning goal using document language.
2. Segment modules strictly along document sections.
3. Each module must cover ONE dominant document idea.
4. Preserve document order.

-------------------------------------------------
OUTPUT FORMAT (MARKDOWN ONLY)
-------------------------------------------------

#### Module [#]: [Source-anchored title]

**Topics:**
- Topic using exact or near-exact source terminology
- Topic using exact or near-exact source terminology

**Objectives:**
- Learners will [action] [specific concept, product, rule, or process from source]
- Learners will [action] [specific concept, product, rule, or process from source]

-------------------------------------------------
SOURCE GAP HANDLING
-------------------------------------------------
If the source does NOT explicitly define something:
- List a clarifying question
- Do NOT invent or generalize

Respond ONLY in Markdown.
"""


# -------------------------
# Type guard equivalent
# -------------------------
def isTextContentBlock(c: Any) -> bool:
    if not c or not isinstance(c, dict):
        return False
    if c.get("type") != "text":
        return False
    text = c.get("text")
    if isinstance(text, str):
        return True
    if isinstance(text, dict) and ("value" in text or len(text.keys()) == 0):
        return True
    return False


# -------------------------
# processAndStoreResults
# -------------------------

async def processAndStoreResults(moduleId: str, message: str):
    print(f"[processAndStoreResults] Starting for moduleId: {moduleId}")
    print(f"[processAndStoreResults] Message length: {len(message) if message else 0}")

    if not message:
        print("[processAndStoreResults] Received empty message, skipping parsing.")
        return {"error": "Empty message from GPT"}

    ai_modules: List[Any] = []
    ai_topics: List[str] = []
    ai_objectives: List[str] = []

    try:
        modulesSection = message

        modulesStart = re.search(r"(Learning Modules and Structure|Modules and Topics|###\s*Modules)", modulesSection, re.I)
        if modulesStart:
            modulesSection = modulesSection[modulesStart.start():]

        # Enhanced cutoff to handle various footer sections that aren't modules
        cutoffRegex = re.search(
            r"(Module Splitting Checks|Sequencing Rationale|Module Independence|Additional Clarifying Questions|Clarifying Questions|###\s*Sequencing|###\s*Clarifying|\*\*Module Splitting Checks)", 
            modulesSection, 
            re.I
        )
        if cutoffRegex:
            modulesSection = modulesSection[:cutoffRegex.start()]

        # Updated regex to handle both ### and #### module headers
        moduleRegex = re.compile(
            r"(#{3,4}\s*Module\s*\d+:|Module\s*\d+:|\d+\.\s*\*\*[^*]+\*\*)([\s\S]*?)(?=(#{3,4}\s*Module\s*\d+:|Module\s*\d+:|\d+\.\s*\*\*[^*]+\*\*|$))",
            re.I
        )

        moduleMatches = []
        for m in moduleRegex.finditer(modulesSection):
            moduleMatches.append({
                "header": m.group(1).strip(),
                "content": m.group(2).strip()
            })

        if len(moduleMatches) == 0:
            # Fallback regex also handles both ### and #### formats
            fallbackRegex = re.compile(
                r"(#{3,4}\s*Module\s*\d+:|Module\s*\d+:)([\s\S]*?)(?=(#{3,4}\s*Module\s*\d+:|Module\s*\d+:|$))",
                re.I
            )
            for m in fallbackRegex.finditer(message):
                moduleMatches.append({
                    "header": m.group(1).strip(),
                    "content": m.group(2).strip()
                })

        print(f"[processAndStoreResults] Found {len(moduleMatches)} module matches.")
        
        for i, moduleData in enumerate(moduleMatches):
            block = moduleData["content"]
            
            print(f"[processAndStoreResults] Processing module {i + 1}/{len(moduleMatches)}")

            # titleMatch = re.search(r"^(?:\*\*|###)?\s*([A-Za-z0-9 .\-]+)(?:\*\*|:)?", block)
            # title = titleMatch.group(1).strip() if titleMatch else f"Module {i + 1}"

            titleMatch = re.search(r"^(?:\*\*|###|####)?\s*Module\s*\d+[:\-]\s*(.*)", block, re.I)
            if titleMatch:
                title = titleMatch.group(1).strip().strip('*').strip(':').strip('"')
            else:
                # Fallback: take the first line if regex fails
                first_line = block.split('\n')[0]
                title = re.sub(r"^(?:\*\*|###|####)?\s*Module\s*\d+[:\-]\s*", "", first_line).strip().strip('*')

            
            print(f"[processAndStoreResults] Module title: {title}")

            topics: List[str] = []
            objectives: List[str] = []

            # Extract topics section more robustly
            topicsSection = re.search(r"\*\*Topics?:\*\*\s*([\s\S]*?)(?=\*\*Objectives?:\*\*|####|$)", block, re.I)
            if not topicsSection:
                topicsSection = re.search(r"Topics?:\s*([\s\S]*?)(?=Objectives?:|####|$)", block, re.I)
            
            if topicsSection and topicsSection.group(1):
                topic_lines = [
                    re.sub(r"^\*\*?Topic:?\*\*?", "", re.sub(r"^[-*•]\s*", "", line)).strip()
                    for line in topicsSection.group(1).split('\n')
                    if line.strip() and re.match(r"^[-*•]\s", line.strip())
                ]
                topics = [t for t in topic_lines if t and len(t) > 3]
                print(f"[processAndStoreResults] Extracted {len(topics)} topics from module {i + 1}")

            # Extract objectives section more robustly
            objectivesSection = re.search(r"\*\*Objectives?:\*\*\s*([\s\S]*?)(?=####|$)", block, re.I)
            if not objectivesSection:
                objectivesSection = re.search(r"Objectives?:\s*([\s\S]*?)(?=####|$)", block, re.I)
            
            if objectivesSection and objectivesSection.group(1):
                obj_lines = [
                    re.sub(r"^\*\*?Objective:?\*\*?", "", re.sub(r"^[-*•]\s*", "", line)).strip()
                    for line in objectivesSection.group(1).split('\n')
                    if line.strip() and re.match(r"^[-*•]\s", line.strip())
                ]
                objectives = [o for o in obj_lines if o and len(o) > 5]
                print(f"[processAndStoreResults] Extracted {len(objectives)} objectives from module {i + 1}")

            # Fallback: extract any bullet points if primary extraction failed
            if len(topics) == 0:
                print(f"[processAndStoreResults] No topics found with primary regex, trying fallback for module {i + 1}")
                all_bullets = [
                    re.sub(r"^[-*•]\s*", "", line).strip()
                    for line in block.split('\n')
                    if re.match(r"^[-*•]\s", line.strip()) and not re.search(r"objective|learner", line, re.I)
                ]
                topics = [t for t in all_bullets if t and len(t) > 3][:10]  # Limit to first 10

            if len(objectives) == 0:
                print(f"[processAndStoreResults] No objectives found with primary regex, trying fallback for module {i + 1}")
                obj_bullets = [
                    re.sub(r"^[-*•]\s*", "", line).strip()
                    for line in block.split('\n')
                    if re.match(r"^[-*•]\s", line.strip()) and re.search(r"learner|will|understand|identify|apply", line, re.I)
                ]
                objectives = [o for o in obj_bullets if o and len(o) > 5][:10]  # Limit to first 10

            print(f"[processAndStoreResults] Final counts for module {i + 1}: topics={len(topics)}, objectives={len(objectives)}")
            
            # Stricter validation: require BOTH topics AND objectives
            if topics and objectives and len(topics) >= 1 and len(objectives) >= 1:
                ai_modules.append({"title": title, "topics": topics, "objectives": objectives})
                ai_topics.extend(topics)
                ai_objectives.extend(objectives)
            else:
                print(f"[processAndStoreResults] ⚠️ WARNING: Module {i + 1} ({title}) rejected - topics={len(topics)}, objectives={len(objectives)}")
                print(f"[processAndStoreResults] Module content preview: {block[:200]}...")
        
        print(f"[processAndStoreResults] Total accumulated: {len(ai_modules)} modules, {len(ai_topics)} topics, {len(ai_objectives)} objectives")

    except Exception as parseError:
        print("[processAndStoreResults] Error during parsing:", parseError)

    print(f"[processAndStoreResults] Attempting to update database for moduleId: {moduleId}")

    # Validate that we have the required data before attempting database operation
    if not message or len(message.strip()) == 0:
        error_msg = f"[processAndStoreResults] ERROR: gpt_summary is empty or missing for moduleId: {moduleId}"
        print(error_msg)
        return {"error": "gpt_summary is empty", "moduleId": moduleId}

    if not ai_modules or len(ai_modules) == 0:
        error_msg = f"[processAndStoreResults] ERROR: ai_modules is empty for moduleId: {moduleId}"
        print(error_msg)

        supabase.table("training_modules").update({
            "processing_status": "failed"
        }).eq("module_id", moduleId).execute()

        return {"error": "ai_modules is empty - parsing may have failed", "moduleId": moduleId}

    if not ai_topics or len(ai_topics) == 0:
        error_msg = f"[processAndStoreResults] ERROR: ai_topics is empty for moduleId: {moduleId}"
        print(error_msg)
        return {"error": "ai_topics is empty - parsing may have failed", "moduleId": moduleId}

    if not ai_objectives or len(ai_objectives) == 0:
        error_msg = f"[processAndStoreResults] ERROR: ai_objectives is empty for moduleId: {moduleId}"
        print(error_msg)
        return {"error": "ai_objectives is empty - parsing may have failed", "moduleId": moduleId}

    print(f"[processAndStoreResults] ✅ Validation passed - all required fields present")
    print(f"[processAndStoreResults] - gpt_summary: {len(message)} chars")
    print(f"[processAndStoreResults] - ai_modules: {len(ai_modules)} modules")
    print(f"[processAndStoreResults] - ai_topics: {len(ai_topics)} topics")
    print(f"[processAndStoreResults] - ai_objectives: {len(ai_objectives)} objectives")

    # First, verify the row exists
    print("Insetion se phle tkk sab theek hai")
    check_res = supabase.table("training_modules").select("module_id, processing_status").eq("module_id", moduleId).execute()
    check_data = getattr(check_res, "data", None)
    check_error = getattr(check_res, "error", None)
    print("Insertion ke baad bhi theek hai")
    
    if check_error:
        print(f"[processAndStoreResults] Error checking row existence: {check_error}")
    
    row_exists = check_data and len(check_data) > 0
    
    if not row_exists:
        print(f"[processAndStoreResults] WARNING: No row found with module_id={moduleId}")
    else:
        print(f"[processAndStoreResults] Row exists: {check_data}")
    
    update_payload = {
        "gpt_summary": message,
        "ai_modules": ai_modules,
        "ai_topics": ai_topics,
        "ai_objectives": ai_objectives,
        "processing_status": "completed",
    }
    

    print(f"[processAndStoreResults] Payload prepared. Row exists: {row_exists}")
    print(f"[processAndStoreResults] Update payload keys: {list(update_payload.keys())}")
    print(f"[processAndStoreResults] gpt_summary length: {len(update_payload.get('gpt_summary', ''))}")
    print(f"[processAndStoreResults] ai_modules length: {len(update_payload.get('ai_modules', ''))}")

    # Use UPSERT to handle race condition where frontend creates row during processing
    upsert_payload = {
        "module_id":moduleId,
        "gpt_summary": message,
        "ai_modules": ai_modules,
        "ai_topics": ai_topics,
        "ai_objectives": ai_objectives,
        "processing_status": "completed",
    }
    
    # print("Upsert Payload:", upsert_payload)
    print(f"[processAndStoreResults] Upserting row for module_id={str(moduleId)}")
    res = supabase.table("training_modules").upsert(
        upsert_payload, 
        on_conflict="module_id",
        returning="representation"
    ).execute()

    op_error = getattr(res, "error", None)
    if op_error:
        err_msg = op_error.get("message") if isinstance(op_error, dict) else getattr(op_error, "message", str(op_error))
        err_code = op_error.get("code") if isinstance(op_error, dict) else getattr(op_error, "code", None)
        print(f"[processAndStoreResults] Supabase operation error: {err_msg} (code: {err_code})")
        print(f"[processAndStoreResults] Full error object: {op_error}")
        raise Exception(f"Failed to save to Supabase: {err_msg}")

    data = res.data if hasattr(res, "data") else None

    if not data or len(data) == 0:
        print(f"[processAndStoreResults] WARNING: No rows affected for moduleId: {moduleId}.")
        print(f"[processAndStoreResults] Response data: {data}")
        print(f"[processAndStoreResults] Response error: {getattr(res, 'error', None)}")
    else:
        print(f"[processAndStoreResults] ✅ Successfully saved {len(data)} row(s).")
        if isinstance(data, list) and len(data) > 0:
            saved_row = data[0]
            print(f"[processAndStoreResults] Saved row has gpt_summary: {bool(saved_row.get('gpt_summary'))}")
            print(f"[processAndStoreResults] Saved row has ai_modules: {bool(saved_row.get('ai_modules'))}")

    baseUrl = os.getenv("NEXT_PUBLIC_BACKEND_URL")
    if baseUrl:
        try:
            print(f"[processAndStoreResults] Calling start-content-generation for moduleId: {moduleId}")
            print(json.dumps({"module_id": moduleId}))
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{baseUrl}/api/start-content-generation",
                    headers={"Content-Type": "application/json"},
                    content=json.dumps({"moduleId": moduleId})
                )
        except Exception as e:
            print("Failed to call start-content-generation:", e)
            
        # print(ai_modules)
        # print(ai_topics)
        # print(ai_objectives)

    return {"ai_modules": ai_modules, "ai_topics": ai_topics, "ai_objectives": ai_objectives, "supabaseResult": data}

# -------------------------
# handleTextContent
# -------------------------
async def processTextContent(text: str, moduleId: str):
    # ✅ same logic: previously OpenAI chat completion
    # Now: Gemini text-only generation (no file upload), but flow unchanged.
    response = gemini_client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[
            {"role": "user", "parts": [INSTRUCTION_PROMPT]},
            {"role": "user", "parts": [f"Process the content provided here:\n\n===== BEGIN CONTENT =====\n{text}\n===== END CONTENT ====="]},
        ],
    )

    message = getattr(response, "text", "") or ""
    results = await processAndStoreResults(moduleId, message.strip())
    return JSONResponse(content=results)


from fastapi import Body

@router.post("/openai-upload/text")
async def openai_upload_text(payload: dict = Body(...)):
    text = payload.get("text")
    moduleId = payload.get("moduleId")

    if not text or not moduleId:
        return JSONResponse(content={"error": "Missing text or moduleId"}, status_code=400)

    return await processTextContent(text, moduleId)

@router.post("/openai-upload/file")
async def openai_upload_file(
    files: List[UploadFile] = File(...),
    moduleId: str = Form(...)
):
    temp_files = []
    pdf_files = []
    merged_pdf_path = None

    try:
        print("FILES RECEIVED COUNT:", len(files))
        print("MODULE ID:", moduleId)

        if not files or not moduleId:
            return JSONResponse(content={"error": "No files provided"}, status_code=400)

        tempDir = tempfile.gettempdir()

        for file in files:
            safe_name = file.filename.replace(" ", "_")
            temp_path = os.path.join(tempDir, f"{uuid.uuid4()}_{safe_name}")

            with open(temp_path, "wb") as f:
                shutil.copyfileobj(file.file, f)

            temp_files.append(temp_path)

            filename_lower = file.filename.lower()

            if filename_lower.endswith(".doc") or filename_lower.endswith(".docx"):
                converted_pdf = temp_path.rsplit(".", 1)[0] + ".pdf"
                await convertDocToPdf(temp_path, converted_pdf)
                pdf_files.append(converted_pdf)
            elif filename_lower.endswith(".pdf"):
                pdf_files.append(temp_path)
            else:
                raise Exception(f"Unsupported file type: {file.filename}")

        merged_pdf_path = os.path.join(tempDir, f"{moduleId}_combined.pdf")

        merger = PdfMerger()
        for pdf in pdf_files:
            merger.append(pdf)

        merger.write(merged_pdf_path)
        merger.close()

        # Upload merged PDF to SAME bucket
        with open(merged_pdf_path, "rb") as f:
            combined_bytes = f.read()

        storage_path = f"uploads/{moduleId}_combined.pdf"
        supabase.storage.from_("content library").remove([storage_path])
        upload_res = supabase.storage.from_("content library").upload(
            storage_path,
            combined_bytes,
            {"content-type": "application/pdf"}
        )
        if hasattr(upload_res, "error") and upload_res.error:
            raise Exception(f"Failed to upload merged PDF: {upload_res.error}")

        # Correct public URL extraction
        url_res = supabase.storage.from_("content library").get_public_url(storage_path)
        print("Public URL response:", url_res)
        

        # Handle both possible return types
        if isinstance(url_res, str):
            combined_url = url_res
        elif isinstance(url_res, dict):
            combined_url = url_res.get("publicUrl") or url_res.get("public_url")
        else:
            combined_url = None

        if not combined_url:
            raise Exception("Failed to generate public URL for merged PDF")

    

        # Update training_modules to point to merged file
        supabase.table("training_modules").update({
            "content_url": combined_url
        }).eq("module_id", moduleId).execute()

        supabase.table("training_modules").update({
            "processing_status": "summarizing"
        }).eq("module_id", moduleId).execute()

        geminiFile = gemini_client.files.upload(file=merged_pdf_path)

        response = await asyncio.to_thread(
            lambda: gemini_client.models.generate_content(
                model="gemini-3-flash-preview",
                contents=[INSTRUCTION_PROMPT, geminiFile],
            )
        )

        message = getattr(response, "text", "") or ""

        return await processAndStoreResults(moduleId, message.strip())

    except Exception as err:
        print("Upload error:", err)

        supabase.table("training_modules").update({
            "processing_status": "failed"
        }).eq("module_id", moduleId).execute()

        return JSONResponse(content={"error": str(err)}, status_code=500)

    finally:
        for path in temp_files:
            if os.path.exists(path):
                os.unlink(path)

        if merged_pdf_path and os.path.exists(merged_pdf_path):
            os.unlink(merged_pdf_path)

# -------------------------
# Main POST route (equivalent export async function POST)
# -------------------------
# @router.post("/openai-upload")
# async def POST(req: Request):
#     try:
#         contentType = (req.headers.get("content-type") or"").lower()

#         if "multipart/form-data" in contentType:
#             return await handleFileUpload(req)
#         elif contentType and "application/json" in contentType:
#             return await handleTextUpload(req)
#         else:
#             return JSONResponse(content={"error": "Unsupported content type"}, status_code=400)

#     except Exception as error:
#         print("❌ Fatal Error:", error)
#         return JSONResponse(
#             content={"error": "Internal server error", "detail": str(error)},
#             status_code=500
#         )


