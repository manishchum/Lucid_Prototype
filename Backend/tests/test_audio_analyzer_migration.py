import os
import sys
import json
from pathlib import Path

# Prevent ML models and external sockets from blocking in sandbox
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["REDIS_HOST"] = "127.0.0.1"

# Ensure Backend directory is in sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from unittest.mock import patch, MagicMock

# Mock redis ping to bypass DNS resolution delays during test
try:
    import redis
    redis.Redis.ping = MagicMock(return_value=True)
except Exception:
    pass

from ai.types import AIResponse
from task_manager.analyzer.audio import (
    analyze_audio_with_gemini,
    evaluate_audio_task_compliance,
    evaluate_task_compliance_with_gemini,
    generate_audio_score,
)


def test_analyze_audio_with_gemini_success():
    mock_payload = {
        "transcript": "Hello team, this is our quarterly client update.",
        "tone": "confident and professional",
        "communication_score": 88,
        "filler_words": ["um", "like"],
        "strengths": ["Clear articulation", "Structured narrative"],
        "weaknesses": ["Minor pauses before numbers"],
        "feedback": "Overall great communication and pacing.",
        "improvement_suggestions": ["Rehearse statistical points to reduce hesitation."],
    }
    mock_response = AIResponse(
        success=True,
        content=json.dumps(mock_payload),
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
        input_tokens=150,
        output_tokens=70,
        total_tokens=220,
    )

    with patch("task_manager.analyzer.audio.AI.execute", new_callable=MagicMock, return_value=mock_response) as mock_exec:
        result = analyze_audio_with_gemini(
            audio_bytes=b"RIFF_FAKE_AUDIO_DATA",
            mime_type="audio/wav",
            company_id="company-123",
            user_id="user-456",
        )

        assert mock_exec.called
        req = mock_exec.call_args[0][0]
        assert req.feature == "task_evaluation_audio"
        assert req.prompt_type == "communication"
        assert req.response_format == "json"
        assert req.company_id == "company-123"
        assert req.user_id == "user-456"
        assert req.files == [{"mime_type": "audio/wav", "data": b"RIFF_FAKE_AUDIO_DATA"}]

        assert result["transcript"] == "Hello team, this is our quarterly client update."
        assert result["tone"] == "confident and professional"
        assert result["communication_score"] == 88
        assert result["filler_words"] == ["um", "like"]
        assert len(result["strengths"]) == 2
        assert len(result["improvement_suggestions"]) == 1
        print("test_analyze_audio_with_gemini_success: PASSED", flush=True)


def test_analyze_audio_with_gemini_fallback_on_error():
    with patch("task_manager.analyzer.audio.AI.execute", new_callable=MagicMock, side_effect=Exception("Gateway timeout")):
        result = analyze_audio_with_gemini(
            audio_bytes=b"EMPTY_OR_CORRUPT",
            mime_type="audio/webm",
        )

        assert result["transcript"] == ""
        assert result["communication_score"] == 0
        assert result["tone"] == "not available"
        assert isinstance(result["weaknesses"], list)
        assert len(result["weaknesses"]) > 0
        assert "Gateway timeout" in result["weaknesses"][0]
        print("test_analyze_audio_with_gemini_fallback_on_error: PASSED", flush=True)


def test_evaluate_audio_task_compliance_success():
    mock_payload = {
        "score": 92,
        "passed": True,
        "criteria": [
            {
                "requirement": "Mention project deadline",
                "satisfied": True,
                "evidence": "deadline is Friday November 14",
            },
            {
                "requirement": "Address budget allocation",
                "satisfied": True,
                "evidence": "budget allocated is 50k",
            },
        ],
        "feedback": "All requirements clearly met in the speech transcript.",
    }
    mock_response = AIResponse(
        success=True,
        content=json.dumps(mock_payload),
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
        input_tokens=200,
        output_tokens=60,
        total_tokens=260,
    )

    with patch("task_manager.analyzer.audio.AI.execute", new_callable=MagicMock, return_value=mock_response) as mock_exec:
        result = evaluate_audio_task_compliance(
            transcript="Our project deadline is Friday November 14 and budget allocated is 50k.",
            task_title="Status Update Call",
            task_description="Explain deadline and budget.",
            analyzing_parameters="Check for date and budget mentions.",
            expected_answer="Deadline Friday and 50k budget.",
            company_id="company-123",
            user_id="user-456",
        )

        assert mock_exec.called
        req = mock_exec.call_args[0][0]
        assert req.feature == "task_evaluation_audio"
        assert req.prompt_type == "compliance"
        assert req.response_format == "json"
        assert req.variables["task_title"] == "Status Update Call"
        assert req.variables["expected_answer"] == "Deadline Friday and 50k budget."
        assert "50k" in req.variables["transcript"]

        assert result["score"] == 92
        assert result["passed"] is True
        assert len(result["criteria"]) == 2
        assert result["criteria"][0]["satisfied"] is True
        assert result["feedback"] == "All requirements clearly met in the speech transcript."
        print("test_evaluate_audio_task_compliance_success: PASSED", flush=True)


def test_evaluate_task_compliance_alias_and_fallback():
    assert evaluate_task_compliance_with_gemini is evaluate_audio_task_compliance

    mock_response = AIResponse(
        success=True,
        content="Invalid non-json response text from model",
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
        input_tokens=100,
        output_tokens=20,
        total_tokens=120,
    )

    with patch("task_manager.analyzer.audio.AI.execute", new_callable=MagicMock, return_value=mock_response):
        result = evaluate_task_compliance_with_gemini(
            transcript="Short transcript",
            task_title="Test Task",
            task_description="Description",
        )

        assert result["score"] == 50
        assert result["passed"] is False
        assert result["criteria"] == []
        assert "unavailable" in result["feedback"]
        print("test_evaluate_task_compliance_alias_and_fallback: PASSED", flush=True)


def test_generate_audio_score_integration():
    gemini_result = {
        "transcript": "Test audio transcript",
        "tone": "confident",
        "communication_score": 85,
        "filler_words": ["um"],
        "strengths": ["Clear voice"],
        "weaknesses": [],
        "feedback": "Great delivery.",
        "improvement_suggestions": [],
    }
    acoustic_result = {
        "duration": 12.5,
        "silence_ratio": 0.1,
        "pace_score": 80,
        "average_volume": 0.05,
        "pause_count": 2,
    }
    speech_result = {
        "clarity_score": 90,
        "pronunciation_score": 88,
    }

    scored = generate_audio_score(gemini_result, acoustic_result, speech_result)
    assert scored["transcript"] == "Test audio transcript"
    assert scored["scores"]["overall"] > 70
    assert scored["tone"] == "confident"
    assert scored["filler_words"] == ["um"]
    print("test_generate_audio_score_integration: PASSED", flush=True)


if __name__ == "__main__":
    test_analyze_audio_with_gemini_success()
    test_analyze_audio_with_gemini_fallback_on_error()
    test_evaluate_audio_task_compliance_success()
    test_evaluate_task_compliance_alias_and_fallback()
    test_generate_audio_score_integration()
    print("ALL 5 AUDIO ANALYZER TESTS PASSED SUCCESSFULLY!", flush=True)
