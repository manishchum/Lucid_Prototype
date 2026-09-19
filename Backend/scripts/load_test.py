import time
import statistics
import concurrent.futures
import sys
import os

backend_dir = r"d:\workfloww.ai\Lucid_Prototype\Backend"
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
os.chdir(backend_dir)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from fastapi.testclient import TestClient
from main import app
from utils.auth import get_request_auth_required, RequestAuth, get_effective_company_id

TEST_USER_ID = "f0b66677-fdf3-4087-91ee-9bce94a3bee3"
TEST_COMPANY_ID = "4410e7ca-68ad-4e42-a97c-52a46e6fee6b"

# Dependency Override for Load Testing Authentication
def override_get_request_auth_required():
    return RequestAuth(
        user_id=TEST_USER_ID,
        email="test@lucid.ai",
        source="test",
        company_id=TEST_COMPANY_ID
    )

def override_get_effective_company_id():
    return TEST_COMPANY_ID

app.dependency_overrides[get_request_auth_required] = override_get_request_auth_required
app.dependency_overrides[get_effective_company_id] = override_get_effective_company_id

client = TestClient(app)

CONCURRENT_WORKERS = 50
TOTAL_REQUESTS = 500

headers = {
    "X-Company-ID": TEST_COMPANY_ID,
    "X-User-ID": TEST_USER_ID,
    "Accept-Encoding": "gzip",
}

url = f"/api/employee/dashboard_summary/{TEST_USER_ID}"

def send_request():
    t0 = time.perf_counter()
    try:
        response = client.get(url, headers=headers)
        t1 = time.perf_counter()
        return (response.status_code == 200, (t1 - t0) * 1000, response.status_code)
    except Exception:
        t1 = time.perf_counter()
        return (False, (t1 - t0) * 1000, 500)

def run_load_test():
    print("=" * 70)
    print(f"  BENCHMARKING FASTAPI BACKEND LOAD & THROUGHPUT")
    print(f"  Parameters: {TOTAL_REQUESTS} Requests | {CONCURRENT_WORKERS} Concurrent Threads")
    print("=" * 70)
    
    # Warmup request
    send_request()

    start_time = time.perf_counter()
    latencies = []
    status_codes = {}
    success_count = 0
    failure_count = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_WORKERS) as executor:
        futures = [executor.submit(send_request) for _ in range(TOTAL_REQUESTS)]
        
        for future in concurrent.futures.as_completed(futures):
            success, latency, status_code = future.result()
            latencies.append(latency)
            status_codes[status_code] = status_codes.get(status_code, 0) + 1
            if success:
                success_count += 1
            else:
                failure_count += 1

    total_time = time.perf_counter() - start_time
    rps = TOTAL_REQUESTS / total_time
    
    latencies.sort()
    min_lat = latencies[0]
    max_lat = latencies[-1]
    avg_lat = statistics.mean(latencies)
    p50_lat = latencies[int(len(latencies) * 0.50)]
    p95_lat = latencies[int(len(latencies) * 0.95)]
    p99_lat = latencies[int(len(latencies) * 0.99)]

    print(f"\nLOAD TEST RESULTS:")
    print(f"  - Total Execution Time: {total_time:.2f} seconds")
    print(f"  - Throughput (RPS): {rps:.2f} requests/sec")
    print(f"  - Successful Requests (200 OK): {success_count} ({success_count/TOTAL_REQUESTS*100:.1f}%)")
    print(f"  - Status Code Distribution: {status_codes}")
    print(f"\nLATENCY PERCENTILES:")
    print(f"  - Min Latency: {min_lat:.2f} ms")
    print(f"  - p50 (Median): {p50_lat:.2f} ms")
    print(f"  - Average: {avg_lat:.2f} ms")
    print(f"  - p95: {p95_lat:.2f} ms")
    print(f"  - p99: {p99_lat:.2f} ms")
    print(f"  - Max Latency: {max_lat:.2f} ms")
    print("=" * 70)

if __name__ == "__main__":
    run_load_test()
