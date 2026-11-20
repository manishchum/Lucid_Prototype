import os
from dotenv import load_dotenv
load_dotenv("Backend/.env")
load_dotenv()

import asyncio
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import BackgroundTasks, HTTPException, Response

from routes.auth import (
    SendOTPRequest,
    VerifyOTPRequest,
    _AUTH_ME_L1_CACHE,
    get_current_user_profile,
    send_otp,
    verify_otp,
)
from utils.auth import (
    _DEVICE_SESSION_L1_CACHE,
    RequestAuth,
    get_request_auth_optional,
    register_device_session,
    validate_device_session,
)
from utils.auth_bridge import (
    _extract_firebase_identity,
    _resolve_user_context_by_identity,
)
from utils.db.users_db import normalize_phone
from utils.otp_service import (
    HOURLY_RESEND_LIMIT,
    check_hourly_limit,
    dispatch_sms_otp,
    generate_and_store_otp,
    normalize_phone_number,
    send_sms_otp_task,
)
from utils.redis_client import redis_client


def _make_fake_request(ip: str = "127.0.0.1"):
    req = MagicMock()
    req.headers = {"User-Agent": "okhttp/4.12.0"}
    req.client = MagicMock(host=ip)
    return req


def test_international_phone_normalization():
    # Explicit E.164 international numbers (including 10-digit total like Singapore +65)
    assert normalize_phone_number("+6581234567") == "+6581234567"
    assert normalize_phone_number("+1 415-555-2671") == "+14155552671"
    assert normalize_phone_number("+44 7700 900123") == "+447700900123"
    assert normalize_phone_number("+971501234567") == "+971501234567"
    assert normalize_phone("+6581234567") == "+6581234567"
    assert normalize_phone("+14155552671") == "+14155552671"

    # Local India defaults remain preserved
    assert normalize_phone_number("9876543210") == "+919876543210"
    assert normalize_phone_number("09876543210") == "+919876543210"
    assert normalize_phone_number("919876543210") == "+919876543210"
    assert normalize_phone("9876543210") == "+919876543210"


def test_hourly_otp_limit_is_five():
    assert HOURLY_RESEND_LIMIT == 5
    phone = f"+1555{uuid.uuid4().int % 10_000_000:07d}"
    for key in (
        f"otp:{phone}",
        f"otp_cooldown:{phone}",
        f"otp_attempts:{phone}",
        f"otp_hourly:{phone}",
    ):
        redis_client.delete(key)

    try:
        for idx in range(5):
            limited, _ = check_hourly_limit(phone)
            assert limited is False, f"Attempt {idx + 1} should be allowed under 5/hr limit"
            generate_and_store_otp(phone)

        limited_sixth, remaining = check_hourly_limit(phone)
        assert limited_sixth is True
        assert remaining > 0
    finally:
        for key in (
            f"otp:{phone}",
            f"otp_cooldown:{phone}",
            f"otp_attempts:{phone}",
            f"otp_hourly:{phone}",
        ):
            redis_client.delete(key)


def test_send_otp_rejects_deactivated_company_403():
    async def _test():
        phone = f"+1555{uuid.uuid4().int % 10_000_000:07d}"
        user_row = {
            "user_id": str(uuid.uuid4()),
            "name": "Emp",
            "email": "emp@example.com",
            "phone": phone,
            "company_id": "comp-suspended",
            "is_active": True,
            "company": {
                "company_id": "comp-suspended",
                "name": "Suspended LLC",
                "is_company_active": False,
            },
        }
        mock_client = MagicMock()
        mock_client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[user_row]
        )

        bg = BackgroundTasks()
        with (
            patch("routes.auth.check_rate_limit", new=AsyncMock()),
            patch("routes.auth.get_service_supabase_client", return_value=mock_client),
            patch("routes.auth.dispatch_sms_otp", new=AsyncMock()) as mock_dispatch,
        ):
            with pytest.raises(HTTPException) as exc:
                await send_otp(SendOTPRequest(phone=phone), bg, _make_fake_request())
            assert exc.value.status_code == 403
            assert "inactive" in exc.value.detail.lower()
            mock_dispatch.assert_not_called()

    asyncio.run(_test())


