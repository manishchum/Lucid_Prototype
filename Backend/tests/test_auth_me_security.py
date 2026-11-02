import asyncio
import uuid
import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException, Response

from routes.auth import get_current_user_profile, _AUTH_ME_L1_CACHE
from utils.auth import RequestAuth, register_device_session, validate_device_session
from utils.auth_socket_manager import auth_socket_manager
from utils.redis_client import redis_client


def _clear_test_caches(user_id: str):
    _AUTH_ME_L1_CACHE.pop(f"auth_me:{user_id}", None)
    try:
        redis_client.delete(f"session:{user_id}:web")
        redis_client.delete(f"session:{user_id}:mobile")
        redis_client.delete(f"ratelimit:{user_id}:auth-me")
    except Exception:
        pass


def test_attack_idor_parameter_tampering_prevented():
    """
    ATTACK SCENARIO: IDOR Parameter Injection
    An attacker attempts to tamper with request by passing another user's UUID or company UUID.
    VERIFICATION:
    Endpoint derives identity STRICTLY from verified auth_ctx. User receives only their own profile.
    """
    user_a = str(uuid.uuid4())
    user_b_victim = str(uuid.uuid4())
    _clear_test_caches(user_a)

    req_auth = RequestAuth(
        user_id=user_a,
        email="attacker@workfloww.ai",
        source="firebase",
        claims={"uid": "attacker_firebase_uid", "email": "attacker@workfloww.ai"}
    )

    mock_client = MagicMock()
    mock_client.table().select().eq().maybe_single().execute.return_value = MagicMock(
        data={
            "user_id": user_a,
            "name": "Attacker",
            "email": "attacker@workfloww.ai",
            "is_active": True,
            "company_id": "comp-attacker",
            "company": {"name": "Attacker Corp", "is_company_active": True, "subscription_tier": "tier_1", "subscription_addons": ["chat"]}
        }
    )
    mock_client.table().select().eq().execute.return_value = MagicMock(data=[])
    mock_client.table().select().eq().limit().execute.return_value = MagicMock(data=[])

    with patch("routes.auth.get_service_supabase_client", return_value=mock_client):
        res = asyncio.run(get_current_user_profile(
            response=Response(),
            auth_ctx=req_auth,
            x_device_id="dev-attacker",
            x_platform="web"
        ))
        assert res["userId"] == user_a
        assert res["userId"] != user_b_victim
        assert res["employeeData"]["email"] == "attacker@workfloww.ai"


