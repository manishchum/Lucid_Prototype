import os
from dotenv import load_dotenv
load_dotenv("Backend/.env")
load_dotenv()
import asyncio
import time
import uuid
import pytest
from unittest.mock import MagicMock, patch
from fastapi import Response

from routes.auth import get_current_user_profile, _AUTH_ME_L1_CACHE, invalidate_auth_me_l1_cache
from utils.auth import RequestAuth, register_device_session


def test_concurrent_multi_tab_stampede():
    async def _test():
        user_id = str(uuid.uuid4())
        shared_device_id = f"dev-chrome-{uuid.uuid4()}"
        invalidate_auth_me_l1_cache(user_id)
        register_device_session(user_id, shared_device_id, platform="web")

        auth_ctx = RequestAuth(
            user_id=user_id,
            email="concurrent@example.com",
            source="firebase",
            company_id="comp-conc",
        )

        fake_user = {
            "user_id": user_id,
            "name": "Concurrent Tester",
            "email": "concurrent@example.com",
            "company_id": "comp-conc",
            "is_active": True,
            "company": {"name": "Concurrent Corp", "is_company_active": True}
        }

        mock_client = MagicMock()
        def table_router(table_name):
            m = MagicMock()
            if table_name == "users":
                m.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(data=fake_user)
                m.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
            elif table_name == "user_role_assignments":
                m.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
            elif table_name == "notifications":
                m.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[], count=0)
                m.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value = MagicMock(data=[])
            return m

        mock_client.table.side_effect = table_router

        with patch("routes.auth.get_service_supabase_client", return_value=mock_client):
            # Fire 10 concurrent requests at the exact same millisecond
            tasks = [
                get_current_user_profile(
                    response=Response(),
                    auth_ctx=auth_ctx,
                    x_device_id=shared_device_id,
                    x_platform="web",
                )
                for _ in range(10)
            ]

            t0 = time.time()
            results = await asyncio.gather(*tasks)
            total_time_ms = (time.time() - t0) * 1000

            # Verify all 10 completed successfully
            assert len(results) == 10
            for r in results:
                assert r["success"] is True
                assert r["userId"] == user_id
                assert r["employeeData"]["name"] == "Concurrent Tester"

            # Verify performance: 10 concurrent requests completed swiftly
            assert total_time_ms < 2500.0

    asyncio.run(_test())
