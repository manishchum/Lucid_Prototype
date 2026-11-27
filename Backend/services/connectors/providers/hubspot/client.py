# Backend/services/connectors/providers/hubspot/client.py
"""
Resilient HubSpot CRM Client with OAuth 2.0, Rate Limiting (429 Retry-After),
Exponential Backoff, and Webhook Signature Verification.
"""

import os
import time
import hmac
import base64
import hashlib
import asyncio
import random
from typing import Dict, Any, Optional, Tuple, List
import httpx

HUBSPOT_AUTH_URL = "https://app.hubspot.com/oauth/authorize"
HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token"
HUBSPOT_INFO_URL = "https://api.hubapi.com/oauth/v1/access-tokens"
HUBSPOT_API_BASE = "https://api.hubapi.com"

HUBSPOT_SCOPES = [
    "crm.objects.deals.read",
    "crm.objects.contacts.read",
    "crm.objects.companies.read",
    "crm.objects.owners.read",
    "crm.schemas.deals.read",
    "crm.schemas.contacts.read",
    "crm.schemas.companies.read"
]


def get_hubspot_credentials() -> Tuple[str, str, str, str]:
    """Reads HubSpot App OAuth & Webhook credentials from environment."""
    from config import ENV_PATH
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=ENV_PATH, override=True)

    client_id = os.getenv("HUBSPOT_CLIENT_ID", "").strip()
    client_secret = os.getenv("HUBSPOT_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv("HUBSPOT_REDIRECT_URI", "").strip()
    webhook_secret = (
        os.getenv("HUBSPOT_WEBHOOK_SECRET", "").strip()
        or os.getenv("HUBSPOT_CLIENT_SECRET", "").strip()
    )

    if not client_id or not client_secret:
        raise ValueError("HUBSPOT_CLIENT_ID or HUBSPOT_CLIENT_SECRET missing in environment.")

    return client_id, client_secret, redirect_uri, webhook_secret


def verify_hubspot_signature(
    request_body: bytes,
    signature: str,
    client_secret: str,
    timestamp: Optional[str] = None,
    request_url: Optional[str] = None,
    http_method: str = "POST"
) -> bool:
    """
    Verifies HubSpot webhook signature (supporting both v1/v2 and v3 signatures).
    - v3 compares HMAC-SHA256 with timestamp and URL
    - v1/v2 compares SHA256 of client_secret + request_body
    """
    if not client_secret or not signature:
        return False

    body_str = request_body.decode("utf-8", errors="replace")

    # 1. Try HubSpot v3 Verification (if timestamp provided)
    if timestamp:
        try:
            # Reject replay attacks older than 5 minutes
            ts_float = float(timestamp) / 1000.0 if len(timestamp) > 11 else float(timestamp)
            if abs(time.time() - ts_float) > 300:
                return False
        except (ValueError, TypeError):
            pass

        url = request_url or ""
        source_v3 = f"{http_method.upper()}{url}{body_str}{timestamp}"
        computed_v3 = base64.b64encode(
            hmac.new(client_secret.encode("utf-8"), source_v3.encode("utf-8"), hashlib.sha256).digest()
        ).decode("utf-8")

        if hmac.compare_digest(computed_v3, signature):
            return True

    # 2. Try HubSpot v1/v2 Verification (SHA-256 of secret + body)
    source_v1 = f"{client_secret}{body_str}"
    computed_v1 = hashlib.sha256(source_v1.encode("utf-8")).hexdigest()
    if hmac.compare_digest(computed_v1, signature):
        return True

    return False


async def execute_hubspot_api_call(
    method: str,
    endpoint: str,
    access_token: str,
    params: Optional[Dict[str, Any]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 35.0,
    max_retries: int = 4
) -> httpx.Response:
    """
    Executes a HubSpot REST API call with automatic rate limit backoff (HTTP 429)
    and transient connection retry handling.
    """
    url = endpoint if endpoint.startswith("http") else f"{HUBSPOT_API_BASE}/{endpoint.lstrip('/')}"

    req_headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    if headers:
        req_headers.update(headers)

    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(max_retries):
            try:
                res = await client.request(
                    method=method,
                    url=url,
                    headers=req_headers,
                    params=params,
                    json=json_data
                )

                # Rate Limiting (429 Too Many Requests)
                if res.status_code == 429:
                    if attempt < max_retries - 1:
                        retry_after = res.headers.get("Retry-After")
                        delay = float(retry_after) if retry_after else (2 ** attempt) + random.uniform(0.1, 0.5)
                        print(f"[HUBSPOT CLIENT] HTTP 429 Rate limited. Retrying after {delay:.2f}s...")
                        await asyncio.sleep(delay)
                        continue
                    return res

                # Server error retry (502, 503, 504)
                if res.status_code in (502, 503, 504) and attempt < max_retries - 1:
                    delay = (2 ** attempt) + random.uniform(0.1, 0.5)
                    print(f"[HUBSPOT CLIENT] Server error ({res.status_code}). Retrying in {delay:.2f}s...")
                    await asyncio.sleep(delay)
                    continue

                return res

            except (httpx.RequestError, httpx.TimeoutException) as exc:
                if attempt < max_retries - 1:
                    delay = (2 ** attempt) + random.uniform(0.1, 0.5)
                    print(f"[HUBSPOT CLIENT] Request failed ({exc}). Retrying in {delay:.2f}s...")
                    await asyncio.sleep(delay)
                    continue
                raise

