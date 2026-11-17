import os
import sys
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

# Prevent external network/socket issues in sandbox
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["REDIS_HOST"] = "127.0.0.1"

# Ensure Backend directory is in sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Mock redis ping to bypass DNS resolution delays during test
try:
    import redis
    redis.Redis.ping = MagicMock(return_value=True)
except Exception:
    pass

from ai.types import AIResponse
from task_manager.analyzer.pipeline import generate_task_insights
from task_manager.analyzer.text import analyze_text, analyze_mcq
from task_manager.analyzer.audio import analyze_audio_with_gemini, evaluate_audio_task_compliance
from task_manager.analyzer.vision import analyze_image, analyze_video_frames
from task_manager.analyzer.gemini_usage import extract_gemini_usage


def test_generate_task_insights_success():
    """
    Verify generate_task_insights routes through AI Gateway with feature='task_insights'
    and populates all structured outcome fields.
    """
    mock_payload = {
        "summary": "Employee demonstrated strong sales negotiation techniques.",
        "measurable_outcomes": ["Secured 15% discount limit", "Closed deal within 20 minutes"],
        "actions_taken": ["Presented value proposition", "Answered client budget objection"],
        "unique_methods": ["Used consultative questioning technique"],
        "challenges": ["Initial hesitation on pricing tier"],
        "learnings": ["Highlight SLA guarantees earlier"],
        "missing_information": [],
        "extraction_confidence": "high",
    }
    mock_response = AIResponse(
        success=True,
        content=json.dumps(mock_payload),
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
        input_tokens=300,
        output_tokens=100,
        total_tokens=400,
    )

    with patch("task_manager.analyzer.pipeline.AI.execute", new_callable=MagicMock, return_value=mock_response) as mock_exec:
        insights = generate_task_insights(
            task_title="Client Pitch",
            task_description="Pitch the enterprise tier",
            expected_answer="Address objections and close",
            analyzing_parameters="Focus on consultative sales",
            submission_type="text",
            submission_content="I pitched our product highlighting ROI and answered the client's questions.",
            evaluation_result={"overall_score": 88, "strengths": ["Clear value prop"], "weaknesses": []},
            company_id="company-123",
            user_id="user-456",
        )

        assert mock_exec.called
        req = mock_exec.call_args[0][0]
        assert req.feature == "task_insights"
        assert req.prompt_type == "default"
        assert req.response_format == "json"
        assert req.company_id == "company-123"
        assert req.user_id == "user-456"
        assert req.variables["task_title"] == "Client Pitch"
        assert "ROI" in req.variables["submission_content"]

        assert insights["summary"] == "Employee demonstrated strong sales negotiation techniques."
        assert len(insights["measurable_outcomes"]) == 2
        assert len(insights["actions_taken"]) == 2
        assert insights["extraction_confidence"] == "high"
        print("test_generate_task_insights_success: PASSED", flush=True)


def test_generate_task_insights_fallback():
    """Verify generate_task_insights returns structured fallback on error."""
    with patch("task_manager.analyzer.pipeline.AI.execute", new_callable=MagicMock, side_effect=Exception("Gateway error")):
        insights = generate_task_insights(
            task_title="Test Task",
            task_description="Test Description",
            expected_answer=None,
            analyzing_parameters=None,
            submission_type="text",
            submission_content="Some response",
            evaluation_result={},
        )

        assert insights["summary"] == "Task submission processed."
        assert insights["measurable_outcomes"] == []
        assert insights["extraction_confidence"] == "low"
        assert len(insights["missing_information"]) > 0
        print("test_generate_task_insights_fallback: PASSED", flush=True)


def test_gemini_usage_shim():
    """Verify deprecated gemini_usage shim calculates costs using central CostCalculator."""
    class FakeUsageMetadata:
        prompt_token_count = 1000
        candidates_token_count = 500
        total_token_count = 1500
        thoughts_token_count = 0
        cached_content_token_count = 0

    class FakeResponse:
        usage_metadata = FakeUsageMetadata()

    usage = extract_gemini_usage(FakeResponse(), "gemini-2.5-flash", start_time=1.0, end_time=1.5)
    assert usage["prompt_tokens"] == 1000
    assert usage["output_tokens"] == 500
    assert usage["total_tokens"] == 1500
    assert usage["pricing_available"] is True
    assert float(usage["total_cost_usd"]) > 0
    assert float(usage["total_cost_inr"]) > 0
    print("test_gemini_usage_shim: PASSED", flush=True)


