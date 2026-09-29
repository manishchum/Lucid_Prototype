"""
Locust Load Testing File for Employee Dashboard & API Endpoints
Run command:
    locust -f locustfile.py --host=http://localhost:8000
Then open browser at http://localhost:8089 to set user count & hatch rate.
"""

from locust import HttpUser, task, between
import random

TEST_USER_ID = "f0b66677-fdf3-4087-91ee-9bce94a3bee3"
TEST_COMPANY_ID = "4410e7ca-68ad-4e42-a97c-52a46e6fee6b"

class EmployeeDashboardUser(HttpUser):
    wait_time = between(0.1, 0.5)  # Simulate user pause between requests (100ms - 500ms)

    def on_start(self):
        self.headers = {
            "X-Company-ID": TEST_COMPANY_ID,
            "X-User-ID": TEST_USER_ID,
            "Accept-Encoding": "gzip",
        }

    @task(9)  # 90% read weight
    def get_dashboard_summary(self):
        self.client.get(
            f"/api/employee/dashboard_summary/{TEST_USER_ID}",
            headers=self.headers,
            name="GET /dashboard_summary (Read Path)"
        )

    @task(1)  # 10% write mutation weight (tests invalidation cycle under load)
    def simulate_module_progress(self):
        payload = {
            "user_id": TEST_USER_ID,
            "processed_module_id": "00000000-0000-0000-0000-000000000000",
            "viewOnly": True
        }
        self.client.post(
            "/api/module-progress",
            json=payload,
            headers=self.headers,
            name="POST /module-progress (Write Invalidation Path)"
        )
