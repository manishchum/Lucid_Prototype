import sys
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
"""
Stress and Concurrency Benchmark Harness
Tests high-concurrency throughput and latency percentiles on the unified authentication
and session validation architecture for:
- 20 concurrent requests
- 100 concurrent requests
- 500 concurrent requests
- 1,000 concurrent requests
- 10,000 total requests (streaming burst)
"""

import asyncio
import os
import sys
import time
import statistics
from typing import List, Dict, Any

# Ensure Backend is on path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from dotenv import load_dotenv
load_dotenv(os.path.join(backend_dir, ".env"))

from utils.auth import (
    RequestAuth,
    validate_device_session,
    register_device_session,
    _DEVICE_SESSION_L1_CACHE
)
from routes.auth import get_current_user_profile, _AUTH_ME_L1_CACHE, invalidate_auth_me_l1_cache
from unittest.mock import MagicMock, patch


def generate_mock_db():
    fake_user = {
        "user_id": "bench-user-uuid-9999",
        "name": "Benchmark User",
        "email": "bench@lucidx.ai",
        "company_id": "bench-company-0001",
        "is_active": True,
        "company": {
            "company_id": "bench-company-0001",
            "name": "Benchmark Enterprise",
            "is_active": True,
            "is_company_active": True,
            "subscription_tier": "tier_3",
            "subscription_addons": ["task_management", "lucid_studio"]
        }
    }
    fake_roles = [
        {"is_active": True, "role_id": "role-1", "role": {"id": "role-1", "name": "Manager", "level": 2}}
    ]

    mock_client = MagicMock()
    def table_router(table_name):
        m = MagicMock()
        if table_name == "users":
            m.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(data=fake_user)
            m.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[{"user_id": "subordinate-1"}])
        elif table_name == "user_role_assignments":
            m.select.return_value.eq.return_value.execute.return_value = MagicMock(data=fake_roles)
        return m
    mock_client.table.side_effect = table_router
    return mock_client


async def simulate_single_request(auth_ctx: RequestAuth, device_id: str, platform: str) -> float:
    t0 = time.perf_counter()
    # 1. Device session validation (fast Tier-0 L1 memory)
    validate_device_session(auth_ctx.user_id, device_id, platform=platform)
    # 2. Unified profile bootstrap
    res = await get_current_user_profile(auth_ctx=auth_ctx)
    assert res["success"] is True
    t_elapsed_ms = (time.perf_counter() - t0) * 1000
    return t_elapsed_ms


async def run_concurrency_tier(name: str, total_requests: int, concurrency_limit: int, auth_ctx: RequestAuth, device_id: str) -> Dict[str, Any]:
    print(f"\n=======================================================")
    print(f"[START] Running Benchmark: {name}")
    print(f"   Total Requests: {total_requests} | Concurrency Level: {concurrency_limit}")
    print(f"=======================================================")

    semaphore = asyncio.Semaphore(concurrency_limit)
    latencies: List[float] = []
    errors: int = 0

    async def worker():
        nonlocal errors
        async with semaphore:
            try:
                lat = await simulate_single_request(auth_ctx, device_id, platform="web")
                latencies.append(lat)
            except Exception as e:
                errors += 1

    start_time = time.perf_counter()
    tasks = [asyncio.create_task(worker()) for _ in range(total_requests)]
    await asyncio.gather(*tasks)
    total_time = time.perf_counter() - start_time

    latencies.sort()
    rps = total_requests / total_time if total_time > 0 else 0
    p50 = statistics.median(latencies) if latencies else 0
    p90 = latencies[int(len(latencies) * 0.90)] if latencies else 0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
    p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0
    min_lat = latencies[0] if latencies else 0
    max_lat = latencies[-1] if latencies else 0

    results = {
        "name": name,
        "total_requests": total_requests,
        "concurrency": concurrency_limit,
        "total_time_sec": round(total_time, 3),
        "rps": round(rps, 1),
        "min_ms": round(min_lat, 3),
        "p50_ms": round(p50, 3),
        "p90_ms": round(p90, 3),
        "p95_ms": round(p95, 3),
        "p99_ms": round(p99, 3),
        "max_ms": round(max_lat, 3),
        "errors": errors,
        "success_rate_pct": round(((total_requests - errors) / total_requests) * 100, 2)
    }

    print(f"[DONE] Completed in: {results['total_time_sec']}s")
    print(f"[THROUGHPUT] Throughput:   {results['rps']} Requests/sec")
    print(f"[LATENCY] Latency P50:  {results['p50_ms']} ms")
    print(f"[LATENCY] Latency P90:  {results['p90_ms']} ms")
    print(f"[LATENCY] Latency P95:  {results['p95_ms']} ms")
    print(f"[LATENCY] Latency P99:  {results['p99_ms']} ms")
    print(f"[SUCCESS] Success Rate: {results['success_rate_pct']}% (Errors: {errors})")

    return results