def test_verify_otp_enforces_company_active_records_login_and_invalidates_l1():
    async def _test():
        phone = f"+9199{uuid.uuid4().int % 100_000_000:08d}"
        user_id = str(uuid.uuid4())
        device_b = f"mobile-dev-b-{uuid.uuid4()}"

        # Pre-seed suspended company via Redis cache -> /verify-otp must return 403
        suspended_user = {
            "user_id": user_id,
            "name": "Suspended Emp",
            "phone": phone,
            "company_id": "comp-off",
            "firebase_uid": "fb-uid-1",
            "is_active": True,
            "company": {"company_id": "comp-off", "name": "Off Corp", "is_company_active": False},
        }
        redis_client.setex(f"otp_user:{phone}", 120, json.dumps(suspended_user))
        bg_suspended = BackgroundTasks()
        with (
            patch("routes.auth.check_rate_limit", new=AsyncMock()),
            patch("routes.auth.verify_otp_code", return_value=(True, "SUCCESS")),
            patch("routes.auth.get_service_supabase_client", return_value=MagicMock()),
        ):
            with pytest.raises(HTTPException) as exc:
                await verify_otp(
                    VerifyOTPRequest(phone=phone, otp="123456", device_id=device_b, platform="mobile"),
                    bg_suspended,
                    _make_fake_request(),
                )
            assert exc.value.status_code == 403

        # Active user & company -> succeeds, registers mobile session, notifies displacement,
        # schedules record_login_in_db in BackgroundTasks, and invalidates _AUTH_ME_L1_CACHE
        active_user = {
            "user_id": user_id,
            "name": "Active Emp",
            "email": "",
            "phone": phone,
            "company_id": "comp-on",
            "firebase_uid": "fb-uid-1",
            "is_active": True,
            "company": {"company_id": "comp-on", "name": "On Corp", "is_company_active": True},
        }
        redis_client.setex(f"otp_user:{phone}", 120, json.dumps(active_user))
        _AUTH_ME_L1_CACHE[f"auth_me:{user_id}"] = (9e12, {"stale": True})

        bg_active = BackgroundTasks()
        fake_fb_auth = MagicMock()
        fake_fb_auth.create_custom_token.return_value = b"custom-jwt-token"

        with (
            patch("routes.auth.check_rate_limit", new=AsyncMock()),
            patch("routes.auth.verify_otp_code", return_value=(True, "SUCCESS")),
            patch("routes.auth.get_service_supabase_client", return_value=MagicMock()),
            patch("routes.auth._ensure_firebase_admin_initialized"),
            patch.dict("sys.modules", {"firebase_admin": MagicMock(auth=fake_fb_auth)}),
            patch("routes.auth.auth_socket_manager.notify_session_replaced", new=AsyncMock()) as mock_notify,
        ):
            res = await verify_otp(
                VerifyOTPRequest(phone=phone, otp="123456", device_id=device_b, platform="mobile"),
                bg_active,
                _make_fake_request(),
            )
            assert res["success"] is True
            assert res["token"] == "custom-jwt-token"
            mock_notify.assert_awaited_once_with(user_id, device_b, platform="mobile")
            assert f"auth_me:{user_id}" not in _AUTH_ME_L1_CACHE
            assert any(task.func.__name__ == "record_login_in_db" and task.args == (user_id,) for task in bg_active.tasks)
            assert str(redis_client.get(f"session:{user_id}:mobile")) == device_b

        redis_client.delete(f"session:{user_id}:mobile")

    asyncio.run(_test())


def test_auth_me_bypasses_l1_session_cache_across_workers():
    """
    Simulates Worker #1 having warm L1 caches for Mobile A while Worker #2 wrote Mobile B
    directly to Redis without Worker #1 receiving Pub/Sub (Mobile A was backgrounded).
    Calling GET /api/auth/me on Worker #1 with Mobile A's device_id MUST immediately raise 401 Session_Replaced.
    """
    async def _test():
        user_id = str(uuid.uuid4())
        device_a = f"mob-a-{uuid.uuid4()}"
        device_b = f"mob-b-{uuid.uuid4()}"
        session_key = f"session:{user_id}:mobile"

        # Seed Mobile A on Worker #1 warm caches
        register_device_session(user_id, device_a, platform="mobile")
        _AUTH_ME_L1_CACHE[f"auth_me:{user_id}"] = (9e12, {"success": True, "userId": user_id})

        # Simulate Worker #2 overwriting Redis directly (Worker #1's L1 cache still points to device_a!)
        redis_client.set(session_key, device_b, ex=3600)

        # Without bypass_l1, L1 cache (<15s) wrongly accepts device_a
        validate_device_session(user_id, device_a, platform="mobile", bypass_l1=False)

        # With bypass_l1=True (used by /api/auth/me), Redis is checked and device_a is rejected immediately
        req_auth = RequestAuth(user_id=user_id, email=None, source="firebase")
        with pytest.raises(HTTPException) as exc:
            await get_current_user_profile(
                response=Response(),
                auth_ctx=req_auth,
                x_device_id=device_a,
                x_platform="mobile",
            )
        assert exc.value.status_code == 401
        assert exc.value.detail == "Session_Replaced"

        redis_client.delete(session_key)
        _AUTH_ME_L1_CACHE.pop(f"auth_me:{user_id}", None)
        _DEVICE_SESSION_L1_CACHE.pop(session_key, None)

    asyncio.run(_test())


