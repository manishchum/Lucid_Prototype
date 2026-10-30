# Backend/services/connectors/providers/zoom/client.py
"""
Resilient Zoom API Client with OAuth2 and CRC Webhook Challenge Validation.
"""

import os
import hmac
import hashlib
import asyncio
import random
from typing import Dict, Any, Optional, Tuple
import httpx

ZOOM_AUTH_URL = "https://zoom.us/oauth/authorize"
ZOOM_TOKEN_URL = "https://zoom.us/oauth/token"
ZOOM_API_BASE = "https://api.zoom.us/v2"

ZOOM_DEFAULT_SCOPES = [
    s.strip()
    for s in os.getenv("ZOOM_SCOPES", "recording:read,meeting:read,user:read").split(",")
    if s.strip()
]


def get_zoom_credentials() -> Tuple[str, str, str, str, str]:
    """Reads Zoom OAuth & Webhook credentials from environment."""
    client_id = os.getenv("ZOOM_CLIENT_ID", "").strip()
    client_secret = os.getenv("ZOOM_CLIENT_SECRET", "").strip()
    secret_token = os.getenv("ZOOM_WEBHOOK_SECRET_TOKEN", "").strip()
    redirect_uri = os.getenv("ZOOM_REDIRECT_URI", "").strip()
    webhook_url = os.getenv("ZOOM_WEBHOOK_URL", "").strip()

    if not client_id or not client_secret:
        raise ValueError("ZOOM_CLIENT_ID or ZOOM_CLIENT_SECRET missing in environment.")

    return client_id, client_secret, secret_token, redirect_uri, webhook_url


def validate_zoom_crc(plain_token: str, secret_token: str) -> str:
    """Computes HMAC-SHA256 hash for Zoom Webhook CRC Challenge verification."""
    return hmac.new(
        secret_token.encode("utf-8"),
        plain_token.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


async def execute_zoom_api_call(
    method: str,
    endpoint: str,
    access_token: str,
    params: Optional[Dict[str, Any]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    timeout: float = 30.0,
    max_retries: int = 4
) -> httpx.Response:
    """Executes a Zoom REST API request with exponential backoff on rate limits."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    url = endpoint if endpoint.startswith("http") else f"{ZOOM_API_BASE}/{endpoint.lstrip('/')}"

    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(max_retries):
            try:
                res = await client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    params=params,
                    json=json_data
                )

                if res.status_code in (200, 201, 204):
                    return res

                if res.status_code in (429, 500, 502, 503, 504) and attempt < max_retries - 1:
                    retry_after = res.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after else (2 ** attempt) + random.uniform(0.1, 0.5)
                    print(f"[ZOOM CLIENT] Rate limited ({res.status_code}). Backing off {delay:.2f}s...")
                    await asyncio.sleep(delay)
                    continue

                return res
            except httpx.RequestError as exc:
                if attempt < max_retries - 1:
                    delay = (2 ** attempt) + random.uniform(0.1, 0.5)
                    await asyncio.sleep(delay)
                    continue
                raise

