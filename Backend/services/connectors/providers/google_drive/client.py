# Backend/services/connectors/providers/google_drive/client.py
"""
Resilient Google Drive API Client with Jittered Exponential Backoff,
Rate-Limit Handling, and Enterprise Shared Drives Support.
"""

import os
import asyncio
import random
from typing import Dict, Any, Optional, Tuple
import httpx

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email"
]


def get_oauth_credentials() -> Tuple[str, str, str, str]:
    """Reads credentials from environment variables."""
    client_id = os.getenv("GOOGLE_DRIVE_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_DRIVE_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv("GOOGLE_DRIVE_REDIRECT_URI", "").strip()
    webhook_url = os.getenv("GOOGLE_DRIVE_WEBHOOK_URL", "").strip()

    if not client_id or not client_secret:
        raise ValueError("GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET is missing from environment.")

    return client_id, client_secret, redirect_uri, webhook_url


async def execute_google_api_call(
    method: str,
    url: str,
    access_token: str,
    params: Optional[Dict[str, Any]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    timeout: float = 45.0,
    max_retries: int = 4
) -> httpx.Response:
    """
    Executes an HTTP call to Google Drive API with automatic exponential backoff
    and jitter for 429, 403 (userRateLimitExceeded), and 5xx transient server errors.
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json"
    }

    # Ensure enterprise parameters for all drives support
    call_params = dict(params or {})
    if "supportsAllDrives" not in call_params and "drive/v3" in url:
        call_params["supportsAllDrives"] = "true"

    async with httpx.AsyncClient(timeout=timeout) as client:
        last_exception = None
        for attempt in range(max_retries):
            try:
                res = await client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    params=call_params,
                    json=json_data
                )

                # Success
                if res.status_code in (200, 201, 204):
                    return res

                # Check if retriable
                status = res.status_code
                is_rate_limit = status == 429
                is_server_error = status in (500, 502, 503, 504)
                is_quota_exceeded = False

                if status == 403:
                    try:
                        err_json = res.json().get("error", {})
                        errors = err_json.get("errors", [])
                        for e in errors:
                            reason = e.get("reason", "")
                            if reason in ("userRateLimitExceeded", "rateLimitExceeded"):
                                is_quota_exceeded = True
                                break
                    except Exception:
                        pass

                if (is_rate_limit or is_quota_exceeded or is_server_error) and attempt < max_retries - 1:
                    delay = (2 ** attempt) + random.uniform(0.1, 0.5)
                    print(f"[GOOGLE DRIVE CLIENT] Retrying {method} {url} in {delay:.2f}s due to status {status}")
                    await asyncio.sleep(delay)
                    continue

                return res

            except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as exc:
                last_exception = exc
                if attempt < max_retries - 1:
                    delay = (2 ** attempt) + random.uniform(0.2, 0.8)
                    await asyncio.sleep(delay)
                    continue
                raise exc

        if last_exception:
            raise last_exception
        return res