def test_get_request_auth_optional_reraises_session_expired():
    user_id = str(uuid.uuid4())
    device_id = f"mob-expired-{uuid.uuid4()}"
    session_key = f"session:{user_id}:mobile"
    redis_client.delete(session_key)
    _DEVICE_SESSION_L1_CACHE.pop(session_key, None)

    claims = {"uid": "fb-123", "email": "emp@example.com"}
    fake_auth = RequestAuth(user_id=user_id, email="emp@example.com", source="firebase", claims=claims)

    with (
        patch("utils.auth._verify_token", return_value=claims),
        patch("utils.auth._build_request_auth_from_verified_claims", return_value=fake_auth),
    ):
        with pytest.raises(HTTPException) as exc:
            get_request_auth_optional(
                request=None,
                authorization="Bearer valid-jwt",
                x_user_id=user_id,
                x_device_id=device_id,
                x_platform="mobile",
                user_agent="okhttp/4.12.0",
                x_register_session=None,
            )
        assert exc.value.status_code == 401
        assert exc.value.detail == "Session_Expired"


def test_auth_bridge_supports_phone_only_user_without_email():
    claims = {"uid": "fb-phone-only", "phone_number": "+919876543210", "exp": 9999999999}
    email, fb_uid, phone, exp = _extract_firebase_identity(claims)
    assert email == ""
    assert fb_uid == "fb-phone-only"
    assert phone == "+919876543210"
    assert exp == 9999999999

    mock_client = MagicMock()
    user_id = str(uuid.uuid4())
    mock_client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"user_id": user_id}]
    )
    mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{
            "user_id": user_id,
            "email": None,
            "company_id": "comp-1",
            "firebase_uid": "fb-phone-only",
            "is_active": True,
        }]
    )

    ctx = _resolve_user_context_by_identity(
        mock_client,
        email="",
        firebase_uid="fb-phone-only",
        phone_number="+919876543210",
        claims=claims,
        token_exp=9999999999,
    )
    assert ctx is not None
    assert ctx.user_id == user_id
    assert ctx.email == ""
    assert ctx.company_id == "comp-1"


def test_dispatch_sms_otp_uses_background_tasks_when_arq_inactive():
    async def _test():
        # 1. Default behavior: dispatches via FastAPI BackgroundTasks (does NOT enqueue to ARQ)
        bg = BackgroundTasks()
        with (
            patch.dict(os.environ, {"OTP_USE_ARQ": "false"}, clear=False),
            patch("utils.arq_client.enqueue_job", new=AsyncMock()) as mock_enqueue,
        ):
            await dispatch_sms_otp("+919876543210", "123456", bg)
            mock_enqueue.assert_not_awaited()
            assert len(bg.tasks) == 1
            assert bg.tasks[0].func is send_sms_otp_task

        # 2. Even with OTP_USE_ARQ=true, falls back to BackgroundTasks when worker heartbeat is absent
        bg_no_worker = BackgroundTasks()
        with (
            patch.dict(os.environ, {"OTP_USE_ARQ": "true"}, clear=False),
            patch("utils.otp_service.redis_client.get", return_value=None),
            patch("utils.arq_client.enqueue_job", new=AsyncMock()) as mock_enqueue,
        ):
            await dispatch_sms_otp("+919876543210", "654321", bg_no_worker)
            mock_enqueue.assert_not_awaited()
            assert len(bg_no_worker.tasks) == 1
            assert bg_no_worker.tasks[0].func is send_sms_otp_task

        # 3. With OTP_USE_ARQ=true AND active worker heartbeat, delegates to ARQ
        bg_with_worker = BackgroundTasks()
        with (
            patch.dict(os.environ, {"OTP_USE_ARQ": "true"}, clear=False),
            patch("utils.otp_service.redis_client.get", return_value="alive"),
            patch("utils.arq_client.enqueue_job", new=AsyncMock(return_value=MagicMock(job_id="job-1"))) as mock_enqueue,
        ):
            await dispatch_sms_otp("+919876543210", "112233", bg_with_worker)
            mock_enqueue.assert_awaited_once_with("send_sms_otp_task", "+919876543210", "112233")
            assert len(bg_with_worker.tasks) == 0

    asyncio.run(_test())


