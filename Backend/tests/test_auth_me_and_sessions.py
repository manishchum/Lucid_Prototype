import os
from dotenv import load_dotenv
load_dotenv("Backend/.env")
load_dotenv()
import asyncio
import time
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi import HTTPException

from utils.auth import RequestAuth, validate_device_session, register_device_session, _DEVICE_SESSION_L1_CACHE
from utils.auth_socket_manager import auth_socket_manager
from routes.auth import _AUTH_ME_L1_CACHE, invalidate_auth_me_l1_cache


# ==============================================================================
# 1. Unit & Integration Tests: Session Partitioning (1 Web & 1 Mobile)
# ==============================================================================

def test_session_partitioning_web_and_mobile_isolation():
    """
    Verifies that:
    1. A user can have 1 active Web session and 1 active Mobile session concurrently.
    2. Logging in on Mobile does NOT displace Web.
    3. Logging in on Web does NOT displace Mobile.
    4. Multiple tabs with the same device_id on Web do not displace each other.
    5. A new device_id on Web displaces the previous Web session.
    6. A new device_id on Mobile displaces the previous Mobile session.
    """
    test_user = "test-user-partition-uuid-1234"
    web_device_1 = "web-chrome-tab-1"
    web_device_2 = "web-firefox-browser-2"
    mobile_device_1 = "mobile-iphone-1"
    mobile_device_2 = "mobile-android-2"

    # Step 1: Register Web Device 1
    register_device_session(test_user, web_device_1, platform="web")
    validate_device_session(test_user, web_device_1, platform="web")

    # Step 2: Register Mobile Device 1
    register_device_session(test_user, mobile_device_1, platform="mobile")
    validate_device_session(test_user, mobile_device_1, platform="mobile")

    # Step 3: Web Device 1 must STILL be valid! (Mobile did not displace Web)
    validate_device_session(test_user, web_device_1, platform="web")

    # Step 4: Same browser (multiple tabs sharing web_device_1) must remain valid
    validate_device_session(test_user, web_device_1, platform="web")

    # Step 5: User logs in from Web Device 2 (new browser)
    register_device_session(test_user, web_device_2, platform="web")
    validate_device_session(test_user, web_device_2, platform="web")

    # Web Device 1 should now be displaced and raise Session_Replaced (HTTP 401)
    with pytest.raises(HTTPException) as exc_info:
        validate_device_session(test_user, web_device_1, platform="web")
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Session_Replaced"

    # Step 6: Mobile Device 1 must STILL be valid! (Web displacement did not touch Mobile)
    validate_device_session(test_user, mobile_device_1, platform="mobile")

    # Step 7: User logs in from Mobile Device 2
    register_device_session(test_user, mobile_device_2, platform="mobile")
    validate_device_session(test_user, mobile_device_2, platform="mobile")

    # Mobile Device 1 should now be displaced
    with pytest.raises(HTTPException) as exc_info_mobile:
        validate_device_session(test_user, mobile_device_1, platform="mobile")
    assert exc_info_mobile.value.status_code == 401
    assert exc_info_mobile.value.detail == "Session_Replaced"

    # Web Device 2 must STILL be active
    validate_device_session(test_user, web_device_2, platform="web")


# ==============================================================================
# 2. WebSocket Platform Isolation
# ==============================================================================

def test_auth_socket_manager_platform_isolation():
    async def _test():
        user_id = "test-ws-user-5678"
        web_ws = AsyncMock()
        mobile_ws = AsyncMock()

        # Register both web and mobile sockets
        await auth_socket_manager.register(user_id, "web-dev-1", web_ws, platform="web")
        await auth_socket_manager.register(user_id, "mobile-dev-1", mobile_ws, platform="mobile")

        # Displace web sessions with a new web device
        await auth_socket_manager._displace_local_sockets(user_id, "web-dev-2", platform="web")

        # web_ws must have received force_logout and close
        web_ws.send_json.assert_called_once()
        payload = web_ws.send_json.call_args[0][0]
        assert payload["type"] == "force_logout"
        assert payload["platform"] == "web"
        web_ws.close.assert_called_once_with(code=4001)

        # mobile_ws must NOT be closed!
        mobile_ws.send_json.assert_not_called()
        mobile_ws.close.assert_not_called()

        # Clean up
        await auth_socket_manager.unregister(user_id, "mobile-dev-1", mobile_ws, platform="mobile")

    asyncio.run(_test())


