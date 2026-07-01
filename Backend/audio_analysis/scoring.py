from __future__ import annotations

from typing import Any


def _score(value: Any, fallback: int = 0) -> int:
    try:
        return int(max(0, min(100, round(float(value)))))
    except Exception:
        return fallback


def generate_audio_score(
    gemini_result: dict[str, Any],
    acoustic_result: dict[str, Any],
    speech_result: dict[str, Any],
) -> dict[str, Any]:
    communication = _score(gemini_result.get("communication_score"), 70)
    clarity = _score(speech_result.get("clarity_score"), communication)
    pronunciation = _score(speech_result.get("pronunciation_score"), clarity)
    pace = _score(acoustic_result.get("pace_score"), 70)

    filler_words = gemini_result.get("filler_words") or []
    filler_penalty = min(20, len(filler_words) * 2) if isinstance(filler_words, list) else 0
    confidence = _score(communication - filler_penalty, communication)
    fluency = _score((communication * 0.45) + (pace * 0.35) + (clarity * 0.2), communication)
    overall = _score(
        (clarity * 0.18)
        + (confidence * 0.18)
        + (fluency * 0.2)
        + (pronunciation * 0.18)
        + (pace * 0.16)
        + (communication * 0.1),
        communication,
    )

    return {
        "transcript": gemini_result.get("transcript") or "",
        "scores": {
            "clarity": clarity,
            "confidence": confidence,
            "fluency": fluency,
            "pronunciation": pronunciation,
            "pace": pace,
            "overall": overall,
        },
        "audio_features": {
            "duration": acoustic_result.get("duration", 0),
            "silence_ratio": acoustic_result.get("silence_ratio", 0),
            "speaking_speed": acoustic_result.get("speaking_pace")
            or acoustic_result.get("pace_score", 0),
            "average_volume": acoustic_result.get("average_volume", 0),
            "pause_count": acoustic_result.get("pause_count", 0),
        },
        "tone": gemini_result.get("tone") or "not available",
        "filler_words": filler_words if isinstance(filler_words, list) else [],
        "strengths": gemini_result.get("strengths") or [],
        "weaknesses": gemini_result.get("weaknesses") or [],
        "feedback": gemini_result.get("feedback") or "",
        "improvement_suggestions": gemini_result.get("improvement_suggestions") or [],
    }
