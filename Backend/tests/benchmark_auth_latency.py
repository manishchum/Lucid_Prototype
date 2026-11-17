import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv("Backend/.env")
load_dotenv()
import asyncio
import time
import uuid
from unittest.mock import MagicMock, patch
from fastapi import Response

from routes.auth import get_current_user_profile, invalidate_auth_me_l1_cache
from utils.auth import RequestAuth, register_device_session


async def run_benchmark():
    user_id = str(uuid.uuid4())
    device_id = f"dev-{uuid.uuid4()}"
    invalidate_auth_me_l1_cache(user_id)
    register_device_session(user_id, device_id, platform="web")

    auth_ctx = RequestAuth(
        user_id=user_id,
        email="benchmark@lucid.ai",
        source="firebase",
        company_id="comp-bench",
    )

    fake_user = {
        "user_id": user_id,
        "name": "Benchmark User",
        "email": "benchmark@lucid.ai",
        "company_id": "comp-bench",
        "is_active": True,
        "company": {"company_id": "comp-bench", "name": "Benchmark Corp", "is_company_active": True}
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
        # 1. Measure Cold Path
        t0 = time.perf_counter()
        cold_res = await get_current_user_profile(
            response=Response(),
            auth_ctx=auth_ctx,
            x_device_id=device_id,
            x_platform="web",
        )
        cold_ms = (time.perf_counter() - t0) * 1000

        # 2. Measure Warm Path (L1 Cache Hits) over 50 iterations
        warm_times = []
        for _ in range(50):
            t1 = time.perf_counter()
            warm_res = await get_current_user_profile(
                response=Response(),
                auth_ctx=auth_ctx,
                x_device_id=device_id,
                x_platform="web",
            )
            warm_times.append((time.perf_counter() - t1) * 1000)

        avg_warm_ms = sum(warm_times) / len(warm_times)
        min_warm_ms = min(warm_times)
        max_warm_ms = max(warm_times)

        print("\n================ AUTH CONSOLIDATION LATENCY BENCHMARK ================")
        print(f"Cold Boot Round-Trip (Unified 5-Entity Gather): {cold_ms:.2f} ms")
        print(f"L1 Cache Warm Hit Average:                     {avg_warm_ms:.4f} ms")
        print(f"L1 Cache Warm Hit Min:                         {min_warm_ms:.4f} ms")
        print(f"L1 Cache Warm Hit Max:                         {max_warm_ms:.4f} ms")
        print("=======================================================================\n")

        assert cold_ms < 500.0, f"Cold boot exceeded 500ms: {cold_ms}ms"
        assert avg_warm_ms < 5.0, f"Average warm hit exceeded 5ms: {avg_warm_ms}ms"
        print("Latency targets verified successfully!")


if __name__ == "__main__":
    asyncio.run(run_benchmark())
