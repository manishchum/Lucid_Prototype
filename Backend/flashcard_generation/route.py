import os
import re
import json
import httpx
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse
from ai.ai_gateway import AI
from ai.types import AIRequest
router = APIRouter()
from utils.auth import get_request_auth_required, RequestAuth, get_effective_company_id, require_addon

router = APIRouter(dependencies=[Depends(require_addon("lucid_studio_flashcards"))])

# COMMON_GEMINI_MODELS = ["gemini-2.5-flash-lite"]

# # ---------------------------------------------------------------------
# # GEMINI HELPER (Python port of gemini-helper.ts)
# # ---------------------------------------------------------------------
# async def callGemini(
#     promptText: str,
#     opts: Optional[Dict[str, Any]] = None
# ):
#     key = os.getenv("GEMINI_API_KEY")
#     if not key:
#         return {"ok": False, "status": None, "text": "no_gemini_key"}

#     candidateModels = (opts or {}).get("candidateModels") or COMMON_GEMINI_MODELS
#     maxOutputTokens = (opts or {}).get("maxOutputTokens") or 1000
#     temperature = (opts or {}).get("temperature") if isinstance((opts or {}).get("temperature"), (int, float)) else 0.25

#     tryEndpoints = ["v1beta", "v1"]

#     async with httpx.AsyncClient(timeout=120) as client:
#         for model in candidateModels:
#             for ep in tryEndpoints:
#                 base = "v1" if ep == "v1" else "v1beta"
#                 url = f"https://generativelanguage.googleapis.com/{base}/models/{model}:generateContent?key={key}"

#                 if ep == "v1":
#                     bodyToSend = {
#                         "prompt": {"text": promptText},
#                         "temperature": temperature,
#                         "maxOutputTokens": maxOutputTokens,
#                         "candidateCount": 1
#                     }
#                 else:
#                     bodyToSend = {
#                         "contents": [{"parts": [{"text": promptText}]}],
#                         "generationConfig": {
#                             "temperature": temperature,
#                             "maxOutputTokens": maxOutputTokens,
#                             "candidateCount": 1
#                         }
#                     }

#                 try:
#                     resp = await client.post(url, json=bodyToSend)
#                     text = resp.text  # Changed from await resp.text()

#                     if resp.status_code < 200 or resp.status_code >= 300:
#                         print("[gemini-helper] request failed", model, ep, resp.status_code, text[:500])
#                         continue

#                     try:
#                         data = json.loads(text) if text else {}
#                     except Exception:
#                         print("[gemini-helper] invalid JSON from gemini", model, ep, text[:500])
#                         continue

#                     genText = (
#                         (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [{}])[0].get("text")
#                         or (data.get("output") or [{}])[0].get("content")
#                         or (data.get("candidates") or [{}])[0].get("output")
#                         or ""
#                     )

#                     return {"ok": True, "model": model, "endpoint": ep, "data": {**data, "text": genText}}

#                 except Exception as err:
#                     print("[gemini-helper] network/exception", model, ep, str(err))
#                     continue

#     return {"ok": False, "status": None, "text": "no_model_endpoint_succeeded"}


# ---------------------------------------------------------------------
# NORMALIZER (unchanged logic)
# ---------------------------------------------------------------------
def normalizeFlashcardsShape(parsed: Any) -> Optional[List[Dict[str, Any]]]:
    if not parsed:
        return None

    if not isinstance(parsed, list):
        if isinstance(parsed.get("cards"), list):
            parsed = parsed["cards"]
        elif isinstance(parsed.get("sections"), list):
            parsed = parsed["sections"]
        else:
            return None

    out = []
    maxCards = 8

    for item in parsed:
        if not isinstance(item, dict):
            continue

        heading = str(item.get("heading") or item.get("title") or item.get("front") or "").strip()
        if not heading:
            continue

        points = []
        if isinstance(item.get("points"), list):
            points = [str(p) for p in item["points"]]
        elif isinstance(item.get("bullets"), list):
            points = [str(p) for p in item["bullets"]]
        elif isinstance(item.get("points"), str):
            points = [s.strip() for s in re.split(r"\n|;|\.|\u2022", item["points"]) if s.strip()]

        points = [str(p).strip() for p in points if p][:4]

        out.append({
            "heading": " ".join(heading.split()[:10]),
            "points": points
        })

        if len(out) >= maxCards:
            break

    return out if out else None


# ---------------------------------------------------------------------
# ROUTE (exact logic preserved)
# ---------------------------------------------------------------------
# @router.post("/generate-flashcards-gemini")
# async def POST(req: Request):
#     try:
#         body = await req.json()
#         content = str(body.get("content") or "")
#         print("[generate-flashcards-gemini] request content length:", len(content))

#         if not content.strip():
#             return JSONResponse({"error": "no_content_provided"}, status_code=400)

#         if not os.getenv("GEMINI_API_KEY"):
#             print("[generate-flashcards-gemini] missing GEMINI_API_KEY")
#             if os.getenv("NODE_ENV") != "production":
#                 sample = [
#                     {"heading": "Key Concepts", "points": ["Understand core idea", "Recall main steps", "Apply in practice"]},
#                     {"heading": "Best Practices", "points": ["Use short examples", "Prefer visuals", "Test often"]},
#                     {"heading": "Quick Tips", "points": ["Summarize each section", "Highlight actions"]},
#                 ]
#                 return JSONResponse(sample)
#             return JSONResponse({"error": "no_gemini_key"}, status_code=500)

