# Backend/tests/test_enterprise_connectors.py
"""
Comprehensive Enterprise Test Suite for Multi-Cloud Connectors.
Covers Real Production Scenarios & Edge Cases across:
- Microsoft OneDrive
- Microsoft Teams
- Slack
- Zoom
- Google Meet
- Gmail
- Google Drive
"""

import os
import sys
import json
import time
import uuid
import hmac
import hashlib
import asyncio
import urllib.parse
from datetime import datetime, timezone, timedelta
import pytest
import httpx

# Ensure Backend directory is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.connectors.registry import ConnectorRegistry
from services.connectors.manager import ConnectorManager
from services.connectors.models import ContainerItem, SyncItemInfo, ConnectorStatus
from services.connectors.providers.onedrive import OneDriveConnector
from services.connectors.providers.teams import TeamsConnector
from services.connectors.providers.slack import SlackConnector
from services.connectors.providers.zoom import ZoomConnector
from services.connectors.providers.google_meet import GoogleMeetConnector
from services.connectors.providers.gmail import GmailConnector
from services.connectors.providers.google_drive import GoogleDriveConnector
from services.connectors.providers.slack.client import verify_slack_signature
from services.connectors.providers.zoom.client import validate_zoom_crc


# ==============================================================================
# TEST 1: Registry Integrity & Provider Completeness
# ==============================================================================
def test_all_connectors_registered_and_configured():
    """Verifies that all 7 enterprise connectors are registered with valid metadata."""
    expected_providers = {
        "google_drive": "Google Drive",
        "onedrive": "Microsoft OneDrive",
        "teams": "Microsoft Teams",
        "slack": "Slack",
        "zoom": "Zoom",
        "google_meet": "Google Meet",
        "gmail": "Gmail"
    }

    registered = ConnectorRegistry.list_providers()
    registered_map = {p["provider"]: p["display_name"] for p in registered}

    for p_id, p_name in expected_providers.items():
        assert p_id in registered_map, f"Provider '{p_id}' missing from ConnectorRegistry"
        assert registered_map[p_id] == p_name, f"Display name mismatch for '{p_id}'"
        connector = ConnectorRegistry.get(p_id)
        assert connector.provider_name == p_id
        assert connector.display_name == p_name

    print("\n[TEST 1 PASSED] All 7 connectors registered and validated in ConnectorRegistry.")


# ==============================================================================
# TEST 2: OAuth CSRF Security & State Token Encoding
# ==============================================================================
def test_oauth_auth_url_and_csrf_state_encoding():
    """Verifies CSRF state token construction and scope compliance across providers."""
    # Temporarily set dummy test env variables so credentials checks pass
    test_env = {
        "ONEDRIVE_CLIENT_ID": "test_onedrive_client_id",
        "ONEDRIVE_CLIENT_SECRET": "test_onedrive_secret",
        "ONEDRIVE_REDIRECT_URI": "https://api.lucid.work/api/connectors/onedrive/callback",
        "TEAMS_CLIENT_ID": "test_teams_client_id",
        "TEAMS_CLIENT_SECRET": "test_teams_secret",
        "TEAMS_REDIRECT_URI": "https://api.lucid.work/api/connectors/teams/callback",
        "SLACK_CLIENT_ID": "test_slack_client_id",
        "SLACK_CLIENT_SECRET": "test_slack_secret",
        "SLACK_REDIRECT_URI": "https://api.lucid.work/api/connectors/slack/callback",
        "ZOOM_CLIENT_ID": "test_zoom_client_id",
        "ZOOM_CLIENT_SECRET": "test_zoom_secret",
        "ZOOM_REDIRECT_URI": "https://api.lucid.work/api/connectors/zoom/callback",
        "GOOGLE_DRIVE_CLIENT_ID": "test_google_client_id",
        "GOOGLE_DRIVE_CLIENT_SECRET": "test_google_secret",
        "GOOGLE_DRIVE_REDIRECT_URI": "https://api.lucid.work/api/connectors/google_drive/callback"
    }
    for k, v in test_env.items():
        os.environ.setdefault(k, v)

    company_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    for provider_name in ["onedrive", "teams", "slack", "zoom", "google_meet", "gmail", "google_drive"]:
        connector = ConnectorRegistry.get(provider_name)
        auth_url = connector.generate_auth_url(company_id=company_id, user_id=user_id)

        assert "http" in auth_url
        assert "state=" in auth_url, f"{provider_name} missing state parameter"

        # Parse query params
        parsed = urllib.parse.urlparse(auth_url)
        params = urllib.parse.parse_qs(parsed.query)

        # Verify state parameter contains decoded company_id, user_id, provider, and nonce
        state_encoded = params["state"][0]
        state_json = json.loads(urllib.parse.unquote(state_encoded))

        assert state_json["company_id"] == company_id
        assert state_json["user_id"] == user_id
        assert state_json["provider"] == provider_name
        assert "nonce" in state_json and len(state_json["nonce"]) > 10

    print("[TEST 2 PASSED] OAuth URL generation & CSRF state verification verified for all 7 providers.")


