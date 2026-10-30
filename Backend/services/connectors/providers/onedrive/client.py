# Backend/services/connectors/providers/onedrive/client.py
"""
Resilient Microsoft Graph Client for OneDrive & SharePoint.
Handles Entra ID OAuth2, Rate Limiting (429 Retry-After), and Exponential Backoff.
"""

import os
import asyncio
import random
from typing import Dict, Any, Optional, Tuple
import httpx

MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
MICROSOFT_GRAPH_BASE = "https://graph.microsoft.com/v1.0"

ONEDRIVE_SCOPES = [
    "offline_access",
    "Files.Read.All",
    "Sites.Read.All",
    "User.Read"
]


def get_onedrive_credentials() -> Tuple[str, str, str, str]:
    """Reads Microsoft Azure Entra OAuth credentials from environment."""
    client_id = (os.getenv("ONEDRIVE_CLIENT_ID") or os.getenv("MICROSOFT_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("ONEDRIVE_CLIENT_SECRET") or os.getenv("MICROSOFT_CLIENT_SECRET") or "").strip()
    redirect_uri = (os.getenv("ONEDRIVE_REDIRECT_URI") or os.getenv("MICROSOFT_REDIRECT_URI") or "").strip()
    webhook_url = (os.getenv("ONEDRIVE_WEBHOOK_URL") or os.getenv("MICROSOFT_WEBHOOK_URL") or "").strip()

    if not client_id or not client_secret:
        raise ValueError("ONEDRIVE_CLIENT_ID or ONEDRIVE_CLIENT_SECRET missing in environment.")

    return client_id, client_secret, redirect_uri, webhook_url


async def execute_graph_api_call(
    method: str,
    url: str,
    access_token: str,
    params: Optional[Dict[str, Any]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 45.0,
    max_retries: int = 4
) -> httpx.Response:
    """
    Executes an HTTP request to Microsoft Graph API with automatic rate-limit backoff,
    Retry-After compliance, and 5xx transient error handling.
    """
    req_headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json"
    }
    if headers:
        req_headers.update(headers)

    call_url = url if url.startswith("http") else f"{MICROSOFT_GRAPH_BASE}{url}"

    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(max_retries):
            try:
                res = await client.request(
                    method=method,
                    url=call_url,
                    headers=req_headers,
                    params=params,
                    json=json_data
                )

                if res.status_code in (200, 201, 202, 204):
                    return res

                # Check rate-limiting (429) or transient server errors (500, 502, 503, 504)
                if res.status_code in (429, 500, 502, 503, 504) and attempt < max_retries - 1:
                    retry_after = res.headers.get("Retry-After")
                    if retry_after:
                        try:
                            delay = float(retry_after)
                        except (ValueError, TypeError):
                            delay = (2 ** attempt) + random.uniform(0.1, 0.5)
                    else:
                        delay = (2 ** attempt) + random.uniform(0.1, 0.5)

                    print(f"[ONEDRIVE CLIENT] Received HTTP {res.status_code}. Backing off {delay:.2f}s (attempt {attempt+1}/{max_retries})")
                    await asyncio.sleep(delay)
                    continue

                return res
            except httpx.RequestError as exc:
                if attempt < max_retries - 1:
                    delay = (2 ** attempt) + random.uniform(0.1, 0.5)
                    print(f"[ONEDRIVE CLIENT] Request error {exc}. Retrying in {delay:.2f}s...")
                    await asyncio.sleep(delay)
                    continue
                raise