#         prompt = f"""You are an assistant that converts study text into concise flashcards.
# Output ONLY valid JSON between BEGIN_JSON and END_JSON markers.

# Return an ARRAY of 4 to 8 card objects. Each object should have: {{ "heading": string, "points": string[] }}.
# - heading: short title (<= 6 words).
# - points: 3-4 bullets; each bullet should be a concise fact or action (<= 12 words).

# Example:
# BEGIN_JSON
# [
#   {{"heading":"Navigating Excel","points":["Use ribbon tabs","Edit in formula bar","Cells are A1-style"]}},
#   {{"heading":"Formatting","points":["Align text","Format numbers","Use cell styles"]}}
# ]
# END_JSON

# Study Text:
# {content}"""
    
#         resp = await callGemini(prompt, {"maxOutputTokens": 800})
#         print("[generate-flashcards-gemini] callGemini ok:", resp.get("ok"), "model:", resp.get("model"))

#         if not resp.get("ok"):
#             return JSONResponse({"error": "gemini_call_failed", "detail": resp.get("text")}, status_code=502)

#         text = resp.get("data", {}).get("text", "")
#         print("[generate-flashcards-gemini] raw preview:", text[:1000])

#         markerMatch = re.search(r"BEGIN_JSON\s*([\s\S]*?)\s*END_JSON", text, re.I)
#         if markerMatch:
#             try:
#                 parsed = json.loads(markerMatch.group(1))
#                 normalized = normalizeFlashcardsShape(parsed)
#                 if normalized:
#                     return JSONResponse(normalized)
#             except Exception as err:
#                 print("[generate-flashcards-gemini] failed parse between markers", err)

#         try:
#             parsed = json.loads(text)
#             normalized = normalizeFlashcardsShape(parsed)
#             if normalized:
#                 return JSONResponse(normalized)
#         except:
#             pass

#         arrayMatch = re.search(r"\[([\s\S]*?)\]", text)
#         if arrayMatch:
#             try:
#                 parsed = json.loads(arrayMatch.group(0))
#                 normalized = normalizeFlashcardsShape(parsed)
#                 if normalized:
#                     return JSONResponse(normalized)
#             except Exception as err:
#                 print("[generate-flashcards-gemini] failed to parse extracted array", err)

#         return JSONResponse({"error": "invalid_json_from_gemini", "raw": text}, status_code=502)

#     except Exception as err:
#         print("[generate-flashcards-gemini] unexpected error", err)
#         return JSONResponse({"error": str(err)}, status_code=500)

@router.post("/generate-flashcards-gemini")
async def POST(req: Request):
    try:
        body = await req.json()

        content = str(body.get("content") or "")
        company_id = str(body.get("company_id") or "")
        user_id = str(body.get("user_id") or "")

        print(
            "[generate-flashcards-gemini] request content length:",
            len(content)
        )

        if not content.strip():
            return JSONResponse(
                {"error": "no_content_provided"},
                status_code=400
            )

        if not company_id:
            return JSONResponse(
                {"error": "company_id_required"},
                status_code=400
            )

        if not user_id:
            return JSONResponse(
                {"error": "user_id_required"},
                status_code=400
            )

        ai_response = await AI.execute(
            AIRequest(
                feature="flashcard_generation",
                company_id=company_id,
                user_id=user_id,
                route="/generate-flashcards-gemini",
                prompt_type="default",
                variables={
                    "content": content,
                },
                response_format="text",
            )
        )

        if not ai_response or not ai_response.content:
            return JSONResponse(
                {
                    "error": "flashcard_generation_failed",
                    "detail": getattr(ai_response, "error", None),
                },
                status_code=502,
            )

        text = str(ai_response.content)

        print(
            "[generate-flashcards-gemini] AI Gateway response:",
            ai_response.provider,
            ai_response.model,
            "prompt_version=",
            ai_response.prompt_version,
        )

        print(
            "[generate-flashcards-gemini] raw preview:",
            text[:1000]
        )

        markerMatch = re.search(
            r"BEGIN_JSON\s*([\s\S]*?)\s*END_JSON",
            text,
            re.I
        )

        if markerMatch:
            try:
                parsed = json.loads(markerMatch.group(1))
                normalized = normalizeFlashcardsShape(parsed)

                if normalized:
                    return JSONResponse(normalized)

            except Exception as err:
                print(
                    "[generate-flashcards-gemini] failed parse between markers",
                    err
                )

        try:
            parsed = json.loads(text)
            normalized = normalizeFlashcardsShape(parsed)

            if normalized:
                return JSONResponse(normalized)

        except Exception:
            pass

        arrayMatch = re.search(
            r"\[([\s\S]*?)\]",
            text
        )

        if arrayMatch:
            try:
                parsed = json.loads(arrayMatch.group(0))
                normalized = normalizeFlashcardsShape(parsed)

                if normalized:
                    return JSONResponse(normalized)

            except Exception as err:
                print(
                    "[generate-flashcards-gemini] failed to parse extracted array",
                    err
                )

        return JSONResponse(
            {
                "error": "invalid_json_from_ai_gateway",
                "raw": text,
            },
            status_code=502,
        )

    except Exception as err:
        print(
            "[generate-flashcards-gemini] unexpected error",
            err
        )

        return JSONResponse(
            {"error": str(err)},
            status_code=500
        )