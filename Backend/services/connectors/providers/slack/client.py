# Backend/services/connectors/providers/slack/client.py
"""
Resilient Slack Web API Client with Rate Limiting (HTTP 429) and HMAC Signature Verification.
"""

import os
import time
import hmac
import hashlib
import asyncio
import random
from typing import Dict, Any, Optional, Tuple
import httpx

SLACK_AUTH_URL = "https://slack.com/oauth/v2/authorize"
SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access"
SLACK_API_BASE = "https://slack.com/api"

SLACK_DEFAULT_SCOPES = [
    "channels:read",
    "groups:read",
    "channels:history",
    "groups:history",
    "files:read",
    "team:read",
    "users:read"
]


def get_slack_credentials() -> Tuple[str, str, str, str, str]:
    """Reads Slack App OAuth & Webhook credentials from environment."""
    client_id = os.getenv("SLACK_CLIENT_ID", "").strip()
    client_secret = os.getenv("SLACK_CLIENT_SECRET", "").strip()
    signing_secret = os.getenv("SLACK_SIGNING_SECRET", "").strip()
    redirect_uri = os.getenv("SLACK_REDIRECT_URI", "").strip()
    webhook_url = os.getenv("SLACK_WEBHOOK_URL", "").strip()

    if not client_id or not client_secret:
        raise ValueError("SLACK_CLIENT_ID or SLACK_CLIENT_SECRET missing in environment.")

    return client_id, client_secret, signing_secret, redirect_uri, webhook_url


def verify_slack_signature(
    request_body: bytes,
    timestamp: str,
    signature: str,
    signing_secret: str
) -> bool:
    """Verifies that an incoming webhook genuinely originated from Slack."""
    if not signing_secret or not signature or not timestamp:
        return False

    # Prevent replay attacks (> 5 minutes old)
    try:
        if abs(time.time() - float(timestamp)) > 300:
            return False
    except (ValueError, TypeError):
        return False

    sig_basestring = f"v0:{timestamp}:".encode("utf-8") + request_body
    computed_hash = "v0=" + hmac.new(
        signing_secret.encode("utf-8"),
        sig_basestring,
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(computed_hash, signature)


async def execute_slack_api_call(
    method: str,
    endpoint: str,
    access_token: str,
    params: Optional[Dict[str, Any]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    timeout: float = 30.0,
    max_retries: int = 4
) -> httpx.Response:
    """Executes a Slack Web API call with automatic rate limit backoff (HTTP 429)."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=utf-8"
    }

    url = endpoint if endpoint.startswith("http") else f"{SLACK_API_BASE}/{endpoint.lstrip('/')}"

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

                if res.status_code == 200:
                    data = res.json()
                    # Slack often returns 200 with error: 'ratelimited'
                    if not data.get("ok") and data.get("error") == "ratelimited" and attempt < max_retries - 1:
                        retry_after = res.headers.get("Retry-After")
                        delay = float(retry_after) if retry_after else (2 ** attempt) + random.uniform(0.1, 0.5)
                        print(f"[SLACK CLIENT] Rate limited. Backing off {delay:.2f}s...")
                        await asyncio.sleep(delay)
                        continue
                    return res

                if res.status_code == 429 and attempt < max_retries - 1:
                    retry_after = res.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after else (2 ** attempt) + random.uniform(0.1, 0.5)
                    await asyncio.sleep(delay)
                    continue

                return res
            except httpx.RequestError as exc:
                if attempt < max_retries - 1:
                    delay = (2 ** attempt) + random.uniform(0.1, 0.5)
                    await asyncio.sleep(delay)
                    continue
                raise

