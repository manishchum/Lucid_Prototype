from email.header import Header
import os
import re
import json
import uuid
import shutil
import asyncio
import platform
from typing import Any, Dict, List, Optional, Union
from ingestion.ingestion_sales_tool import ingest_by_document_id
from PyPDF2 import PdfMerger, PdfReader
import io
from fastapi import BackgroundTasks
from fastapi import Header
import tempfile
from lucid_tools.stage_one import create_tool_generation_jobs
# ... (rest of your existing imports)
import httpx
import pandas as pd
from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import JSONResponse
from ingestion import ingest_from_upload
from fastapi import UploadFile, File, Form
# ... (rest of your existing imports)
# from supabase import create_client, Client
from utils.auth_bridge import get_service_supabase_client
supabase = get_service_supabase_client()
from ingestion.parser import parse_excel_first_sheet

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

@router.post("/lucid_tool_upload")
async def lucid_tool_upload(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    category: str = Form(...),
    contextText: str = Form(None), # Optional context from the textarea
    user_id: str = Header(..., alias="X-User-ID"),
    company_id: str = Header(..., alias="X-Company-ID"),
):
    """
    This endpoint handles the document upload for Lucid Tools.
    It will:
    1. Save the uploaded document to the 'sales tool document' table.
    2. Kick off the Stage 1 background task to generate retrieval queries.
    """
    try:
        if not user_id or not company_id:
            return JSONResponse(
                status_code=401,
                content={"error": "User authentication is required."},
            )
        

        # --- 2. Get the Category ID ---
        category_res = supabase.table("salestool_categories").select("id").eq("name", category).single().execute()
        if not category_res.data:
            return JSONResponse(status_code=400, content={"error": f"Category '{category}' not found."})
        category_id = category_res.data['id']

        # Read uploaded file
        file_contents = await file.read()
        file_name = file.filename

        document_text = ""

        if file.content_type == "application/pdf":
            pdf_reader = PdfReader(io.BytesIO(file_contents))
            for page in pdf_reader.pages:
                page_text = page.extract_text()
                if page_text:
                    document_text += page_text
        else:
            try:
                document_text = file_contents.decode("utf-8")
            except UnicodeDecodeError:
                return JSONResponse(
                    status_code=400,
                    content={"error": "File is not a valid PDF or plain text file."}
                )
        if contextText:
            document_text += "\n\n--- Additional Context ---\n" + contextText

        # --- 3. Save the uploaded document as a new 'training_module' ---
        sales_doc_res = supabase.table("sales_tool_documents").insert({
            "company_id": company_id,
            "user_id": user_id,
            "category_id": category_id,
            "file_name": file_name   
        }).execute()

        if not sales_doc_res.data:
            return JSONResponse(
                status_code=500,
                content={"error": "Failed to save document"}
            )
        source_document_id = sales_doc_res.data[0]["document_id"]
        
        # Upload to Storage
        storage_path = f"sales-tool/{source_document_id}/{file_name}"

        upload_res = supabase.storage.from_("content library").upload(
            storage_path,
            file_contents,
            {
                "content-type": file.content_type or "application/octet-stream"
            }
        )
        if hasattr(upload_res, "error") and upload_res.error:
            raise Exception(f"Storage upload failed: {upload_res.error}")

        # Generate url
        url_res = supabase.storage.from_("content library").get_public_url(storage_path)

        if isinstance(url_res, str):
            context_url = url_res
        elif isinstance(url_res, dict):
            context_url = (
                url_res.get("publicUrl")
                or url_res.get("public_url")
            )
        else:
            context_url = None
        if not context_url:
            raise Exception("Failed to generate storage URL")

        # Save url in database
        supabase.table("sales_tool_documents").update({
            "context_url": context_url
        }).eq(
            "document_id",
            source_document_id
        ).execute()


        print(f"[lucid_tool_upload] Created source document record: {source_document_id}")
        # --- 4. Start the Stage 1 background task ---
        background_tasks.add_task(
            create_tool_generation_jobs,
            source_document_id=source_document_id,
            document_content= document_text,
            category_id=category_id,
            user_id=user_id,
            company_id=company_id
        )

        background_tasks.add_task(
            ingest_by_document_id,
            source_document_id
        )

        return JSONResponse(
            status_code=202, # 202 Accepted is appropriate for a background job
            content={
                "message": "Tool generation process started successfully.",
                "source_document_id": source_document_id
            }
        )

    except Exception as e:
        print(f"❌ Fatal Error in /lucid_tool_upload: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error", "detail": str(e)},
        )
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
    # print("Insetion se phle tkk sab theek hai")
    check_res = supabase.table("training_modules").select("module_id, processing_status").eq("module_id", moduleId).execute()
    check_data = getattr(check_res, "data", None)
    check_error = getattr(check_res, "error", None)
    # print("Insertion ke baad bhi theek hai")
    
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
from google.genai import types

