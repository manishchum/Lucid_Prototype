import os
import sys
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from unittest.mock import patch, MagicMock
from task_manager.analyzer.text import analyze_text, _parse_json_response
from ai.types import AIResponse
import numpy as np


def test_parse_json_response():
    assert _parse_json_response('{"score": 90}') == {"score": 90}
    assert _parse_json_response('```json\n{"score": 90}\n```') == {"score": 90}
    assert _parse_json_response('Analysis: {"score": 90} End') == {"score": 90}
    assert _parse_json_response('') == {}
    assert _parse_json_response(None) == {}
    print("test_parse_json_response: PASSED", flush=True)


def test_analyze_text_empty():
    res = analyze_text("Title", "Description", "Expected", "Parameters", "")
    assert res["overall_score"] == 0
    assert res["metrics"]["ai_quality_score"] == 0
    assert "Empty submission received." in res["weaknesses"]
    print("test_analyze_text_empty: PASSED", flush=True)


def test_analyze_text_ai_gateway_success():
    mock_ai_resp = AIResponse(
        success=True,
        content='{"overall_score": 92, "strengths": ["Clear evacuation steps"], "concerns": [], "recommendations": ["Keep up good work"], "summary": "Good safety answer.", "sentiment": "positive", "key_themes": ["safety", "evacuation"]}',
        provider="gemini",
        model="gemini-2.5-flash",
        prompt_version=1,
        finish_reason="STOP",
        input_tokens=150,
        output_tokens=60,
        total_tokens=210,
        latency_ms=450,
        raw_response=None
    )

    mock_bge = MagicMock()
    mock_bge.encode.return_value = np.array([1.0, 0.0, 0.0])

    with patch("task_manager.analyzer.text.AI.execute", new_callable=MagicMock, return_value=mock_ai_resp), \
         patch("task_manager.analyzer.text.get_bge_model", return_value=mock_bge):
        res = analyze_text(
            task_title="Safety",
            task_description="Drill instructions",
            expected_answer="Evacuate safely",
            analyzing_parameters="Adhere to protocol",
            employee_response="Evacuate through fire exits immediately.",
            company_id="test-company",
            user_id="test-user"
        )
        assert res["overall_score"] == 92
        assert res["metrics"]["ai_quality_score"] == 92
        assert res["strengths"] == ["Clear evacuation steps"]
        assert res["improvement_points"] == ["Keep up good work"]
        assert res["model_output"]["usage_metrics"]["total_tokens"] == 210
        assert res["model_output"]["model_name"] == "gemini-gemini-2.5-flash"
    print("test_analyze_text_ai_gateway_success: PASSED", flush=True)


def test_analyze_text_ai_gateway_fallback():
    mock_bge = MagicMock()
    mock_bge.encode.return_value = np.array([1.0, 0.0, 0.0])

    with patch("task_manager.analyzer.text.AI.execute", new_callable=MagicMock, side_effect=RuntimeError("Provider execution error")), \
         patch("task_manager.analyzer.text.get_bge_model", return_value=mock_bge):
        res = analyze_text(
            task_title="Safety",
            task_description="Drill instructions",
            expected_answer="Evacuate safely",
            analyzing_parameters="Adhere to protocol",
            employee_response="Evacuate through fire exits immediately."
        )
        assert res["overall_score"] == res["metrics"]["bge_relevance_score"]
        assert res["model_output"]["usage"]["status"] == "FALLBACK"
    print("test_analyze_text_ai_gateway_fallback: PASSED", flush=True)


if __name__ == "__main__":
    test_parse_json_response()
    test_analyze_text_empty()
    test_analyze_text_ai_gateway_success()
    test_analyze_text_ai_gateway_fallback()
    print("ALL TESTS PASSED SUCCESSFULLY!", flush=True)