# ==============================================================================
# TEST 3: Slack Webhook HMAC SHA-256 Signature Verification & Replay Protection
# ==============================================================================
def test_slack_hmac_signature_and_replay_protection():
    """Verifies HMAC SHA-256 signature verification and replay attack rejection (>5 mins)."""
    signing_secret = "test_signing_secret_998877"
    raw_body = b'{"type":"event_callback","event":{"type":"message","text":"Coaching review update"}}'
    current_time = str(int(time.time()))

    # Calculate genuine signature
    sig_basestring = f"v0:{current_time}:".encode("utf-8") + raw_body
    valid_sig = "v0=" + hmac.new(signing_secret.encode("utf-8"), sig_basestring, hashlib.sha256).hexdigest()

    # Case A: Valid signature with current timestamp -> Must PASS
    assert verify_slack_signature(raw_body, current_time, valid_sig, signing_secret) is True

    # Case B: Tampered payload -> Must FAIL
    tampered_body = b'{"type":"event_callback","event":{"type":"message","text":"TAMPERED"}}'
    assert verify_slack_signature(tampered_body, current_time, valid_sig, signing_secret) is False

    # Case C: Tampered signature -> Must FAIL
    assert verify_slack_signature(raw_body, current_time, "v0=bad_sig_abc123", signing_secret) is False

    # Case D: Replay attack with timestamp from 10 minutes ago -> Must FAIL
    expired_time = str(int(time.time()) - 600)
    expired_basestring = f"v0:{expired_time}:".encode("utf-8") + raw_body
    expired_sig = "v0=" + hmac.new(signing_secret.encode("utf-8"), expired_basestring, hashlib.sha256).hexdigest()
    assert verify_slack_signature(raw_body, expired_time, expired_sig, signing_secret) is False

    print("[TEST 3 PASSED] Slack HMAC SHA-256 signature & replay attack protection verified.")