def normalize_gemini_contents(contents):
    """
    Convert dict-based messages to Gemini Content/Part objects.
    Keeps existing Content objects untouched.
    """

    normalized = []

    for item in contents:

        # already correct
        if isinstance(item, types.Content):
            normalized.append(item)
            continue

        # convert dict -> Content
        if isinstance(item, dict):
            role = item.get("role", "user")
            parts = item.get("parts", [])

            normalized_parts = []

            for p in parts:
                if isinstance(p, types.Part):
                    normalized_parts.append(p)
                elif isinstance(p, str):
                    normalized_parts.append(types.Part(text=p))
                else:
                    normalized_parts.append(types.Part(text=str(p)))

            normalized.append(types.Content(role=role, parts=normalized_parts))
            continue

        # convert raw string
        if isinstance(item, str):
            normalized.append(
                types.Content(role="user", parts=[types.Part(text=item)])
            )
            continue

        # fallback
        normalized.append(
            types.Content(role="user", parts=[types.Part(text=str(item))])
        )

    return normalized

from PyPDF2 import PdfReader

def get_pdf_page_count(file_path: str) -> int:
            reader = PdfReader(file_path)
            return len(reader.pages)
def get_match_chunks(page_count: int) -> int:
    if page_count <= 15:
        return 2
    elif page_count <= 30:
        return 4
    elif page_count <= 50:
        return 5
    elif page_count <= 70:
        return 6
    elif page_count <= 100:
        return 7
    else:
        return 8
    
