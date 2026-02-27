import os
import json
import logging
import httpx
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


@router.post("/roleplay/conversation")
async def roleplay_conversation(request: Request):
    try:
        if not GEMINI_API_KEY:
            return JSONResponse(
                content={"error": "Gemini API key not configured"},
                status_code=500
            )

        body = await request.json()

        message = body.get("message")
        conversation_history = body.get("conversationHistory", [])
        scenario_title = body.get("scenarioTitle")
        scenario_role = body.get("scenarioRole")
        initial_prompt = body.get("initialPrompt")
        tone = body.get("tone")

        if not message:
            return JSONResponse(
                content={"error": "Message is required"},
                status_code=400
            )

        # Tone instructions
        tone_instructions = {
            "Friendly": (
                "Be warm, encouraging, and supportive in your responses. "
                "Show enthusiasm and positivity."
            ),
            "Neutral": (
                "Maintain a professional and balanced demeanor. "
                "Be business-like but not cold."
            ),
            "Aggressive": (
                "Be challenging, skeptical, and push back on ideas. "
                "Express doubts and raise tough objections."
            ),
        }

        tone_instruction = tone_instructions.get(tone, tone_instructions["Neutral"])

        # System prompt
        system_prompt = f"""
You are an expert role-play simulation engine.
You are roleplaying as a {scenario_role} in a "{scenario_title}" scenario.

CRITICAL RULES - YOU MUST FOLLOW THESE:
1. STAY IN CHARACTER as the {scenario_role} at all times
2. NEVER break character or acknowledge you are an AI
3. NEVER provide coaching, tips, or advice to the user
4. Respond naturally as the character would in this situation
5. Ask realistic questions, raise objections, express concerns
6. Keep responses conversational and concise (2-4 sentences)
7. Show realistic emotions and reactions based on what the user says
8. If the user's pitch is unclear, express confusion or ask for clarification
9. If the user handles objections well, gradually become more interested
10. Challenge the user with realistic business concerns

CHARACTER TONE: {tone_instruction}

Your character background: {initial_prompt}

Respond ONLY as the {scenario_role}. Do not provide meta-commentary or suggestions.
""".strip()

        # Build Gemini conversation payload
        messages = [
            {
                "role": "user",
                "parts": [{"text": system_prompt}],
            }
        ]

        if conversation_history:
            logging.info(
                "📜 Processing conversation history: %s messages",
                len(conversation_history),
            )
            for msg in conversation_history:
                messages.append(
                    {
                        "role": "user" if msg.get("sender") == "user" else "model",
                        "parts": [{"text": msg.get("text")}],
                    }
                )

        logging.info("📤 Sending to Gemini: %s messages total", len(messages))

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"gemini-2.5-flash-lite:generateContent?key={GEMINI_API_KEY}",
                headers={"Content-Type": "application/json"},
                json={
                    "contents": messages,
                    "generationConfig": {
                        "temperature": 0.9,
                        "topK": 40,
                        "topP": 0.95,
                        "maxOutputTokens": 200,
                    },
                },
            )

        if response.status_code != 200:
            logging.error("Gemini API error: %s", response.text)
            raise HTTPException(
                status_code=500,
                detail="Gemini API request failed",
            )

        data = response.json()

        ai_response = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text")
        )

        if not ai_response:
            raise HTTPException(
                status_code=500,
                detail="No response from Gemini API",
            )

        return JSONResponse(
            content={
                "response": ai_response,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    except Exception as e:
        logging.exception("Role-play conversation error")
        return JSONResponse(
            content={"error": str(e) or "Failed to process conversation"},
            status_code=500,
        )
