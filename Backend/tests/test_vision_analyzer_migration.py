import os
import sys
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

# Prevent ML models and external sockets from blocking in sandbox
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
from task_manager.analyzer.vision import (
    analyze_image,
    analyze_video_frames,
    _get_gemini_client,
    _parse_json_response,
)


def test_get_gemini_client_deprecated():
    """Verify _get_gemini_client is deprecated and returns None."""
    client = _get_gemini_client()
    assert client is None
    print("test_get_gemini_client_deprecated: PASSED", flush=True)


def test_analyze_video_frames_success():
    """
    Verify analyze_video_frames passes frames to AI Gateway via AIRequest(images=...)
    with prompt_type='video_frames' and returns standardized parsed scores.
    """
    mock_payload = {
        "task_completed": True,
        "person_visible": True,
        "visual_score": 88,
        "eye_contact_score": 85,
        "body_language_score": 82,
        "professionalism_score": 90,
        "engagement_score": 87,
        "strengths": ["Confident posture", "Steady eye contact"],
        "weaknesses": ["Occasional look at notes"],
        "feedback": "Strong visual presentation delivery.",
    }
    mock_response = AIResponse(
        success=True,
        content=json.dumps(mock_payload),
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
        input_tokens=250,
        output_tokens=90,
        total_tokens=340,
    )

    fake_frames = [b"JPEG_FRAME_1", b"JPEG_FRAME_2"]

    with patch("task_manager.analyzer.vision.AI.execute", new_callable=MagicMock, return_value=mock_response) as mock_exec:
        result = analyze_video_frames(
            frames=fake_frames,
            task_description="Demonstrate safety gear inspection.",
            company_id="company-123",
            user_id="user-456",
        )

        assert mock_exec.called
        req = mock_exec.call_args[0][0]
        assert req.feature == "task_evaluation_vision"
        assert req.prompt_type == "video_frames"
        assert req.response_format == "json"
        assert req.company_id == "company-123"
        assert req.user_id == "user-456"
        assert req.variables["task_description"] == "Demonstrate safety gear inspection."
        assert len(req.images) == 2
        assert req.images[0]["data"] == b"JPEG_FRAME_1"

        assert result["task_completed"] is True
        assert result["person_visible"] is True
        assert result["visual_score"] == 88
        assert result["professionalism_score"] == 90
        assert len(result["strengths"]) == 2
        assert result["feedback"] == "Strong visual presentation delivery."
        print("test_analyze_video_frames_success: PASSED", flush=True)


def test_analyze_video_frames_empty_and_fallback():
    """Verify analyze_video_frames handles empty frames list and AI Gateway failure."""
    # 1. Empty frames list
    empty_res = analyze_video_frames(frames=[], task_description="Task with no frames")
    assert empty_res["task_completed"] is False
    assert empty_res["visual_score"] == 0
    assert "No frames provided" in empty_res["weaknesses"][0]

    # 2. AI Gateway exception fallback
    with patch("task_manager.analyzer.vision.AI.execute", new_callable=MagicMock, side_effect=Exception("Timeout")):
        fallback_res = analyze_video_frames(
            frames=[b"FRAME_BYTES"],
            task_description="Task description",
        )
        assert fallback_res["task_completed"] is False
        assert fallback_res["visual_score"] == 50
        assert "Video frame evaluation unavailable." in fallback_res["weaknesses"]
        print("test_analyze_video_frames_empty_and_fallback: PASSED", flush=True)


