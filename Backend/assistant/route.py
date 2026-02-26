import os
import re
import json
import base64
import httpx
from datetime import datetime
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from supabase import create_client, Client

router = APIRouter()

supabase: Client = create_client(
    os.environ["NEXT_PUBLIC_SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)

COMMON_GEMINI_MODELS = ["gemini-3-pro-preview"]


# -----------------------------------------------------
# GEMINI CALL (MERGED gemini-helper.ts)
# -----------------------------------------------------
async def callGemini(promptText: str, opts=None):

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return {"ok": False, "status": None, "text": "no_gemini_key"}

    candidateModels = opts.get("candidateModels") if opts else None
    if not candidateModels:
        candidateModels = COMMON_GEMINI_MODELS

    maxOutputTokens = opts.get("maxOutputTokens") if opts else None
    if not maxOutputTokens:
        maxOutputTokens = 1000

    temperature = opts.get("temperature") if opts and "temperature" in opts else 0.25

    tryEndpoints = ["v1beta", "v1"]

    async with httpx.AsyncClient(timeout=120) as client:

        for model in candidateModels:

            for ep in tryEndpoints:

                base = "v1" if ep == "v1" else "v1beta"

                url = f"https://generativelanguage.googleapis.com/{base}/models/{model}:generateContent?key={key}"

                if ep == "v1":
                    bodyToSend = {
                        "prompt": {"text": promptText},
                        "temperature": temperature,
                        "maxOutputTokens": maxOutputTokens,
                        "candidateCount": 1
                    }
                else:
                    bodyToSend = {
                        "contents": [{"parts": [{"text": promptText}]}],
                        "generationConfig": {
                            "temperature": temperature,
                            "maxOutputTokens": maxOutputTokens,
                            "candidateCount": 1
                        }
                    }

                try:
                    resp = await client.post(
                        url,
                        headers={"Content-Type": "application/json"},
                        json=bodyToSend
                    )

                    text = resp.text

                    if resp.status_code >= 400:
                        print("[gemini-helper] request failed", {
                            "model": model,
                            "endpoint": ep,
                            "status": resp.status_code,
                            "bodyPreview": text[:500]
                        })
                        continue

                    try:
                        data = json.loads(text) if text else {}
                    except Exception:
                        print("[gemini-helper] invalid JSON from gemini", {
                            "model": model,
                            "endpoint": ep,
                            "preview": text[:500]
                        })
                        continue

                    genText = (
                        data.get("candidates", [{}])[0]
                        .get("content", {})
                        .get("parts", [{}])[0]
                        .get("text")
                        or data.get("output", [{}])[0].get("content")
                        or data.get("candidates", [{}])[0].get("output")
                        or ""
                    )

                    return {
                        "ok": True,
                        "model": model,
                        "endpoint": ep,
                        "data": {**data, "text": genText}
                    }

                except Exception as err:
                    print("[gemini-helper] network/exception", {
                        "model": model,
                        "endpoint": ep,
                        "err": str(err)
                    })
                    continue

    return {"ok": False, "status": None, "text": "no_model_endpoint_succeeded"}


# -----------------------------------------------------
# CLEAN FORMATTING
# -----------------------------------------------------
def cleanFormatting(s: str):
    if not s:
        return s

    out = re.sub(r"^\s*#{1,6}\s*", "", s, flags=re.M)
    out = out.replace("```", "")
    out = re.sub(r"###\s*\d+\.?", "", out)

    out = re.sub(r"(\*\*|__)(.*?)\1", r"\2", out)
    out = re.sub(r"(\*|_)(.*?)\1", r"\2", out)

    out = re.sub(r"^\s*\d+[\.)]\s+", "- ", out, flags=re.M)
    out = re.sub(r"^\s*[\*\u2022]\s+", "- ", out, flags=re.M)

    out = out.replace("**", "")

    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)

    out = "\n".join([l.strip() for l in out.split("\n")])

    out = re.sub(r"([^\n])\s+(-\s+)", r"\n\2", out)

    out = re.sub(r"\[[^\]]*?\d+[^\]]*?\]", "", out)
    out = re.sub(r"\([^\)]*?\d+[^\)]*?\)", "", out)

    return out.strip()


# -----------------------------------------------------
# MAIN ROUTE
# -----------------------------------------------------
@router.post("/assistant")
async def POST(request: Request):

    try:

        body = await request.json()

        query = str(body.get("query") or "").strip()

        mode = body.get("mode")

        userId = body.get("user_id")

        modelErrors = []

        if not query:
            return JSONResponse({"answer": "Please enter a question."})

        # ----------------------------------------
        # GREETING DETECTION
        # ----------------------------------------
        greetingRegex = r"^(hi|hello|hey|yo|good (morning|afternoon|evening))\b"

        if re.match(greetingRegex, query, re.I):

            friendly = (
                "Hi — I'm Lucid Assistant 👋\n"
                "I can help you find modules, summarize content, or answer doubts."
            )

            return JSONResponse({
                "answer": friendly,
                "llm_model_used": None,
                "llm_error": None
            })

        # ----------------------------------------
        # SEARCH MODULES
        # ----------------------------------------
        normalized = re.sub(r"[^a-z0-9\s]", " ", query.lower())

        tokens = list(set([
            t for t in normalized.split()
            if len(t) >= 3
            and t not in [
                "the", "and", "for", "with", "you",
                "how", "what", "when", "where",
                "is", "are", "in", "on", "of", "a", "an"
            ]
        ]))

        matches = []

        try:

            if tokens:

                conds = []
                for t in tokens:
                    conds.append(f"title.ilike.%{t}%")
                    conds.append(f"content.ilike.%{t}%")

                orFilter = ",".join(conds)

                res = supabase.table("processed_modules") \
                    .select("processed_module_id,title,content,original_module_id") \
                    .or_(orFilter) \
                    .limit(8) \
                    .execute()

                matches = res.data or []

        except Exception as e:
            print("[assistant] supabase search error", e)

        # ----------------------------------------
        # BUILD CONTEXT
        # ----------------------------------------
        sourceParts = ""

        if matches:

            contextParts = [
                (m.get("content") or "")[:1500]
                for m in matches
            ]

            sourceParts = "\n---\n".join(contextParts)

        # ----------------------------------------
        # SYNTHESIS PROMPT
        # ----------------------------------------
        synthSystem = (
            "You are a helpful assistant. "
            "Use the provided content but paraphrase it clearly."
        )

        synthUser = f"""
User question: {query}

Context:
{sourceParts}

Instructions:
Provide a clear answer.
Use bullet points where helpful.
Do not include citations.
"""

        # ----------------------------------------
        # CALL GEMINI
        # ----------------------------------------
        if os.environ.get("GEMINI_API_KEY"):

            gResp = await callGemini(
                synthUser,
                {
                    "candidateModels": ["gemini-3-pro-preview"],
                    "maxOutputTokens": 1500
                }
            )

            if gResp and gResp.get("ok"):

                cand = (
                    gResp["data"].get("text")
                    or ""
                )

                finalAnswer = cleanFormatting(cand)

                return JSONResponse({
                    "answer": finalAnswer,
                    "llm_model_used": "gemini-3-pro-preview",
                    "llm_error": None
                })

            else:
                modelErrors.append({
                    "model": "gemini",
                    "error": gResp.get("text")
                })

        # ----------------------------------------
        # FALLBACK
        # ----------------------------------------
        fallbackAnswer = cleanFormatting(sourceParts)

        if not fallbackAnswer:
            fallbackAnswer = "No matching content found."

        return JSONResponse({
            "answer": fallbackAnswer,
            "llm_model_used": None,
            "llm_error": modelErrors if modelErrors else None
        })

    except Exception as err:

        print("[assistant] unexpected error", err)

        return JSONResponse(
            {"error": str(err)},
            status_code=500
        )