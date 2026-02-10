import os
import json
import re
import logging
import httpx
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


@router.post("/roleplay/assessment")
async def generate_assessment(request: Request):
    try:
        if not GEMINI_API_KEY:
            return JSONResponse(
                content={"error": "Gemini API key not configured"},
                status_code=500
            )

        body = await request.json()

        messages = body.get("messages")
        scenario_title = body.get("scenarioTitle")
        scenario_role = body.get("scenarioRole")
        user_role = body.get("userRole")

        if not messages or len(messages) == 0:
            return JSONResponse(
                content={"error": "Conversation messages are required"},
                status_code=400
            )

        # Filter messages
        user_messages = [m for m in messages if m.get("sender") == "user"]
        ai_messages = [m for m in messages if m.get("sender") == "avatar"]

        min_exchanges = 3
        min_user_messages = 2

        # Short / incomplete conversation → zero score
        if len(user_messages) < min_user_messages or len(messages) < min_exchanges * 2:
            logging.warning(
                "⚠️ Conversation too short - returning zero score",
                extra={
                    "totalMessages": len(messages),
                    "userMessages": len(user_messages),
                    "aiMessages": len(ai_messages),
                }
            )

            return JSONResponse(
                content={
                    "overallScore": 0,
                    "summary": (
                        "The conversation was ended abruptly or was too short to provide "
                        "a meaningful assessment. Please complete a full roleplay session "
                        "with at least 3-4 exchanges to receive proper feedback."
                    ),
                    "parameters": [
                        {"name": "Communication Clarity", "score": 0,
                         "feedback": "Insufficient conversation to evaluate communication skills."},
                        {"name": "Eye Contact & Engagement", "score": 0,
                         "feedback": "Session ended too early to assess engagement levels."},
                        {"name": "Hand Gestures & Body Language", "score": 0,
                         "feedback": "Not enough interaction to evaluate body language."},
                        {"name": "Facial Expressions", "score": 0,
                         "feedback": "Session too brief to assess facial expressions."},
                        {"name": "Objection Handling", "score": 0,
                         "feedback": "No sufficient interaction to evaluate objection handling."},
                        {"name": "Value Proposition", "score": 0,
                         "feedback": "Conversation ended before value proposition could be assessed."},
                        {"name": "Active Listening", "score": 0,
                         "feedback": "Insufficient dialogue to assess listening skills."},
                        {"name": "Confidence & Professionalism", "score": 0,
                         "feedback": "Not enough interaction to evaluate confidence and professionalism."},
                    ],
                    "recommendations": [
                        "Complete a full roleplay session without ending it prematurely.",
                        "Engage in at least 4-5 exchanges with the LT to demonstrate your skills.",
                        "Practice maintaining the conversation until a natural conclusion is reached.",
                        "Use the session duration effectively to showcase your abilities.",
                    ],
                }
            )

        learner_role = user_role or "Learner"
        ai_role = scenario_role or "AI Coach"

        transcript = "\n\n".join(
            f"{learner_role if m.get('sender') == 'user' else ai_role}: {m.get('text')}"
            for m in messages
        )

        assessment_prompt = f"""
You are an expert communication and sales coach analyzing a role-play conversation.

Scenario: {scenario_title}
Learner's Role: {learner_role} (the person being evaluated)
AI Coach's Role: {ai_role} (the practice partner)

CRITICAL INSTRUCTION: You are evaluating the LEARNER ({learner_role}), NOT the AI Coach.

Conversation Transcript:
{transcript}

Analyze the LEARNER's performance and provide a detailed assessment in JSON format.

Provide ONLY the JSON object, no additional text.
"""

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"gemini-2.5-flash-lite:generateContent?key={GEMINI_API_KEY}",
                headers={"Content-Type": "application/json"},
                json={
                    "contents": [
                        {
                            "role": "user",
                            "parts": [{"text": assessment_prompt}],
                        }
                    ],
                    "generationConfig": {
                        "temperature": 0.4,
                        "topK": 40,
                        "topP": 0.95,
                        "maxOutputTokens": 2048,
                    },
                },
            )

        if response.status_code != 200:
            logging.error("Gemini API error: %s", response.text)
            raise HTTPException(status_code=500, detail="Gemini API request failed")

        data = response.json()

        assessment_text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text")
        )

        if not assessment_text:
            raise HTTPException(status_code=500, detail="No response from Gemini API")

        # Remove markdown fences
        assessment_text = re.sub(r"```json\n?|```", "", assessment_text).strip()

        try:
            assessment = json.loads(assessment_text)
        except json.JSONDecodeError:
            logging.error("Failed to parse assessment JSON: %s", assessment_text)
            raise HTTPException(status_code=500, detail="Failed to parse assessment report")

        if not all(k in assessment for k in ("overallScore", "summary", "parameters", "recommendations")):
            raise HTTPException(status_code=500, detail="Invalid assessment report structure")

        return JSONResponse(content=assessment)

    except Exception as e:
        logging.exception("Assessment generation error")
        return JSONResponse(
            content={"error": str(e) or "Failed to generate assessment"},
            status_code=500
        )