async def main():
    mock_db = generate_mock_db()
    with patch("routes.auth.get_service_supabase_client", return_value=mock_db):
        user_id = "bench-user-uuid-9999"
        device_id = "bench-chrome-dev-1234"
        auth_ctx = RequestAuth(user_id=user_id, email="bench@lucidx.ai", source="firebase")

        # Prime the session
        register_device_session(user_id, device_id, platform="web")
        invalidate_auth_me_l1_cache(user_id)

        all_results = []

        # Tier 1: 20 concurrent requests
        res_20 = await run_concurrency_tier("Tier 1: 20 Concurrent Users", total_requests=20, concurrency_limit=20, auth_ctx=auth_ctx, device_id=device_id)
        all_results.append(res_20)

        # Tier 2: 100 concurrent requests
        res_100 = await run_concurrency_tier("Tier 2: 100 Concurrent Users", total_requests=100, concurrency_limit=100, auth_ctx=auth_ctx, device_id=device_id)
        all_results.append(res_100)

        # Tier 3: 500 concurrent requests
        res_500 = await run_concurrency_tier("Tier 3: 500 Concurrent Users", total_requests=500, concurrency_limit=500, auth_ctx=auth_ctx, device_id=device_id)
        all_results.append(res_500)

        # Tier 4: 1,000 concurrent requests
        res_1000 = await run_concurrency_tier("Tier 4: 1,000 Concurrent Users", total_requests=1000, concurrency_limit=1000, auth_ctx=auth_ctx, device_id=device_id)
        all_results.append(res_1000)

        # Tier 5: 10,000 requests (Streaming burst with concurrency cap of 1,000 to prevent OS socket exhaustion)
        res_10000 = await run_concurrency_tier("Tier 5: 10,000 Total Requests", total_requests=10000, concurrency_limit=1000, auth_ctx=auth_ctx, device_id=device_id)

        # Distinct Users Cold Cache Benchmark
        await run_cold_concurrency_test(total_users=100, concurrency_limit=25)
        await run_cold_concurrency_test(total_users=500, concurrency_limit=50)
        all_results.append(res_10000)

        print("\n\n" + "=" * 80)
        print("[SUMMARY] CONCURRENCY & STRESS TEST SUMMARY TABLE")
        print("=" * 80)
        print(f"{'Tier Name':<30} | {'Reqs':<6} | {'Conc':<5} | {'RPS':<10} | {'P50 (ms)':<9} | {'P95 (ms)':<9} | {'P99 (ms)':<9} | {'Success':<7}")
        print("-" * 95)
        for r in all_results:
            print(f"{r['name']:<30} | {r['total_requests']:<6} | {r['concurrency']:<5} | {r['rps']:<10} | {r['p50_ms']:<9} | {r['p95_ms']:<9} | {r['p99_ms']:<9} | {r['success_rate_pct']}%")
        print("=" * 80)



async def run_cold_concurrency_test(total_users: int, concurrency_limit: int):
    print(f"\n=======================================================")
    print(f"[START] Running Cold Cache Multi-User Test: {total_users} Distinct Users")
    print(f"   Concurrency: {concurrency_limit}")
    print(f"=======================================================")

    mock_db = generate_mock_db()
    with patch("routes.auth.get_service_supabase_client", return_value=mock_db):
        semaphore = asyncio.Semaphore(concurrency_limit)
        latencies = []
        errors = 0

        async def worker(uid: str):
            nonlocal errors
            async with semaphore:
                try:
                    auth_ctx = RequestAuth(user_id=uid, email=f"{uid}@lucidx.ai", source="firebase")
                    dev_id = f"dev-{uid}"
                    register_device_session(uid, dev_id, platform="web")
                    invalidate_auth_me_l1_cache(uid)
                    t0 = time.perf_counter()
                    validate_device_session(uid, dev_id, platform="web")
                    res = await get_current_user_profile(auth_ctx=auth_ctx)
                    assert res["success"] is True
                    latencies.append((time.perf_counter() - t0) * 1000)
                except Exception as e:
                    errors += 1

        t0_total = time.perf_counter()
        tasks = [asyncio.create_task(worker(f"user-cold-{i}")) for i in range(total_users)]
        await asyncio.gather(*tasks)
        total_time = time.perf_counter() - t0_total

        latencies.sort()
        rps = total_users / total_time if total_time > 0 else 0
        p50 = statistics.median(latencies) if latencies else 0
        p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
        p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0

        print(f"[DONE] Cold Multi-User Completed in: {round(total_time, 3)}s")
        print(f"[THROUGHPUT] Cold Throughput: {round(rps, 1)} Reqs/sec")
        print(f"[LATENCY] P50: {round(p50, 3)} ms | P95: {round(p95, 3)} ms | P99: {round(p99, 3)} ms")
        print(f"[SUCCESS] Success Rate: {round(((total_users - errors)/total_users)*100, 2)}%")

if __name__ == "__main__":
    asyncio.run(main())