def test_e2e_all_submission_types():
    """
    End-to-End sanity check verifying model-agnostic layer execution across all submission formats:
    1. Text Submission
    2. Multiple Choice (MCQ)
    3. Audio Communication Evaluation
    4. Image Task Verification
    5. Video Performance Frames
    """
    # 1. Text Submission
    text_payload = {
        "overall_score": 90,
        "sentiment": "positive",
        "key_themes": ["safety"],
        "strengths": ["Followed protocol"],
        "concerns": [],
        "recommendations": [],
        "summary": "Completed safety inspection.",
    }
    resp_text = AIResponse(
        success=True,
        content=json.dumps(text_payload),
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
    )
    with patch("task_manager.analyzer.text.AI.execute", new_callable=MagicMock, return_value=resp_text):
        res_text = analyze_text(
            task_title="Safety Drill",
            task_description="Explain evacuation",
            expected_answer="Follow exit signs",
            analyzing_parameters="Clarity",
            employee_response="We followed exit signs and assembled at point B.",
            company_id="company-123",
            user_id="user-456",
        )
        assert res_text["overall_score"] == 90
        print("E2E Check - Text Submission: PASSED", flush=True)

    # 2. MCQ Submission (rule-based local grading)
    mcq_questions = [
        {"id": "q1", "question": "What is 2+2?", "options": ["3", "4", "5"], "correct_answer": "4"}
    ]
    mcq_answers = [
        {"question_id": "q1", "selected_answer": "4"}
    ]
    res_mcq = analyze_mcq(mcq_questions, mcq_answers)
    assert res_mcq["overall_score"] == 100
    assert res_mcq["metrics"]["correct_answers"] == 1
    print("E2E Check - MCQ Submission: PASSED", flush=True)

    # 3. Audio Submission
    audio_payload = {
        "transcript": "Checking project delivery dates.",
        "tone": "clear",
        "communication_score": 85,
        "filler_words": [],
        "strengths": ["Clear speech"],
        "weaknesses": [],
        "feedback": "Well communicated.",
        "improvement_suggestions": [],
    }
    resp_audio = AIResponse(
        success=True,
        content=json.dumps(audio_payload),
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
    )
    with patch("task_manager.analyzer.audio.AI.execute", new_callable=MagicMock, return_value=resp_audio):
        res_audio = analyze_audio_with_gemini(
            audio_bytes=b"RIFF_AUDIO",
            mime_type="audio/wav",
            company_id="company-123",
            user_id="user-456",
        )
        assert res_audio["communication_score"] == 85
        assert res_audio["transcript"] == "Checking project delivery dates."
        print("E2E Check - Audio Submission: PASSED", flush=True)

    # 4. Image Submission
    image_payload = {
        "passed": True,
        "score": 95,
        "feedback": "Hard hat and vest verified.",
        "classification": "compliant",
    }
    resp_img = AIResponse(
        success=True,
        content=json.dumps(image_payload),
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
    )
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(b"IMAGE_BYTES")
        tmp_img_path = tmp.name

    try:
        with patch("task_manager.analyzer.vision.detect_objects", return_value={"objects": [{"label": "helmet", "confidence": 0.9}]}), \
             patch("task_manager.analyzer.vision.validate_image_with_task", return_value={"clip_score": 0.85, "matched": True}), \
             patch("task_manager.analyzer.vision.detect_pose", return_value={"activity": "standing"}), \
             patch("task_manager.analyzer.vision.validate_objects_with_task", return_value={"object_check_passed": True, "required_objects": ["helmet"], "missing_objects": []}), \
             patch("task_manager.analyzer.vision.extract_text", return_value={"detected_text": []}), \
             patch("task_manager.analyzer.vision.AI.execute", new_callable=MagicMock, return_value=resp_img):

            res_image = analyze_image(
                image_path=tmp_img_path,
                instruction="Wear safety helmet",
                company_id="company-123",
                user_id="user-456",
            )
            assert res_image["overall_score"] == 95
            assert res_image["model_output"]["gemini_verdict"]["passed"] is True
            print("E2E Check - Image Submission: PASSED", flush=True)
    finally:
        if os.path.exists(tmp_img_path):
            os.unlink(tmp_img_path)

    # 5. Video Frames Evaluation
    video_payload = {
        "task_completed": True,
        "person_visible": True,
        "visual_score": 85,
        "eye_contact_score": 85,
        "body_language_score": 85,
        "professionalism_score": 85,
        "engagement_score": 85,
        "strengths": ["Good presence"],
        "weaknesses": [],
        "feedback": "Good demonstration.",
    }
    resp_vid = AIResponse(
        success=True,
        content=json.dumps(video_payload),
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
    )
    with patch("task_manager.analyzer.vision.AI.execute", new_callable=MagicMock, return_value=resp_vid):
        res_video = analyze_video_frames(
            frames=[b"FRAME_1", b"FRAME_2"],
            task_description="Demonstrate safety checks",
            company_id="company-123",
            user_id="user-456",
        )
        assert res_video["task_completed"] is True
        assert res_video["visual_score"] == 85
        print("E2E Check - Video Submission: PASSED", flush=True)


if __name__ == "__main__":
    test_generate_task_insights_success()
    test_generate_task_insights_fallback()
    test_gemini_usage_shim()
    test_e2e_all_submission_types()
    print("ALL DAY 5 TESTS & END-TO-END VERIFICATIONS PASSED SUCCESSFULLY!", flush=True)