# ==============================================================================
# 3. /api/auth/me Endpoint Tests
# ==============================================================================

def test_auth_me_active_user_success():
    async def _test():
        from routes.auth import get_current_user_profile

        fake_auth = RequestAuth(
            user_id="user-111",
            email="test@example.com",
            source="firebase",
            company_id="company-999"
        )

        fake_user_row = {
            "user_id": "user-111",
            "name": "Alex Developer",
            "email": "test@example.com",
            "company_id": "company-999",
            "is_active": True,
            "company": {
                "company_id": "company-999",
                "name": "Acme Corp",
                "is_active": True,
                "is_company_active": True,
                "subscription_tier": "tier_3",
                "subscription_addons": ["task_management", "lucid_studio"]
            }
        }

        fake_roles = [
            {"is_active": True, "role_id": "role-1", "role": {"id": "role-1", "name": "Developer", "level": 6}}
        ]

        with patch("routes.auth.get_service_supabase_client") as mock_db:
            mock_client = MagicMock()
            mock_db.return_value = mock_client

            def table_router(table_name):
                if table_name == "users":
                    m = MagicMock()
                    m.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(data=fake_user_row)
                    m.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
                    return m
                elif table_name == "user_role_assignments":
                    m = MagicMock()
                    m.select.return_value.eq.return_value.execute.return_value = MagicMock(data=fake_roles)
                    return m
                return MagicMock()

            mock_client.table.side_effect = table_router

            # Clear L1 cache before test
            invalidate_auth_me_l1_cache("user-111")

            result = await get_current_user_profile(auth_ctx=fake_auth)

            assert result["success"] is True
            assert result["userId"] == "user-111"
            assert result["employeeData"]["name"] == "Alex Developer"
            assert result["employeeData"]["company_name"] == "Acme Corp"
            assert result["isDeveloper"] is True
            assert result["isAdmin"] is True  # level >= 3
            assert "Developer" in result["userRoles"]

            # Verify second call hits L1 cache instantly
            t0 = time.time()
            cached_result = await get_current_user_profile(auth_ctx=fake_auth)
            t_elapsed = (time.time() - t0) * 1000
            assert cached_result == result
            assert t_elapsed < 5.0  # Under 5ms

    asyncio.run(_test())


def test_auth_me_deactivated_user_raises_403():
    async def _test():
        from routes.auth import get_current_user_profile

        fake_auth = RequestAuth(user_id="user-inactive", email="inactive@example.com", source="firebase")
        fake_user_row = {"user_id": "user-inactive", "is_active": False}

        with patch("routes.auth.get_service_supabase_client") as mock_db:
            mock_client = MagicMock()
            mock_db.return_value = mock_client
            mock_client.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(data=fake_user_row)
            mock_client.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
            mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])

            invalidate_auth_me_l1_cache("user-inactive")

            with pytest.raises(HTTPException) as exc:
                await get_current_user_profile(auth_ctx=fake_auth)
            assert exc.value.status_code == 403
            assert "deactivated" in exc.value.detail.lower()

    asyncio.run(_test())


def test_auth_me_deactivated_company_raises_403():
    async def _test():
        from routes.auth import get_current_user_profile

        fake_auth = RequestAuth(user_id="user-bad-comp", email="emp@badcomp.com", source="firebase")
        fake_user_row = {
            "user_id": "user-bad-comp",
            "is_active": True,
            "company": {"company_id": "c-inactive", "is_active": False, "is_company_active": False}
        }

        with patch("routes.auth.get_service_supabase_client") as mock_db:
            mock_client = MagicMock()
            mock_db.return_value = mock_client
            mock_client.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(data=fake_user_row)
            mock_client.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
            mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])

            invalidate_auth_me_l1_cache("user-bad-comp")

            with pytest.raises(HTTPException) as exc:
                await get_current_user_profile(auth_ctx=fake_auth)
            assert exc.value.status_code == 403
            assert "organization account has been deactivated" in exc.value.detail.lower()

    asyncio.run(_test())
