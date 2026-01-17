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
import openai
from fastapi import APIRouter, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse

from supabase import create_client, Client



router = APIRouter()
print("Loading openai_upload/route.py... Updated Logic Active")

# -------------------------
# Supabase client (same role as "../../../lib/supabase")
# -------------------------
supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY", "")
supabase: Client = create_client(supabase_url, supabase_key)




# -------------------------
# OpenAI setup
# -------------------------
openai_client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

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
  - Cognitive Load Rule: Split if the source introduces >3–5 new concepts at once.
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

    update_payload = {
        "gpt_summary": message,
        "ai_modules": ai_modules,
        "ai_topics": ai_topics,
        "ai_objectives": ai_objectives,
        "processing_status": "completed",
    }

    res = supabase.table("training_modules").update(update_payload).eq("module_id", moduleId).execute()

    if getattr(res, "error", None):
        print("[processAndStoreResults] Supabase update error:", res.error)
        raise Exception(f"Failed to update Supabase: {res.error.message}")

    data = res.data if hasattr(res, "data") else None

    if not data or len(data) == 0:
        print(f"[processAndStoreResults] No rows updated for moduleId: {moduleId}. Check if the ID exists in training_modules table.")
    else:
        print(f"[processAndStoreResults] Successfully updated {len(data)} row(s).")

    baseUrl = os.getenv("NEXT_PUBLIC_BACKEND_URL")
    if baseUrl:
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{baseUrl}/api/start-content-generation",
                    headers={"Content-Type": "application/json"},
                    content=json.dumps({"module_id": moduleId})
                )
        except Exception as e:
            print("Failed to call start-content-generation:", e)

    return {"ai_modules": ai_modules, "ai_topics": ai_topics, "ai_objectives": ai_objectives, "supabaseResult": data}


# -------------------------
# handleTextContent
# -------------------------
async def processTextContent(text: str, moduleId: str):
    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": INSTRUCTION_PROMPT},
            {"role": "user", "content": f"Process the content provided here:\n\n===== BEGIN CONTENT =====\n{text}\n===== END CONTENT ====="},
        ],
        temperature=0.1,
    )

    message = response.choices[0].message.content or ""
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
    print("[handleFileUpload] Processing file upload request...")

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
        # Block .doc files as they are not supported by OpenAI directly
        if isDoc:
            raise Exception("DOC format is not supported. Please convert to DOCX or PDF.")
        
        # DOCX files will be handled by OpenAI Assistants API directly below

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

        # Upload to OpenAI files (assistants)
        with open(tempFilePath, "rb") as f:
            openaiFile = openai_client.files.create(file=f, purpose="assistants")

        assistantId = os.getenv("OPENAI_ASSISTANT_ID")
        if not assistantId:
            raise Exception("OPENAI_ASSISTANT_ID is not set")

        # Assistant run - threads.createAndRunPoll equivalent
        run = openai_client.beta.threads.create_and_run_poll(
            assistant_id=assistantId,
            thread={
                "messages": [{
                    "role": "user",
                    "content": INSTRUCTION_PROMPT,
                    "attachments": [{"file_id": openaiFile.id, "tools": [{"type": "file_search"}]}],
                }]
            }
        )

        if run.status != "completed":
            raise Exception(f"Assistant run failed with status: {run.status}")

        messages = openai_client.beta.threads.messages.list(run.thread_id)

        assistantMessage = None
        for m in messages.data:
            if getattr(m, "role", None) == "assistant":
                assistantMessage = m
                break

        firstContent = None
        if assistantMessage and getattr(assistantMessage, "content", None):
            for c in assistantMessage.content:
                try:
                    if c.type == "text":
                        firstContent = {"type": "text", "text": getattr(c.text, "value", "") if hasattr(c, "text") else ""}
                        break
                except Exception:
                    continue

        message = ""
        if firstContent and isTextContentBlock(firstContent):
            message = firstContent["text"] if isinstance(firstContent["text"], str) else (firstContent["text"].get("value") or "")

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