def test_attack_stolen_token_without_device_id_blocked():
    """
    ATTACK SCENARIO: Stolen Token Replay without Device ID
    An attacker sniffs a Bearer token and attempts to call /api/auth/me without an X-Device-ID header.
    VERIFICATION:
    Endpoint detects active session in Redis and enforces X-Device-ID requirement (HTTP 401).
    """
    user_id = str(uuid.uuid4())
    _clear_test_caches(user_id)

    # Establish an active session for the legitimate user
    legit_device = "legit-browser-device-uuid"
    register_device_session(user_id, legit_device, platform="web")

    req_auth = RequestAuth(
        user_id=user_id,
        email="victim@workfloww.ai",
        source="firebase"
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(get_current_user_profile(
            response=Response(),
            auth_ctx=req_auth,
            x_device_id=None,  # Attacker omitted device ID
            x_platform="web"
        ))
    assert exc_info.value.status_code == 401
    assert "Missing X-Device-ID" in exc_info.value.detail


def test_attack_displaced_stale_session_blocked():
    """
    ATTACK SCENARIO: Displaced Stale Session Hijack
    User logs in on Browser B (displacing Browser A). Browser A attempts to call /api/auth/me.
    VERIFICATION:
    Endpoint rejects Browser A with HTTP 401 Session_Replaced.
    """
    user_id = str(uuid.uuid4())
    _clear_test_caches(user_id)

    device_a = "browser-a-uuid"
    device_b = "browser-b-uuid"

    # Browser A registers
    register_device_session(user_id, device_a, platform="web")
    # Browser B logs in and displaces Browser A
    register_device_session(user_id, device_b, platform="web")

    req_auth = RequestAuth(user_id=user_id, email="user@workfloww.ai", source="firebase")

    # Browser A tries to call /me
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(get_current_user_profile(
            response=Response(),
            auth_ctx=req_auth,
            x_device_id=device_a,
            x_platform="web"
        ))
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Session_Replaced"


def test_attack_deactivated_account_blocked():
    """
    ATTACK SCENARIO: Deactivated Employee Attempts Access
    A terminated employee with a non-expired Firebase token tries to access /api/auth/me.
    VERIFICATION:
    Endpoint immediately rejects with HTTP 403 Forbidden.
    """
    user_id = str(uuid.uuid4())
    _clear_test_caches(user_id)

    req_auth = RequestAuth(user_id=user_id, email="terminated@workfloww.ai", source="firebase")

    mock_client = MagicMock()
    mock_client.table().select().eq().maybe_single().execute.return_value = MagicMock(
        data={
            "user_id": user_id,
            "name": "Terminated User",
            "email": "terminated@workfloww.ai",
            "is_active": False,  # Deactivated
            "company_id": "comp-1"
        }
    )
    mock_client.table().select().eq().execute.return_value = MagicMock(data=[])
    mock_client.table().select().eq().limit().execute.return_value = MagicMock(data=[])

    with patch("routes.auth.get_service_supabase_client", return_value=mock_client):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(get_current_user_profile(
                response=Response(),
                auth_ctx=req_auth,
                x_device_id="dev-1",
                x_platform="web"
            ))
        assert exc_info.value.status_code == 403
        assert "deactivated" in exc_info.value.detail.lower()


def test_attack_deactivated_company_blocked():
    """
    ATTACK SCENARIO: Deactivated Company / Tenant Access
    An active employee of a delinquent/suspended company tries to access /api/auth/me.
    VERIFICATION:
    Endpoint immediately rejects with HTTP 403 Forbidden.
    """
    user_id = str(uuid.uuid4())
    _clear_test_caches(user_id)

    req_auth = RequestAuth(user_id=user_id, email="employee@bankrupt.com", source="firebase")

    mock_client = MagicMock()
    mock_client.table().select().eq().maybe_single().execute.return_value = MagicMock(
        data={
            "user_id": user_id,
            "name": "Employee",
            "email": "employee@bankrupt.com",
            "is_active": True,
            "company_id": "comp-suspended",
            "company": {"name": "Suspended Corp", "is_company_active": False}  # Suspended
        }
    )
    mock_client.table().select().eq().execute.return_value = MagicMock(data=[])
    mock_client.table().select().eq().limit().execute.return_value = MagicMock(data=[])

    with patch("routes.auth.get_service_supabase_client", return_value=mock_client):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(get_current_user_profile(
                response=Response(),
                auth_ctx=req_auth,
                x_device_id="dev-1",
                x_platform="web"
            ))
        assert exc_info.value.status_code == 403
        assert "organization" in exc_info.value.detail.lower()


def test_data_minimization_and_sensitive_fields_purged():
    """
    SECURITY AUDIT: Data Minimization & Secret Exposure
    Ensure firebase_uid, passwords, fcm_tokens, and duplicate company blocks are purged.
    """
    user_id = str(uuid.uuid4())
    _clear_test_caches(user_id)

    req_auth = RequestAuth(user_id=user_id, email="dev@workfloww.ai", source="firebase")

    mock_client = MagicMock()
    mock_client.table().select().eq().maybe_single().execute.return_value = MagicMock(
        data={
            "user_id": user_id,
            "name": "Dev",
            "email": "dev@workfloww.ai",
            "phone": "+919999999999",
            "avatar_url": None,
            "position": "Lead",
            "employment_status": "ACTIVE",
            "hire_date": "2026-01-01",
            "company_id": "comp-xyz",
            "function_id": "func-1",
            "sub_function_id": "sub-1",
            "manager_id": None,
            "firebase_uid": "SECRET_FIREBASE_UID_123",
            "password": "$2b$12$hashedpasswordthatshouldneverleak",
            "fcm_token": "secret_fcm_push_token",
            "is_active": True,
            "company": {
                "name": "Workfloww",
                "domain": "workfloww",
                "company_id": "comp-xyz",
                "company_logo": "logo.png",
                "subscription_tier": "tier_2",
                "subscription_addons": ["addon_1", "addon_2"],
                "is_company_active": True,
                "learning_style": True
            }
        }
    )
    mock_client.table().select().eq().execute.return_value = MagicMock(data=[])
    mock_client.table().select().eq().limit().execute.return_value = MagicMock(data=[])

    with patch("routes.auth.get_service_supabase_client", return_value=mock_client):
        res = asyncio.run(get_current_user_profile(
            response=Response(),
            auth_ctx=req_auth,
            x_device_id="dev-1",
            x_platform="web"
        ))

        emp = res["employeeData"]
        # Assert secrets and redundant objects are stripped
        assert "firebase_uid" not in emp, "Security Violation: firebase_uid leaked!"
        assert "password" not in emp, "Security Violation: password leaked!"
        assert "fcm_token" not in emp, "Security Violation: fcm_token leaked!"
        assert "company" not in emp, "Payload Duplication: company dict not removed!"

        # Assert flattened fields are intact
        assert emp["company_name"] == "Workfloww"
        assert emp["company_logo"] == "logo.png"
        assert emp["subscription_tier"] == "tier_2"
        assert emp["subscription_addons"] == ["addon_1", "addon_2"]
        assert emp["learning_style_enabled"] is True


def test_anti_caching_and_transport_security_headers():
    """
    SECURITY AUDIT: Anti-Caching & Proxy Leakage Defense
    Verify that response headers strictly prevent edge caching and MIME sniffing.
    """
    user_id = str(uuid.uuid4())
    _clear_test_caches(user_id)

    req_auth = RequestAuth(user_id=user_id, email="dev@workfloww.ai", source="firebase")

    mock_client = MagicMock()
    mock_client.table().select().eq().maybe_single().execute.return_value = MagicMock(
        data={
            "user_id": user_id,
            "name": "Dev",
            "email": "dev@workfloww.ai",
            "is_active": True,
            "company_id": "comp-1",
            "company": {"name": "Workfloww", "is_company_active": True}
        }
    )
    mock_client.table().select().eq().execute.return_value = MagicMock(data=[])
    mock_client.table().select().eq().limit().execute.return_value = MagicMock(data=[])

    response = Response()
    with patch("routes.auth.get_service_supabase_client", return_value=mock_client):
        asyncio.run(get_current_user_profile(
            response=response,
            auth_ctx=req_auth,
            x_device_id="dev-1",
            x_platform="web"
        ))

        headers = response.headers
        assert "no-store" in headers.get("Cache-Control", "")
        assert "private" in headers.get("Cache-Control", "")
        assert headers.get("Pragma") == "no-cache"
        assert headers.get("X-Content-Type-Options") == "nosniff"
        assert headers.get("X-Frame-Options") == "DENY"


def test_attack_rate_limit_flooding_blocked():
    """
    ATTACK SCENARIO: Brute-Force / DoS API Flooding
    Attacker fires rapid requests to /api/auth/me exceeding 120 req/min.
    VERIFICATION:
    Endpoint triggers HTTP 429 Too Many Requests with Retry-After header.
    """
    user_id = str(uuid.uuid4())
    _clear_test_caches(user_id)

    req_auth = RequestAuth(user_id=user_id, email="dev@workfloww.ai", source="firebase")

    mock_client = MagicMock()
    mock_client.table().select().eq().maybe_single().execute.return_value = MagicMock(
        data={"user_id": user_id, "is_active": True, "company_id": "c1", "company": {"is_company_active": True}}
    )
    mock_client.table().select().eq().execute.return_value = MagicMock(data=[])
    mock_client.table().select().eq().limit().execute.return_value = MagicMock(data=[])

    # Preset rate limit key to 120 (max limit)
    redis_client.set(f"ratelimit:{user_id}:auth-me", 120, ex=60)

    with patch("routes.auth.get_service_supabase_client", return_value=mock_client):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(get_current_user_profile(
                response=Response(),
                auth_ctx=req_auth,
                x_device_id="dev-1",
                x_platform="web"
            ))
        assert exc_info.value.status_code == 429
        assert "Rate limit exceeded" in exc_info.value.detail

