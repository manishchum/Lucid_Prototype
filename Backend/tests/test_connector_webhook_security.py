# Backend/tests/test_connector_webhook_security.py
"""
Security Test Suite for Multi-Cloud Connector Webhooks & OAuth State CSRF Protection.
Verifies:
1. Rejection of unauthenticated webhooks (Google Drive, OneDrive, Gmail, Google Meet, Slack, Zoom).
2. Shared secret header enforcement (X-Webhook-Token, X-Webhook-Secret, Authorization: Bearer).
3. Rejection on mismatched or missing shared secrets.
4. Microsoft Graph validationToken handshake.
5. Slack URL verification and HMAC signature verification.
6. Zoom CRC challenge validation and HMAC event signature validation.
7. Prevention of unconstrained cross-tenant broadcast sync.
8. Rejection of OAuth callbacks with missing state parameter.
9. Rejection of OAuth callbacks with forged/unissued state parameter (CSRF / account binding defense).
10. One-time consumption of state tokens preventing replay attacks.
"""

import os
import time
import json
import hmac
import hashlib
import urllib.parse
from unittest.mock import patch, AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.connectors import router as connectors_router, persist_oauth_state, verify_and_consume_oauth_state
from services.connectors import ConnectorManager

# Configure test environment variables after loading router (to not get overridden by config.py load_dotenv)
if not os.getenv("ZOOM_WEBHOOK_SECRET_TOKEN"):
    os.environ["ZOOM_WEBHOOK_SECRET_TOKEN"] = "test_zoom_secret_token_67890"
os.environ["GOOGLE_DRIVE_WEBHOOK_SECRET"] = "gdrive_shared_secret_abc"
os.environ["ONEDRIVE_WEBHOOK_SECRET"] = "onedrive_shared_secret_def"

app = FastAPI()
app.include_router(connectors_router)
client = TestClient(app)


def test_unauthenticated_webhooks_rejected():
    """Verifies that arbitrary external POSTs without credentials receive 401 Unauthorized."""
    unauthenticated_providers = [
        "google_drive",
        "onedrive",
        "teams",
        "slack",
        "zoom",
        "google_meet",
        "gmail"
    ]

    for provider in unauthenticated_providers:
        # Empty POST
        res = client.post(f"/api/connectors/{provider}/webhook")
        assert res.status_code == 401, f"Expected 401 for unauthenticated {provider}, got {res.status_code}"

        # POST with arbitrary JSON payload
        res_json = client.post(
            f"/api/connectors/{provider}/webhook",
            json={"action": "trigger_sync_exploit", "data": "arbitrary"}
        )
        assert res_json.status_code == 401, f"Expected 401 for unauthenticated {provider} with JSON, got {res_json.status_code}"


@patch.object(ConnectorManager, "sync_company_files", new_callable=AsyncMock)
def test_shared_secret_token_accepted(mock_sync):
    """Verifies that shared secret header (X-Webhook-Token) allows authenticated webhook ingestion."""
    # 1. Valid X-Webhook-Token for Google Drive
    res = client.post(
        "/api/connectors/google_drive/webhook",
        headers={"X-Webhook-Token": "gdrive_shared_secret_abc"},
        params={"company_id": "00000000-0000-0000-0000-000000000001"}
    )
    assert res.status_code == 200
    assert res.json()["status"] == "received"
    assert res.json()["targeted_companies_count"] == 1
    mock_sync.assert_called()

    # 2. Invalid X-Webhook-Token must be rejected with 401
    res_bad = client.post(
        "/api/connectors/google_drive/webhook",
        headers={"X-Webhook-Token": "wrong_secret_token"},
        params={"company_id": "00000000-0000-0000-0000-000000000001"}
    )
    assert res_bad.status_code == 401

    # 3. Valid Authorization Bearer token for OneDrive
    res_bearer = client.post(
        "/api/connectors/onedrive/webhook",
        headers={"Authorization": "Bearer onedrive_shared_secret_def"},
        params={"company_id": "00000000-0000-0000-0000-000000000002"}
    )
    assert res_bearer.status_code == 200
    assert res_bearer.json()["targeted_companies_count"] == 1