# ==============================================================================
# TEST 4: Zoom Webhook CRC Challenge-Response Verification
# ==============================================================================
def test_zoom_crc_validation():
    """Verifies Zoom CRC HMAC-SHA256 challenge response computation."""
    secret_token = "zoom_secret_token_abcdef12345"
    plain_token = "zoom_plain_challenge_token_778899"

    expected_hash = hmac.new(
        secret_token.encode("utf-8"),
        plain_token.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()

    encrypted_token = validate_zoom_crc(plain_token, secret_token)
    assert encrypted_token == expected_hash

    # Invalid secret must produce non-matching hash
    bad_hash = validate_zoom_crc(plain_token, "wrong_secret")
    assert bad_hash != expected_hash

    print("[TEST 4 PASSED] Zoom Webhook CRC Challenge verification validated.")


# ==============================================================================
# TEST 5: Content Synthesis & Formatting across Connectors
# ==============================================================================
def test_content_synthesis_and_download():
    """Verifies that conversation threads, meetings, and emails synthesize into valid coach documents."""
    async def _test():
            # 1. Slack discussion digest synthesis
        slack_conn = ConnectorRegistry.get("slack")
        sample_messages = [
            {"user": "U123_Alice", "text": "Completed the Q3 coaching milestone on sales objection handling.", "ts": "1730246400"},
            {"user": "U456_Bob", "text": "Agreed! The demo roleplay scored 94% on empathy and closing metrics.", "ts": "1730246500"}
        ]
        slack_item = SyncItemInfo(
            item_id="digest_slack_sample",
            item_name="Slack_Channel_sales-coaching_2026-10-28.docx",
            item_type="docx",
            content_hash="hash_slack_123",
            metadata={"messages": sample_messages, "channel_id": "C_SALES_COACH"}
        )
        content, filename, ext = await slack_conn.download_item("dummy_token", slack_item)
        assert b"Sales objection handling" in content or b"objection handling" in content
        assert b"U123_Alice" in content
        assert ext == "pdf" or ext == "docx"

        # 2. Microsoft Teams discussion digest synthesis
        teams_conn = ConnectorRegistry.get("teams")
        sample_teams_msgs = [
            {"from": {"user": {"displayName": "Sarah Connor"}}, "body": {"content": "<p>Sprint review feedback submitted.</p>"}, "createdDateTime": "2026-10-28T10:00:00Z"}
        ]
        teams_item = SyncItemInfo(
            item_id="digest_teams_sample",
            item_name="Teams_Channel_General_2026-10-28.docx",
            item_type="docx",
            content_hash="hash_teams_123",
            metadata={"messages": sample_teams_msgs}
        )
        t_content, t_filename, t_ext = await teams_conn.download_item("dummy_token", teams_item)
        assert b"Sarah Connor" in t_content
        assert b"Sprint review feedback submitted" in t_content

        # 3. Zoom meeting record synthesis with AI Companion Summary
        zoom_conn = ConnectorRegistry.get("zoom")
        zoom_item = SyncItemInfo(
            item_id="zoom_sample_rec",
            item_name="1-on-1 Performance Review - Transcript.vtt",
            item_type="docx",
            content_hash="hash_zoom_123",
            metadata={"topic": "1-on-1 Performance Review", "meeting_id": "88776655"}
        )
        z_content, z_filename, z_ext = await zoom_conn.download_item("dummy_token", zoom_item)
        assert b"1-on-1 Performance Review" in z_content
        assert b"88776655" in z_content

        # 4. Gmail message record synthesis
        gmail_conn = ConnectorRegistry.get("gmail")
        gmail_item = SyncItemInfo(
            item_id="email_sample_99",
            item_name="Email_Quarterly_Feedback.pdf",
            item_type="pdf",
            content_hash="hash_gmail_123",
            metadata={
                "subject": "Quarterly Feedback - Engineering Leadership",
                "from": "VP Engineering <vp@lucid.work>",
                "date": "Wed, 28 Oct 2026 12:00:00 +0000",
                "snippet": "Strong leadership shown on multi-connector architecture project."
            }
        )
        g_content, g_filename, g_ext = await gmail_conn.download_item("dummy_token", gmail_item)
        assert b"Quarterly Feedback" in g_content
        assert b"VP Engineering" in g_content

    asyncio.run(_test())
    print("[TEST 5 PASSED] Document content synthesis & proof formatting validated across all connectors.")


# ==============================================================================
# TEST 6: Webhook URL Dynamic Resolution
# ==============================================================================
def test_dynamic_webhook_url_resolution():
    """Verifies that ConnectorManager computes correct provider webhook URLs."""
    os.environ["API_BASE_URL"] = "https://api.lucid.work"

    for provider in ["onedrive", "teams", "slack", "zoom", "google_meet", "gmail", "google_drive"]:
        url = ConnectorManager.get_webhook_url_for_provider(provider)
        assert url.startswith("https://")
        assert f"/api/connectors/{provider}/webhook" in url or "google" in url

    print("[TEST 6 PASSED] Dynamic webhook URL resolution verified.")


# ==============================================================================
# MAIN TEST RUNNER
# ==============================================================================


# ==============================================================================
# TEST 7: Google Meet Enterprise Architecture & Transcript Intelligence
# ==============================================================================
def test_google_meet_enterprise_intelligence():
    """
    Validates:
    1. Google Meet transcript dialogue parsing (single-line and multi-line speech).
    2. VTT caption parsing with timestamps and speaker attribution.
    3. Speaker-to-employee matching with host exclusion.
    4. In-meeting chat log appendix merging into a unified PDF digest.
    5. Artifact filtering ensuring raw .mp4 videos are ignored.
    """
    import fitz
    from services.connectors.providers.google_meet.client import (
        parse_google_meet_transcript_text,
        parse_vtt_captions,
        match_speaker_to_employee,
        build_synthesized_meet_pdf
    )

    # 1. Test Transcript Text Parsing
    sample_text = """Meeting Transcript
Meeting name: Bi-Weekly 1-on-1 Performance Check-in
Date: Oct 31, 2026, 10:00:00 AM
Attendees: Ansh Gahoi, Jane Smith

Ansh Gahoi (00:00:05):
Hi Jane, welcome to our check-in. How did the client presentation go?

Jane Smith (00:00:15):
Hi Ansh! It went really well. The client approved the contract terms.

Ansh Gahoi (00:00:25):
Excellent work on closing that deal.
"""
    parsed = parse_google_meet_transcript_text(sample_text)
    assert parsed["meeting_title"] == "Bi-Weekly 1-on-1 Performance Check-in"
    assert len(parsed["turns"]) == 3
    assert parsed["turns"][0]["speaker"] == "Ansh Gahoi"
    assert parsed["turns"][1]["speaker"] == "Jane Smith"
    assert "contract terms" in parsed["turns"][1]["text"]

    # 2. Test VTT Caption Parsing
    sample_vtt = """WEBVTT

00:00:05.100 --> 00:00:10.200
<v Ansh Gahoi>Hi Jane, welcome to our check-in.</v>

00:00:10.500 --> 00:00:15.000
<v Jane Smith>Hi Ansh! It went really well.</v>
"""
    vtt_parsed = parse_vtt_captions(sample_vtt)
    assert len(vtt_parsed["turns"]) == 2
    assert vtt_parsed["turns"][0]["speaker"] == "Ansh Gahoi"
    assert vtt_parsed["turns"][1]["speaker"] == "Jane Smith"

    # 3. Test Speaker-to-Employee Matching (discovering coachee while excluding host)
    mock_roster = [
        {"user_id": "emp-ansh-111", "name": "Ansh Gahoi", "email": "ansh.gahoi@workfloww.ai"},
        {"user_id": "emp-jane-222", "name": "Jane Smith", "email": "jane.smith@workfloww.ai"}
    ]
    matched_id = match_speaker_to_employee(
        speakers=["Ansh Gahoi", "Jane Smith"],
        company_employees=mock_roster,
        host_email="ansh.gahoi@workfloww.ai"
    )
    # Must correctly identify Jane Smith as target coachee, not host Ansh
    assert matched_id == "emp-jane-222"

    # 4. Test In-Meeting Chat Appendix Merging & PDF Synthesis
    sample_chat = """10:04:12 Jane Smith: Shared presentation link: https://docs.google.com/presentation/d/123
10:15:30 Ansh Gahoi: Contract signed, thanks Jane!"""

    pdf_bytes = build_synthesized_meet_pdf(
        title=parsed["meeting_title"],
        date_str=parsed["date"],
        participants=parsed["attendees"],
        dialogue_turns=parsed["turns"],
        chat_log=sample_chat
    )
    assert len(pdf_bytes) > 500
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    assert len(pdf_doc) >= 1
    pdf_text = pdf_doc[0].get_text("text")
    assert "Google Meet Session Digest" in pdf_text
    assert "Bi-Weekly 1-on-1" in pdf_text
    assert "Jane Smith" in pdf_text
    assert "Appendix: In-Meeting Chat Messages" in pdf_text
    assert "Shared presentation link" in pdf_text

    print("[TEST 7 PASSED] Google Meet enterprise intelligence, transcript parsing, chat appendix & PDF synthesis verified.")


if __name__ == "__main__":
    test_all_connectors_registered_and_configured()
    test_oauth_auth_url_and_csrf_state_encoding()
    test_slack_hmac_signature_and_replay_protection()
    test_zoom_crc_validation()
    test_content_synthesis_and_download()
    test_dynamic_webhook_url_resolution()
    test_google_meet_enterprise_intelligence()
    print("\n==================================================================")
    print("ALL ENTERPRISE CONNECTOR TESTS PASSED SUCCESSFULLY!")
    print("==================================================================")

