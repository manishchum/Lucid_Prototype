import os
from dotenv import load_dotenv
load_dotenv("Backend/.env")
load_dotenv()
import asyncio
import time
import uuid
import pytest
from unittest.mock import MagicMock, patch
from fastapi import Response, HTTPException

from routes.auth import get_current_user_profile, _AUTH_ME_L1_CACHE, invalidate_auth_me_l1_cache
from utils.auth import RequestAuth, register_device_session, validate_device_session
from utils.redis_client import redis_client


def test_consolidated_payload_structure_and_atomic_registration():
    async def _test():
        user_id = str(uuid.uuid4())
        device_id = f"dev-{uuid.uuid4()}"
        invalidate_auth_me_l1_cache(user_id)
        redis_client.delete(f"session:{user_id}:web")

        auth_ctx = RequestAuth(
            user_id=user_id,
            email="developer@example.com",
            source="firebase",
            company_id="comp-100",
        )

        fake_user = {
            "user_id": user_id,
            "name": "Jane Developer",
            "email": "developer@example.com",
            "position": "Lead Architect",
            "company_id": "comp-100",
            "is_active": True,
            "company": {
                "company_id": "comp-100",
                "name": "Lucid Technologies",
                "domain": "lucid.ai",
                "company_logo": "https://lucid.ai/logo.png",
                "subscription_tier": "tier_3",
                "subscription_addons": ["lucid_studio", "task_management"],
                "is_company_active": True,
                "learning_style": True,
            }
        }

        fake_roles = [
            {"is_active": True, "role_id": "r1", "role": {"id": "r1", "name": "Developer", "level": 6}}
        ]

        fake_notifications = [
            {"id": f"notif-{i}", "title": f"Title {i}", "message": f"Message {i}", "type": "task", "metadata": {}, "read": False, "created_at": "2026-11-03T12:00:00Z"}
            for i in range(5)
        ]

        mock_client = MagicMock()
        def table_router(table_name):
            m = MagicMock()
            if table_name == "users":
                m.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(data=fake_user)
                m.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
            elif table_name == "user_role_assignments":
                m.select.return_value.eq.return_value.execute.return_value = MagicMock(data=fake_roles)
            elif table_name == "notifications":
                m.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=fake_notifications, count=5)
                m.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value = MagicMock(data=fake_notifications)
            elif table_name == "companies":
                m.select.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(data=[fake_user["company"]])
            return m

        mock_client.table.side_effect = table_router

        with patch("routes.auth.get_service_supabase_client", return_value=mock_client):
            # 1. Call /me with x_register_session = "true"
            res = await get_current_user_profile(
                response=Response(),
                auth_ctx=auth_ctx,
                x_device_id=device_id,
                x_platform="web",
                x_register_session="true",
            )

            # Verify Top-Level Structure
            assert res["success"] is True
            assert res["userId"] == user_id
            assert res["isDeveloper"] is True
            assert "Developer" in res["userRoles"]

            # Verify Employee Data Sanitization
            assert res["employeeData"]["name"] == "Jane Developer"
            assert res["employeeData"]["company_name"] == "Lucid Technologies"
            assert "firebase_uid" not in res["employeeData"]
            assert "company" not in res["employeeData"]

            # Verify Consolidated Tenant Payload
            assert "tenant" in res
            assert res["tenant"]["activeCompany"]["company_id"] == "comp-100"
            assert res["tenant"]["activeCompany"]["name"] == "Lucid Technologies"
            assert isinstance(res["tenant"]["availableCompanies"], list)
            assert len(res["tenant"]["availableCompanies"]) >= 1

            # Verify Consolidated Notifications Payload
            assert "notifications" in res
            assert res["notifications"]["unread_count"] == 5
            assert len(res["notifications"]["items"]) == 5

            # Verify that Session was registered in Redis
            active_device = redis_client.get(f"session:{user_id}:web")
            assert active_device is not None
            assert str(active_device) == device_id

            # Verify TTL is sliding (approx 3600 seconds)
            ttl = redis_client.ttl(f"session:{user_id}:web")
            assert 3500 <= ttl <= 3600

    asyncio.run(_test())


def test_non_developer_sees_only_own_company():
    async def _test():
        user_id = str(uuid.uuid4())
        device_id = f"dev-{uuid.uuid4()}"
        invalidate_auth_me_l1_cache(user_id)
        register_device_session(user_id, device_id, platform="web")

        auth_ctx = RequestAuth(
            user_id=user_id,
            email="employee@example.com",
            source="firebase",
            company_id="comp-employee",
        )

        fake_user = {
            "user_id": user_id,
            "name": "Bob Employee",
            "email": "employee@example.com",
            "company_id": "comp-employee",
            "is_active": True,
            "company": {
                "company_id": "comp-employee",
                "name": "Standard Corp",
                "is_company_active": True,
            }
        }

        mock_client = MagicMock()
        def table_router(table_name):
            m = MagicMock()
            if table_name == "users":
                m.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(data=fake_user)
                m.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
            elif table_name == "user_role_assignments":
                m.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[
                    {"is_active": True, "role": {"name": "Employee", "level": 1}}
                ])
            elif table_name == "notifications":
                m.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[], count=0)
                m.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value = MagicMock(data=[])
            return m

        mock_client.table.side_effect = table_router

        with patch("routes.auth.get_service_supabase_client", return_value=mock_client):
            res = await get_current_user_profile(
                response=Response(),
                auth_ctx=auth_ctx,
                x_device_id=device_id,
                x_platform="web",
            )

            assert res["isDeveloper"] is False
            assert res["isSuperAdmin"] is False
            assert len(res["tenant"]["availableCompanies"]) == 1
            assert res["tenant"]["availableCompanies"][0]["company_id"] == "comp-employee"

    asyncio.run(_test())
