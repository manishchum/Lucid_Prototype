import os
import re
import json
import uuid
import shutil
import asyncio
import platform
from typing import Any, Dict, List, Optional, Union

import httpx
import pandas as pd
from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import JSONResponse

from supabase import create_client, Client

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
supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY", "")

if not supabase_url:
    print("[openai_upload] ERROR: NEXT_PUBLIC_SUPABASE_URL not set!")
if not supabase_key:
    print("[openai_upload] ERROR: Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_ANON_KEY is set!")
else:
    key_preview = f"{supabase_key[:20]}...{supabase_key[-10:]}" if len(supabase_key) > 30 else "***"
    print(f"[openai_upload] Using Supabase key: {key_preview}")

supabase: Client = create_client(supabase_url, supabase_key)

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


INSTRUCTION_PROMPT = """You are an expert instructional designer. Your job is to decompose a learning asset into a clear sequence of self-contained learning modules. CRITICAL RULES:

⚠️ STRICTLY FOLLOW THESE RULES:
1. **ONLY USE SOURCE MATERIAL** - Every module, topic, and objective MUST be derived from the provided content. Do NOT add, infer, or extrapolate information outside the source.
2. **ACCURATE MODULE TITLES** - Use descriptive titles directly reflecting the source content (e.g., "Introduction to REST API Architecture" not "API Basics").
3. **EXTRACT TOPICS FROM SOURCE** - List only topics explicitly mentioned or directly implied in the source material.
4. **GROUND OBJECTIVES IN SOURCE** - Each objective must state what learners will know/do based on content present in the source.
5. **NO HALLUCINATION** - Do not create, assume, or infer learning outcomes not supported by the source material.

Processing steps (apply exactly):
1. Identify Overall Learning Goal
  - State the single end competency learners achieve after completing ALL modules, derived ONLY from source content.
2. Segment into Themes
  - Cluster related ideas from the SOURCE into natural, self-contained modules.
3. Apply One Core Idea Rule
  - Each module centers on ONE core concept from the source. If a module mixes unrelated source topics, split it.
4. Apply Module Splitting Checks (for every module)
  - Time-to-Mastery Rule: If the source topic is complex, split into smaller modules.
  - Single-Outcome Rule: Split if the source presents multiple distinct learning outcomes.
  - Cognitive Load Rule: Split if the source introduces >1–3 new concepts at once.
  - For each module, list which rules triggered a split based on SOURCE ANALYSIS.
5. Arrange Modules Logically
  - Order from foundational → intermediate → advanced based on the SOURCE structure.
  - Provide sequencing rationale based on source material flow.
6. Validate Module Independence
  - Ensure each module is self-contained using only source content and delivers one clear learning outcome assessable from the source.

Output format for each module:
#### Module [#]: [Accurate Title from Source]
**Topics:**
- [topic explicitly in source]
- [topic explicitly in source]

**Objectives:**
- Learners will [action] [concept from source]
- Learners will [action] [concept from source]

⚠️ IF SOURCE IS INCOMPLETE: List clarifying questions about missing context (e.g., target proficiency, compliance requirements) but DO NOT INVENT CONTENT.
⚠️ NEVER EXTRAPOLATE: Strictly bind all content to source material. Gaps in source = gaps in modules, not invention.
Respond ONLY in MARKDOWN format with NO additional commentary and always return a module related to the provided content.
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

        cutoffRegex = re.search(r"(Module Splitting Checks|Sequencing Rationale|Module Independence|Additional Clarifying Questions)", modulesSection, re.I)
        if cutoffRegex:
            modulesSection = modulesSection[:cutoffRegex.start()]

        moduleRegex = re.compile(
            r"(####\s*Module\s*\d+:|Module\s*\d+:|\d+\.\s*\*\*[^*]+\*\*)([\s\S]*?)(?=(####\s*Module\s*\d+:|Module\s*\d+:|\d+\.\s*\*\*[^*]+\*\*|$))",
            re.I
        )

        moduleMatches = []
        for m in moduleRegex.finditer(modulesSection):
            moduleMatches.append({
                "header": m.group(1).strip(),
                "content": m.group(2).strip()
            })

        if len(moduleMatches) == 0:
            fallbackRegex = re.compile(
                r"(####\s*Module\s*\d+:|Module\s*\d+:)([\s\S]*?)(?=(####\s*Module\s*\d+:|Module\s*\d+:|$))",
                re.I
            )
            for m in fallbackRegex.finditer(message):
                moduleMatches.append({
                    "header": m.group(1).strip(),
                    "content": m.group(2).strip()
                })

        print(f"[processAndStoreResults] Found {len(moduleMatches)} module matches.")

        for i in range(len(moduleMatches)):
            moduleData = moduleMatches[i]
            block = moduleData["content"]

            titleMatch = re.search(r"^(?:\*\*|###)?\s*([A-Za-z0-9 .\-]+)(?:\*\*|:)?", block)
            title = titleMatch.group(1).strip() if titleMatch else f"Module {i + 1}"

            topics: List[str] = []
            objectives: List[str] = []

            topicsSection = re.search(r"topics?:\s*([\s\S]*?)(?=objectives?:|$)", block, re.I)
            if topicsSection and topicsSection.group(1):
                topics.extend([
                    re.sub(r"^\*\*?Topic:?\*\*?", "", re.sub(r"^[-*]\s*", "", line)).strip()
                    for line in re.split(r"\n|\r", topicsSection.group(1))
                    if line.strip() and (re.match(r"^[-*]", line.strip()) or re.match(r"^[A-Za-z0-9 .\-]+$", line.strip()))
                ])
                topics = [t for t in topics if t]

            objectivesSection = re.search(r"objectives?:\s*([\s\S]*)", block, re.I)
            if objectivesSection and objectivesSection.group(1):
                objectives.extend([
                    re.sub(r"^\*\*?Objective:?\*\*?", "", re.sub(r"^[-*]\s*", "", line)).strip()
                    for line in re.split(r"\n|\r", objectivesSection.group(1))
                    if line.strip() and (re.match(r"^[-*]", line.strip()) or re.match(r"^[A-Za-z0-9 .\-]+$", line.strip()))
                ])
                objectives = [o for o in objectives if o]

            if len(topics) == 0:
                topics.extend([
                    re.sub(r"^[-*]\s*", "", line).strip()
                    for line in re.split(r"\n|\r", block)
                    if re.match(r"^[-*]", line.strip()) and not re.search(r"objective", line, re.I)
                ])
                topics = [t for t in topics if t]

            if len(objectives) == 0:
                objectives.extend([
                    re.sub(r"^[-*]\s*", "", line).strip()
                    for line in re.split(r"\n|\r", block)
                    if re.match(r"^[-*]", line.strip()) and re.search(r"objective", line, re.I)
                ])
                objectives = [o for o in objectives if o]

            ai_modules.append({"title": title, "topics": topics, "objectives": objectives})
            ai_topics.extend(topics)
            ai_objectives.extend(objectives)

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
    check_res = supabase.table("training_modules").select("module_id, processing_status").eq("module_id", moduleId).execute()
    check_data = getattr(check_res, "data", None)
    check_error = getattr(check_res, "error", None)
    
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


async def handleTextUpload(req: Request):
    body = await req.json()
    text = body.get("text")
    moduleId = body.get("moduleId")

    if not text or not moduleId:
        return JSONResponse(content={"error": "Missing text or moduleId"}, status_code=400)

    return await processTextContent(text, moduleId)


async def handleFileUpload(req: Request):
    tempFilePath: Optional[str] = None

    try:
        form = await req.form()
        file: UploadFile = form.get("file")
        moduleId = form.get("moduleId")

        if not file or not file.filename or not moduleId or moduleId == "null":
            return JSONResponse(content={"error": "Missing file or moduleId"}, status_code=400)

        tempDir = os.getenv("TEMP", "C:\\Windows\\Temp") if platform.system().lower().startswith("win") else "/tmp"
        tempFilePath = os.path.join(tempDir, f"{uuid.uuid4()}_{file.filename}")

        with open(tempFilePath, "wb") as f:
            shutil.copyfileobj(file.file, f)

        isDocx = re.search(r"\.docx$", file.filename, re.I)
        isDoc = re.search(r"\.doc$", file.filename, re.I)
        isSpreadsheet = re.search(r"\.(xlsx|xls|csv)$", file.filename, re.I)

        # Convert doc/docx to PDF via CloudConvert
        if isDocx or isDoc:
            try:
                pdfPath = re.sub(r"\.docx?$", ".pdf", tempFilePath, flags=re.I)
                await convertDocToPdf(tempFilePath, pdfPath)
                try:
                    os.unlink(tempFilePath)
                except Exception:
                    pass
                tempFilePath = pdfPath
                print(f"Converted {file.filename} to PDF for processing via CloudConvert")
            except Exception as conversionError:
                print("CloudConvert conversion failed:", conversionError)
                raise Exception("Failed to convert document to PDF via CloudConvert.")

        if isSpreadsheet:
            extractedText = f"Spreadsheet Analysis: {file.filename}\n\n"

            if re.search(r"\.csv$", file.filename, re.I):
                df = pd.read_csv(tempFilePath)
                extractedText += df.to_string(index=False)
            else:
                xls = pd.ExcelFile(tempFilePath)
                for sheetName in xls.sheet_names:
                    extractedText += f"\n=== Sheet: {sheetName} ===\n"
                    df = pd.read_excel(tempFilePath, sheet_name=sheetName, header=None).fillna("")
                    for idx, row in df.iterrows():
                        row_values = [str(x) for x in row.values.tolist()]
                        if len(row_values) > 0:
                            extractedText += f"Row {idx + 1}: {' | '.join(row_values)}\n"

            try:
                os.unlink(tempFilePath)
            except Exception:
                pass

            return await processTextContent(extractedText, moduleId)

        # ------------------------------------------------------------------
        # ✅ GEMINI FILE UPLOAD + PROCESSING (replaces OpenAI Assistants)
        # ------------------------------------------------------------------
        # Keep variable names same:
        # - openaiFile -> geminiFile (but we keep openaiFile variable name for flow parity)
        # - assistantId remains unused (but not needed)
        # - messages parsing becomes direct response.text extraction
        # ------------------------------------------------------------------

        # Upload to Gemini Files API
        with open(tempFilePath, "rb") as f:
            # Gemini SDK expects a path OR file=...
            # Use the official upload method as per spec.
            openaiFile = gemini_client.files.upload(file=tempFilePath)

        # Generate content using uploaded file
        response = gemini_client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=[
                INSTRUCTION_PROMPT,
                openaiFile  # Pass file object directly, same flow as SDK doc
            ],
        )

        message = getattr(response, "text", "") or ""

        try:
            os.unlink(tempFilePath)
        except Exception:
            pass

        results = await processAndStoreResults(moduleId, message.strip())
        return JSONResponse(content=results)

    except Exception as err:
        if tempFilePath:
            try:
                os.unlink(tempFilePath)
            except Exception:
                pass
        raise err


# -------------------------
# Main POST route (equivalent export async function POST)
# -------------------------
@router.post("/openai-upload")
async def POST(req: Request):
    try:
        contentType = req.headers.get("content-type")

        if contentType and "multipart/form-data" in contentType:
            return await handleFileUpload(req)
        elif contentType and "application/json" in contentType:
            return await handleTextUpload(req)
        else:
            return JSONResponse(content={"error": "Unsupported content type"}, status_code=400)

    except Exception as error:
        print("❌ Fatal Error:", error)
        return JSONResponse(
            content={"error": "Internal server error", "detail": str(error)},
            status_code=500
        )
