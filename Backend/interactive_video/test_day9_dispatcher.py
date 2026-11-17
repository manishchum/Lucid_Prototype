"""
Day 9 Milestone Verification: Smart Multi-Tenant Video Dispatcher Test
Tests the routing of POST /api/gpt-video:
1. Validates subscription_addons detection (lucid_studio_video_interactive vs lucid_studio_video_slides).
2. Validates unified response contract:
   - videoUrl
   - videoUrls (dict with 'en', 'hi', 'hinglish')
   - videoUrlHinglish
   - video_url
   - video_url_hinglish
3. Verifies frontend worker and employee page contracts.
"""
import sys
import os
import unittest
from unittest.mock import patch, AsyncMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from gpt_video_generation.route import router
from interactive_video.models import ParsedDocumentContext

app = FastAPI()
app.include_router(router, prefix="/api")
client = TestClient(app)

TEST_MODULE_ID = "7ed57f14-b7a7-4fd7-872f-002ff4eb7cda"


def test_missing_module_id():
    print("\n--- Test 1: Missing Module ID Validation ---")
    resp = client.post("/api/gpt-video", json={})
    assert resp.status_code == 400
    assert resp.json()["error"] == "Missing module ID"
    print("  [PASSED] Correctly returns 400 for missing module ID")


def test_interactive_video_dispatch():
    print("\n--- Test 2: Dispatch to Interactive Video Pipeline ---")
    mock_ctx = ParsedDocumentContext(
        processed_module_id=TEST_MODULE_ID,
        original_module_id=TEST_MODULE_ID,
        module_title="Business Planning",
        clean_content="Test content...",
        headings=["Introduction"],
        word_count=50,
        estimated_duration_minutes=3.5,
        company_id="comp_123",
        company_name="Workfloww",
        company_logo="",
        subscription_addons=["lucid_studio_video", "lucid_studio_video_interactive"],
        images=[]
    )

    with patch("interactive_video.document_parser.parse_document_context", new_callable=AsyncMock) as mock_parse, \
         patch("interactive_video.pipeline.run_pipeline", new_callable=AsyncMock) as mock_run, \
         patch("utils.supabase_client.supabase_admin.table") as mock_table:

        mock_parse.return_value = mock_ctx
        mock_run.return_value = True

        # Mock interactive_video_jobs insert
        mock_table.return_value.insert.return_value.execute.return_value.data = [{"id": "test_job_123"}]

        # Mock interactive_video_courses query
        mock_table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "manifest": {
                "course_id": "course_abc123",
                "video_url": "https://storage.supabase.co/module-visuals/7ed/interactive/final_en.mp4",
                "video_url_hinglish": "https://storage.supabase.co/module-visuals/7ed/interactive/final_hinglish.mp4"
            }
        }

        resp = client.post("/api/gpt-video", json={"processed_module_id": TEST_MODULE_ID})
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()

        print("  Response:", data)
        # Verify unified response contract
        assert data.get("interactive") is True, "Must mark interactive as True"
        assert data.get("videoUrl") == "https://storage.supabase.co/module-visuals/7ed/interactive/final_en.mp4"
        assert data.get("videoUrlHinglish") == "https://storage.supabase.co/module-visuals/7ed/interactive/final_hinglish.mp4"
        assert data["videoUrls"]["en"] == data["videoUrl"]
        assert data["videoUrls"]["hi"] == data["videoUrlHinglish"]
        assert data["videoUrls"]["hinglish"] == data["videoUrlHinglish"]
        assert data.get("video_url") == data["videoUrl"]

        # Verify frontend employee page contract (page.tsx:2983)
        assert data["videoUrl"] and data["videoUrlHinglish"], "Employee page needs videoUrl and videoUrlHinglish"
        # Verify worker contract (generate-module-video.js:191)
        assert (data.get("videoUrl") or data.get("video_url")), "Worker needs videoUrl or video_url"
        print("  [PASSED] Interactive Video pipeline dispatch & contract verified")


def test_standard_slides_video_dispatch():
    print("\n--- Test 3: Dispatch to Standard Slides Video Engine ---")
    mock_ctx = ParsedDocumentContext(
        processed_module_id=TEST_MODULE_ID,
        original_module_id=TEST_MODULE_ID,
        module_title="Business Planning",
        clean_content="Test content...",
        headings=["Introduction"],
        word_count=50,
        estimated_duration_minutes=3.5,
        company_id="comp_123",
        company_name="Workfloww",
        company_logo="",
        subscription_addons=["lucid_studio_video", "lucid_studio_video_slides"],  # standard slides addon
        images=[]
    )

    with patch("interactive_video.document_parser.parse_document_context", new_callable=AsyncMock) as mock_parse, \
         patch("gpt_video_generation.route.generateVideo", new_callable=AsyncMock) as mock_gen_video:

        mock_parse.return_value = mock_ctx
        mock_gen_video.return_value = {
            "videoUrl": "https://storage.supabase.co/module-visuals/7ed/slides_video_en.mp4",
            "videoUrls": {
                "en": "https://storage.supabase.co/module-visuals/7ed/slides_video_en.mp4",
                "hi": "https://storage.supabase.co/module-visuals/7ed/slides_video_hi.mp4",
                "hinglish": "https://storage.supabase.co/module-visuals/7ed/slides_video_hi.mp4"
            }
        }

        resp = client.post("/api/gpt-video", json={"processed_module_id": TEST_MODULE_ID})
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()

        print("  Response:", data)
        # Verify unified response contract
        assert data.get("interactive") is False, "Must mark interactive as False"
        assert data.get("videoUrl") == "https://storage.supabase.co/module-visuals/7ed/slides_video_en.mp4"
        assert data.get("videoUrlHinglish") == "https://storage.supabase.co/module-visuals/7ed/slides_video_hi.mp4"
        assert data["videoUrls"]["en"] == data["videoUrl"]
        assert data.get("video_url") == data["videoUrl"]

        # Verify frontend employee page contract (page.tsx:2983)
        assert data["videoUrl"], "Employee page needs videoUrl"
        # Verify worker contract (generate-module-video.js:191)
        assert (data.get("videoUrl") or data.get("video_url")), "Worker needs videoUrl or video_url"
        print("  [PASSED] Standard Slides Video engine dispatch & contract verified")


if __name__ == "__main__":
    print("=" * 70)
    print("DAY 9: SMART API DISPATCHER & FRONTEND INTEGRATION TEST")
    print("=" * 70)
    test_missing_module_id()
    test_interactive_video_dispatch()
    test_standard_slides_video_dispatch()
    print("\n" + "=" * 70)
    print("ALL DAY 9 DISPATCHER TESTS PASSED SUCCESSFULLY!")
    print("=" * 70)
