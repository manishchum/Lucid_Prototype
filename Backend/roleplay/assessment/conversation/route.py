import os
import logging
import httpx
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash-lite:generateContent"
)

TIMEOUT = httpx.Timeout(60.0, connect=10.0)


@router.post("/roleplay/conversation")
async def roleplay_conversation(request: Request):
    try:
        if not GEMINI_API_KEY:
            return JSONResponse(
                content={"error": "Gemini API key not configured"},
                status_code=500,
            )

        body = await request.json()

        message = body.get("message")
        history = body.get("conversationHistory") or []
        scenario_title = body.get("scenarioTitle") or "Roleplay"
        scenario_role = body.get("scenarioRole") or "Professional"
        initial_prompt = body.get("initialPrompt") or ""
        tone = body.get("tone") or "Neutral"

        if not message:
            return JSONResponse(
                content={"error": "Message is required"},
                status_code=400,
            )

        tone_map = {
            "Friendly": "Be warm, encouraging and supportive.",
            "Neutral": "Maintain professional and balanced tone.",
            "Aggressive": "Be skeptical and challenge the user.",
        }

        tone_instruction = tone_map.get(tone, tone_map["Neutral"])

        system_prompt = f"""
You are roleplaying as {scenario_role} in "{scenario_title}".

RULES:
- Stay fully in character.
- Never break character.
- Never provide coaching.
- Respond naturally and concisely (2-4 sentences).
- Raise realistic objections when appropriate.
- Show emotional realism.

TONE: {tone_instruction}

Background:
{initial_prompt}
""".strip()

        contents = [
            {"role": "user", "parts": [{"text": system_prompt}]}
        ]

        for msg in history:
            text = msg.get("text")
            if not text:
                continue
            contents.append({
                "role": "user" if msg.get("sender") == "user" else "model",
                "parts": [{"text": text}],
            })
        # Then append current message ONCE, outside the loop
        contents.append({
            "role": "user",
            "parts": [{"text": message}],
        })


        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"{GEMINI_URL}?key={GEMINI_API_KEY}",
                headers={"Content-Type": "application/json"},
                json={
                    "contents": contents,
                    "generationConfig": {
                        "temperature": 0.9,
                        "topK": 40,
                        "topP": 0.95,
                        "maxOutputTokens": 200,
                    },
                },
            )

        if response.status_code != 200:
            logging.error("Gemini error: %s", response.text)
            raise HTTPException(status_code=500, detail="Gemini request failed")

        data = response.json()

        ai_response = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text")
        )

        if not ai_response:
            raise HTTPException(status_code=500, detail="Empty Gemini response")

        return JSONResponse(
            content={
                "response": ai_response.strip(),
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    except Exception as e:
        logging.exception("Conversation error")
        return JSONResponse(
            content={"error": str(e)},
            status_code=500,
        )