def test_cross_tenant_broadcast_blocked_when_no_tenant_specified():
    """
    Verifies that even if an authenticated actor sends a shared-secret webhook,
    without a specific target tenant, cross-tenant broadcast is explicitly blocked.
    """
    res = client.post(
        "/api/connectors/google_drive/webhook",
        headers={"X-Webhook-Token": "gdrive_shared_secret_abc"}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ignored"
    assert "cross-tenant broadcast blocked" in data["detail"]


def test_microsoft_graph_validation_handshake():
    """Verifies that Microsoft Graph validationToken handshake returns plain text 200."""
    token = "random_validation_token_xyz_998877"
    res = client.post(f"/api/connectors/onedrive/webhook?validationToken={token}")
    assert res.status_code == 200
    assert res.text == token
    assert "text/plain" in res.headers["content-type"]


@patch.object(ConnectorManager, "sync_company_files", new_callable=AsyncMock)
def test_slack_challenge_and_hmac_verification(mock_sync):
    """Verifies Slack URL verification challenge and HMAC-SHA256 signature enforcement."""
    # 1. URL verification handshake
    challenge_payload = {"type": "url_verification", "challenge": "slack_challenge_token_55"}
    res = client.post("/api/connectors/slack/webhook", json=challenge_payload)
    assert res.status_code == 200
    assert res.json()["challenge"] == "slack_challenge_token_55"

    # 2. Regular event without signature -> 401
    event_payload = {"type": "event_callback", "event": {"type": "message"}}
    res_no_sig = client.post("/api/connectors/slack/webhook", json=event_payload)
    assert res_no_sig.status_code == 401

    # 3. Regular event with valid signature
    secret = os.getenv("SLACK_SIGNING_SECRET") or "test_slack_signing_secret_12345"
    raw_body = json.dumps(event_payload).encode("utf-8")
    current_ts = str(int(time.time()))
    sig_basestring = f"v0:{current_ts}:".encode("utf-8") + raw_body
    valid_sig = "v0=" + hmac.new(secret.encode("utf-8"), sig_basestring, hashlib.sha256).hexdigest()

    res_valid = client.post(
        "/api/connectors/slack/webhook",
        content=raw_body,
        headers={
            "Content-Type": "application/json",
            "X-Slack-Request-Timestamp": current_ts,
            "X-Slack-Signature": valid_sig
        }
    )
    assert res_valid.status_code == 200


@patch.object(ConnectorManager, "sync_company_files", new_callable=AsyncMock)
def test_zoom_crc_and_event_signature(mock_sync):
    """Verifies Zoom CRC challenge response and HMAC event signature validation."""
    secret = os.getenv("ZOOM_WEBHOOK_SECRET_TOKEN") or "test_zoom_secret_token_67890"

    # 1. CRC challenge validation
    crc_payload = {"event": "endpoint.url_validation", "payload": {"plainToken": "plain_zoom_tok"}}
    res_crc = client.post("/api/connectors/zoom/webhook", json=crc_payload)
    assert res_crc.status_code == 200
    assert res_crc.json()["plainToken"] == "plain_zoom_tok"
    expected_enc = hmac.new(secret.encode("utf-8"), b"plain_zoom_tok", hashlib.sha256).hexdigest()
    assert res_crc.json()["encryptedToken"] == expected_enc

    # 2. Event without signature -> 401
    event_body = json.dumps({"event": "recording.completed", "payload": {}}).encode("utf-8")
    res_no_sig = client.post(
        "/api/connectors/zoom/webhook",
        content=event_body,
        headers={"Content-Type": "application/json"}
    )
    assert res_no_sig.status_code == 401

    # 3. Event with valid signature
    current_ts = str(int(time.time()))
    msg = f"v0:{current_ts}:".encode("utf-8") + event_body
    valid_sig = "v0=" + hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()

    res_valid = client.post(
        "/api/connectors/zoom/webhook",
        content=event_body,
        headers={
            "Content-Type": "application/json",
            "x-zm-request-timestamp": current_ts,
            "x-zm-signature": valid_sig
        }
    )
    assert res_valid.status_code == 200


def test_oauth_state_missing_rejected():
    """Callbacks without a state parameter are rejected with 400."""
    res = client.get("/api/connectors/slack/callback?code=fake_auth_code")
    assert res.status_code == 400
    assert "Invalid, unknown, or expired OAuth state token" in res.text


def test_oauth_state_forged_rejected():
    """Callbacks with unpersisted / forged state parameters are rejected with 400 (prevents CSRF/account binding)."""
    forged_state = json.dumps({
        "company_id": "00000000-0000-0000-0000-000000000099",
        "user_id": "00000000-0000-0000-0000-000000000088",
        "provider": "slack",
        "nonce": "forged_attacker_nonce_1234567890"
    })
    res = client.get(f"/api/connectors/slack/callback?code=fake_auth_code&state={urllib.parse.quote(forged_state)}")
    assert res.status_code == 400
    assert "Invalid, unknown, or expired OAuth state token" in res.text


def test_oauth_state_verified_and_consumed_prevents_replay():
    """
    1. Persist genuine state via persist_oauth_state
    2. First callback verification succeeds and consumes the token
    3. Second callback attempt with the same state is rejected (prevents replay attacks)
    """
    company_id = "00000000-0000-0000-0000-000000000001"
    user_id = "00000000-0000-0000-0000-000000000002"
    dummy_auth_url = (
        "https://slack.com/oauth/v2/authorize?"
        + urllib.parse.urlencode({
            "client_id": "test_client",
            "state": json.dumps({
                "company_id": company_id,
                "user_id": user_id,
                "provider": "slack",
                "nonce": "genuine_nonce_abcdef1234567890"
            })
        })
    )

    # 1. Persist state
    token = persist_oauth_state(
        provider="slack",
        company_id=company_id,
        user_id=user_id,
        auth_url=dummy_auth_url
    )
    assert token is not None

    state_param = json.dumps({
        "company_id": company_id,
        "user_id": user_id,
        "provider": "slack",
        "nonce": "genuine_nonce_abcdef1234567890"
    })

    # 2. First verification: must succeed and return record
    record = verify_and_consume_oauth_state("slack", state_param)
    assert record is not None
    assert record["company_id"] == company_id
    assert record["user_id"] == user_id
    assert record["provider"] == "slack"

    # 3. Second verification: token was consumed, must return None (replay rejected)
    replay_record = verify_and_consume_oauth_state("slack", state_param)
    assert replay_record is None


def test_oauth_state_cross_provider_tampering_rejected():
    """State issued for 'slack' cannot be used for 'zoom' callback."""
    company_id = "00000000-0000-0000-0000-000000000001"
    user_id = "00000000-0000-0000-0000-000000000002"
    dummy_auth_url = (
        "https://slack.com/oauth/v2/authorize?"
        + urllib.parse.urlencode({
            "client_id": "test_client",
            "state": json.dumps({
                "company_id": company_id,
                "user_id": user_id,
                "provider": "slack",
                "nonce": "cross_prov_nonce_9876543210"
            })
        })
    )

    persist_oauth_state("slack", company_id, user_id, dummy_auth_url)

    state_param = json.dumps({
        "company_id": company_id,
        "user_id": user_id,
        "provider": "slack",
        "nonce": "cross_prov_nonce_9876543210"
    })

    # Attempt to consume using provider 'zoom'
    mismatched = verify_and_consume_oauth_state("zoom", state_param)
    assert mismatched is None


if __name__ == "__main__":
    test_unauthenticated_webhooks_rejected()
    print("[TEST 1 PASSED] Unauthenticated webhooks rejected across all 7 providers.")
    test_shared_secret_token_accepted()
    print("[TEST 2 PASSED] Shared secret verification (X-Webhook-Token & Bearer) verified.")
    test_cross_tenant_broadcast_blocked_when_no_tenant_specified()
    print("[TEST 3 PASSED] Cross-tenant broadcast blocking verified.")
    test_microsoft_graph_validation_handshake()
    print("[TEST 4 PASSED] Microsoft Graph validationToken handshake verified.")
    test_slack_challenge_and_hmac_verification()
    print("[TEST 5 PASSED] Slack challenge and HMAC signature verified.")
    test_zoom_crc_and_event_signature()
    print("[TEST 6 PASSED] Zoom CRC challenge and event HMAC signature verified.")
    test_oauth_state_missing_rejected()
    print("[TEST 7 PASSED] Missing OAuth state rejected on callback.")
    test_oauth_state_forged_rejected()
    print("[TEST 8 PASSED] Forged/unissued OAuth state rejected on callback (CSRF/account binding prevented).")
    test_oauth_state_verified_and_consumed_prevents_replay()
    print("[TEST 9 PASSED] OAuth state verification & one-time consumption (replay prevention) verified.")
    test_oauth_state_cross_provider_tampering_rejected()
    print("[TEST 10 PASSED] Cross-provider OAuth state tampering rejected.")
    print("\n==================================================================")
    print("ALL CONNECTOR WEBHOOK & OAUTH CSRF SECURITY TESTS PASSED!")
    print("==================================================================")
