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

        logging.info("Assessment request received with %d messages", len(messages))
        
        # Filter messages
        user_messages = [m for m in messages if m.get("sender") == "user"]
        ai_messages = [m for m in messages if m.get("sender") == "avatar"]
        
        logging.info("Filtered messages - users: %d, ai: %d", len(user_messages), len(ai_messages))

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

Analyze the LEARNER's performance and provide a detailed assessment in this EXACT JSON format:

{{
  "overallScore": <number between 0-100>,
  "summary": "<detailed summary of overall performance>",
  "parameters": [
    {{
      "name": "Communication Clarity",
      "score": <number between 0-100>,
      "feedback": "<specific feedback>"
    }},
    {{
      "name": "Eye Contact & Engagement",
      "score": <number between 0-100>,
      "feedback": "<specific feedback>"
    }},
    {{
      "name": "Hand Gestures & Body Language",
      "score": <number between 0-100>,
      "feedback": "<specific feedback>"
    }},
    {{
      "name": "Facial Expressions",
      "score": <number between 0-100>,
      "feedback": "<specific feedback>"
    }},
    {{
      "name": "Objection Handling",
      "score": <number between 0-100>,
      "feedback": "<specific feedback>"
    }},
    {{
      "name": "Value Proposition",
      "score": <number between 0-100>,
      "feedback": "<specific feedback>"
    }},
    {{
      "name": "Active Listening",
      "score": <number between 0-100>,
      "feedback": "<specific feedback>"
    }},
    {{
      "name": "Confidence & Professionalism",
      "score": <number between 0-100>,
      "feedback": "<specific feedback>"
    }}
  ],
  "recommendations": [
    "<recommendation 1>",
    "<recommendation 2>",
    "<recommendation 3>",
    "<recommendation 4>"
  ]
}}

Provide ONLY the JSON object with these exact keys: overallScore, summary, parameters, recommendations. No additional text before or after.
"""

        async with httpx.AsyncClient() as client:
            try:
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
                    timeout=30.0
                )
            except httpx.TimeoutException:
                logging.error("Gemini API timeout after 30 seconds")
                raise HTTPException(status_code=503, detail="Gemini API timeout - please try again")
            except Exception as e:
                logging.error("Gemini API connection error: %s", str(e))
                raise HTTPException(status_code=503, detail="Failed to connect to Gemini API")

        if response.status_code != 200:
            error_detail = response.text
            logging.error("Gemini API error (status %d): %s", response.status_code, error_detail)
            
            # Check for rate limit or quota issues
            if response.status_code == 429:
                raise HTTPException(status_code=429, detail="Gemini API rate limited - please try again later")
            elif response.status_code == 403:
                raise HTTPException(status_code=503, detail="Gemini API access denied - check API key")
            else:
                raise HTTPException(status_code=500, detail=f"Gemini API error: {error_detail[:100]}")

        try:
            data = response.json()
        except json.JSONDecodeError:
            logging.error("Failed to parse Gemini response: %s", response.text[:500])
            raise HTTPException(status_code=500, detail="Invalid response from Gemini API")

        assessment_text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text")
        )

        if not assessment_text:
            logging.error("No assessment text in Gemini response: %s", json.dumps(data, indent=2)[:500])
            raise HTTPException(status_code=500, detail="No response from Gemini API")

        # Remove markdown fences
        assessment_text = re.sub(r"```json\n?|```", "", assessment_text).strip()

        try:
            assessment = json.loads(assessment_text)
        except json.JSONDecodeError:
            logging.error("Failed to parse assessment JSON: %s", assessment_text)
            raise HTTPException(status_code=500, detail="Failed to parse assessment report")

        # Log the assessment structure for debugging
        logging.info("Assessment keys: %s", list(assessment.keys()))
        logging.info("Full assessment: %s", json.dumps(assessment, indent=2))

        if not all(k in assessment for k in ("overallScore", "summary", "parameters", "recommendations")):
            missing_keys = [k for k in ("overallScore", "summary", "parameters", "recommendations") if k not in assessment]
            logging.error("Missing required keys: %s. Available keys: %s", missing_keys, list(assessment.keys()))
            raise HTTPException(status_code=500, detail=f"Invalid assessment report structure. Missing: {missing_keys}")

        return JSONResponse(content=assessment)

    except json.JSONDecodeError as e:
        logging.error("JSON decode error: %s", str(e))
        logging.error("Raw assessment text: %s", assessment_text if 'assessment_text' in locals() else "N/A")
        return JSONResponse(
            content={"error": "Failed to parse assessment - invalid JSON format"},
            status_code=500
        )
    except Exception as e:
        logging.exception("Assessment generation error")
        logging.error("Exception details: %s", str(e))
        return JSONResponse(
            content={"error": str(e) or "Failed to generate assessment"},
            status_code=500
        )