def test_analyze_image_success():
    """
    Verify analyze_image passes image file and compact context summary through AI Gateway
    with feature='task_evaluation_vision' and prompt_type='image_verification', standardizing verdict.
    """
    mock_verdict = {
        "passed": True,
        "score": 94,
        "feedback": "Hard hat and safety vest are clearly worn.",
        "classification": "compliant_ppe",
    }
    mock_response = AIResponse(
        success=True,
        content=json.dumps(mock_verdict),
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
        input_tokens=180,
        output_tokens=50,
        total_tokens=230,
    )

    # Create temporary image file
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(b"FAKE_IMAGE_BYTES_FOR_TEST")
        tmp_path = tmp.name

    try:
        mock_objects = {"objects": [{"label": "person", "confidence": 0.95}, {"label": "helmet", "confidence": 0.88}]}
        mock_clip = {"clip_score": 0.82, "matched": True}
        mock_pose = {"activity": "standing"}
        mock_validation = {"object_check_passed": True, "required_objects": ["helmet"], "missing_objects": []}

        with patch("task_manager.analyzer.vision.detect_objects", return_value=mock_objects), \
             patch("task_manager.analyzer.vision.validate_image_with_task", return_value=mock_clip), \
             patch("task_manager.analyzer.vision.detect_pose", return_value=mock_pose), \
             patch("task_manager.analyzer.vision.validate_objects_with_task", return_value=mock_validation), \
             patch("task_manager.analyzer.vision.extract_text", return_value={"detected_text": []}), \
             patch("task_manager.analyzer.vision.AI.execute", new_callable=MagicMock, return_value=mock_response) as mock_exec:

            result = analyze_image(
                image_path=tmp_path,
                instruction="Inspect helmet and protective equipment",
                analyzing_parameters="Verify helmet is visible",
                company_id="company-123",
                user_id="user-456",
            )

            assert mock_exec.called
            req = mock_exec.call_args[0][0]
            assert req.feature == "task_evaluation_vision"
            assert req.prompt_type == "image_verification"
            assert req.response_format == "json"
            assert req.company_id == "company-123"
            assert req.user_id == "user-456"
            assert req.variables["instruction"] == "Inspect helmet and protective equipment"
            assert req.variables["analyzing_parameters"] == "Verify helmet is visible"

            # Verify evidence_summary contains objects and clip_match
            evidence = json.loads(req.variables["evidence_summary"])
            assert "helmet" in evidence["objects"] or "person" in evidence["objects"]
            assert evidence["clip_match"] == 0.82

            # Verify image payload
            assert len(req.images) == 1
            assert req.images[0]["data"] == b"FAKE_IMAGE_BYTES_FOR_TEST"

            # Verify output shape
            assert result["overall_score"] == 94
            assert "Hard hat and safety vest are clearly worn." in result["strengths"]
            assert result["model_output"]["gemini_verdict"]["passed"] is True
            assert result["model_output"]["gemini_verdict"]["classification"] == "compliant_ppe"
            print("test_analyze_image_success: PASSED", flush=True)

    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def test_analyze_image_fallback_on_error():
    """Verify analyze_image falls back to local scoring when AI Gateway fails."""
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(b"FAKE_IMAGE_BYTES")
        tmp_path = tmp.name

    try:
        mock_objects = {"objects": [{"label": "laptop", "confidence": 0.9}]}
        mock_clip = {"clip_score": 0.70, "matched": True}
        mock_pose = {"activity": "sitting"}
        mock_validation = {"object_check_passed": True, "required_objects": [], "missing_objects": []}

        with patch("task_manager.analyzer.vision.detect_objects", return_value=mock_objects), \
             patch("task_manager.analyzer.vision.validate_image_with_task", return_value=mock_clip), \
             patch("task_manager.analyzer.vision.detect_pose", return_value=mock_pose), \
             patch("task_manager.analyzer.vision.validate_objects_with_task", return_value=mock_validation), \
             patch("task_manager.analyzer.vision.extract_text", return_value={"detected_text": []}), \
             patch("task_manager.analyzer.vision.AI.execute", new_callable=MagicMock, side_effect=Exception("Gateway error")):

            result = analyze_image(
                image_path=tmp_path,
                instruction="Work at desk",
            )

            # Local fallback scores 0.70 * 100 = 70
            assert result["overall_score"] == 70
            assert any("local models" in s for s in result["strengths"])
            assert result["model_output"]["gemini_verdict"] is None
            print("test_analyze_image_fallback_on_error: PASSED", flush=True)

    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


if __name__ == "__main__":
    test_get_gemini_client_deprecated()
    test_analyze_video_frames_success()
    test_analyze_video_frames_empty_and_fallback()
    test_analyze_image_success()
    test_analyze_image_fallback_on_error()
    print("ALL 5 VISION ANALYZER TESTS PASSED SUCCESSFULLY!", flush=True)