async def processTextContent(text: str, moduleId: str):
    # ✅ same logic: previously OpenAI chat completion
    # Now: Gemini text-only generation (no file upload), but flow unchanged.
    # response = gemini_client.models.generate_content(
    #     model="gemini-3-flash-preview",
    #     contents=[
    #         {"role": "user", "parts": [INSTRUCTION_PROMPT]},
    #         {"role": "user", "parts": [f"Process the content provided here:\n\n===== BEGIN CONTENT =====\n{text}\n===== END CONTENT ====="]},
    #     ],
    # )

    payload = [
        {"role": "user", "parts": [INSTRUCTION_PROMPT]},
        {"role": "user", "parts": [f"Process the content provided here:\n\n===== BEGIN CONTENT =====\n{text}\n===== END CONTENT ====="]},
    ]

    response = gemini_client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=normalize_gemini_contents(payload)
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
    # excel_blocks = []
    merged_pdf_path = None
    source_file_paths = []

    allowed_extensions = {"pdf", "doc", "docx", "ppt", "pptx"}
    extensions = [f.filename.lower().split(".")[-1] for f in files]

    invalid_files = [f.filename for f in files if f.filename.lower().split(".")[-1] not in allowed_extensions]
    if invalid_files:
        raise Exception(
            f"Unsupported file type(s): {', '.join(invalid_files)}. "
            "Only PDF, DOC, DOCX, PPT, and PPTX are allowed."
        )

  

    # if any(ext == "xls" for ext in extensions):
    #     raise Exception(".xls files are not supported. Please upload .xlsx")

    # has_excel = any(ext == "xlsx" for ext in extensions)
    # has_docs = any(ext in ["pdf", "doc", "docx", "ppt", "pptx"] for ext in extensions)

    # if has_excel and has_docs:
    #     raise Exception(
    #         "Mixed uploads not allowed. Upload Excel files separately from PDF/DOC/PPT."
    #     )

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

            # -------- Upload individual file to Supabase --------
            with open(temp_path, "rb") as f:
                file_bytes = f.read()

            source_storage_path = f"uploads/{moduleId}/source/{safe_name}"

            supabase.storage.from_("content library").remove([source_storage_path])

            upload_source = supabase.storage.from_("content library").upload(
                source_storage_path,
                file_bytes,
                {"content-type": file.content_type or "application/octet-stream"}
            )

            if hasattr(upload_source, "error") and upload_source.error:
                raise Exception(f"Failed to upload source file: {upload_source.error}")

            source_file_paths.append(source_storage_path)
            # ----------------------------------------------------

            temp_files.append(temp_path)

            filename_lower = file.filename.lower()

            # Reject legacy excel
            if filename_lower.endswith(".xls"):
                raise Exception(".xls files are not supported. Please upload .xlsx")

            # Excel mode
            # elif filename_lower.endswith(".xlsx"):

            #     parsed_blocks = parse_excel_first_sheet(temp_path)

            #     if not parsed_blocks:
            #         raise Exception(f"No usable data found in first sheet for {file.filename}")

            #     excel_blocks.extend(parsed_blocks)

            # PDF-like mode
            elif filename_lower.endswith((".pdf", ".doc", ".docx", ".ppt", ".pptx")):

                # convert office docs to pdf
                if filename_lower.endswith((".doc", ".docx", ".ppt", ".pptx")):
                    converted_pdf = temp_path.rsplit(".", 1)[0] + ".pdf"
                    await convertDocToPdf(temp_path, converted_pdf)
                    pdf_files.append(converted_pdf)
                else:
                    pdf_files.append(temp_path)

            else:
                raise Exception(f"Unsupported file type: {file.filename}")
            
        # Reject heterogeneous upload
        # if excel_blocks and pdf_files:
        #     raise Exception(
        #         "Mixed uploads not allowed. Upload Excel files separately from PDF/DOC/PPT."
        #     )
        
        # ==========================
        # EXCEL MODE
        # ==========================
        # if excel_blocks:

        #     combined_text = "\n\n".join(block["content"] for block in excel_blocks)

        #     # update module metadata
        #     supabase.table("training_modules").update({
        #         "source_files": source_file_paths,
        #         "processing_status": "summarizing"
        #     }).eq("module_id", moduleId).execute()

        #     # attach preview url of first excel file
        #     if source_file_paths:

        #         url_res = supabase.storage.from_("content library").get_public_url(
        #             source_file_paths[0]
        #         )

        #         if isinstance(url_res, str):
        #             source_url = url_res
        #         elif isinstance(url_res, dict):
        #             source_url = url_res.get("publicUrl") or url_res.get("public_url")
        #         else:
        #             source_url = None

        #         if source_url:
        #             supabase.table("training_modules").update({
        #                 "content_url": source_url
        #             }).eq("module_id", moduleId).execute()

        #     # send text to Gemini
        #     return await processTextContent(combined_text, moduleId)
        
        
        merged_pdf_path = os.path.join(tempDir, f"{moduleId}_combined.pdf")

        merger = PdfMerger()
        for pdf in pdf_files:
            merger.append(pdf)

        merger.write(merged_pdf_path)
        merger.close()
        total_pages = get_pdf_page_count(merged_pdf_path)
        print(f"[PAGE COUNT] Total pages in merged PDF: {total_pages}")

        match_chunks = get_match_chunks(total_pages)

        print(f"[MATCH CHUNKS] Selected: {match_chunks}")

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
            "source_files": source_file_paths
        }).eq("module_id", moduleId).execute()

        supabase.table("training_modules").update({
            "processing_status": "summarizing",
            "page_count": total_pages,
            "match_chunks": match_chunks
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
            try:
                if path and os.path.exists(path):
                    os.unlink(path)
            except Exception as e:
                print(f"Cleanup warning: could not delete {path} -> {e}")

        try:
            if merged_pdf_path and os.path.exists(merged_pdf_path):
                os.unlink(merged_pdf_path)
        except Exception as e:
            print(f"Cleanup warning: could not delete merged pdf -> {e}")

@router.post("/preview-file")
async def preview_file(payload: dict):
    file_path = payload.get("filePath")

    if not file_path:
        return JSONResponse({"error": "Missing filePath"}, status_code=400)

    try:
        temp_dir = tempfile.gettempdir()

        # Download file from Supabase
        res = supabase.storage.from_("content library").download(file_path)

        if not res:
            raise Exception("File not found in storage")

        original_path = os.path.join(temp_dir, os.path.basename(file_path))

        with open(original_path, "wb") as f:
            f.write(res)

        # If already PDF → return directly
        if original_path.lower().endswith(".pdf"):
            public = supabase.storage.from_("content library").get_public_url(file_path)
            return {"previewUrl": public}

        # Convert DOC/DOCX → PDF
        converted_pdf = original_path.rsplit(".", 1)[0] + "_preview.pdf"

        await convertDocToPdf(original_path, converted_pdf)

        # Upload preview PDF
        preview_storage_path = f"preview/{uuid.uuid4()}.pdf"

        with open(converted_pdf, "rb") as f:
            supabase.storage.from_("content library").upload(
                preview_storage_path,
                f.read(),
                {"content-type": "application/pdf"}
            )

        url = supabase.storage.from_("content library").get_public_url(preview_storage_path)

        return {"previewUrl": url}

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

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


