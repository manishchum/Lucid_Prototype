import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")


def analyze_audio_with_gemini(
    audio_bytes: bytes,
    mime_type: str,
    prompt: str | None = None
):
    if not api_key:
        return {
            "transcript": "",
            "tone": "not available",
            "communication_score": 0,
            "filler_words": [],
            "strengths": [],
            "weaknesses": ["Gemini API key is not configured."],
            "feedback": "Audio was submitted, but AI audio analysis is not configured.",
            "improvement_suggestions": [],
        }

    client = genai.Client(api_key=api_key)
    analysis_prompt = prompt or (
        "You are an enterprise task communication evaluator. "
        "Transcribe the speech and analyze tone, professionalism, communication quality, "
        "sentence structure, language confidence, filler words, strengths, weaknesses, "
        "feedback, and improvement suggestions. Return STRICT JSON ONLY with keys: "
        "transcript, tone, communication_score, filler_words, strengths, weaknesses, "
        "feedback, improvement_suggestions. Scores must be 0-100."
    )

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            types.Part.from_bytes(
                data=audio_bytes,
                mime_type=mime_type
            ),
            types.Part(text=analysis_prompt)
        ],
        config=types.GenerateContentConfig(
            temperature=0.2
        )
    )

    text = response.text

    try:
        parsed = json.loads(
            text.replace("```json", "")
                .replace("```", "")
                .strip()
        )
        return {
            "transcript": parsed.get("transcript", ""),
            "tone": parsed.get("tone", ""),
            "communication_score": int(parsed.get("communication_score", 0) or 0),
            "filler_words": parsed.get("filler_words") or [],
            "strengths": parsed.get("strengths") or [],
            "weaknesses": parsed.get("weaknesses") or [],
            "feedback": parsed.get("feedback", ""),
            "improvement_suggestions": parsed.get("improvement_suggestions") or [],
        }
    except Exception:
        return {
            "transcript": "",
            "tone": "",
            "communication_score": 0,
            "filler_words": [],
            "strengths": [],
            "weaknesses": ["Gemini response could not be parsed as JSON."],
            "feedback": text,
            "improvement_suggestions": [],
        }
