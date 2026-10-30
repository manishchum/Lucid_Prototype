# Backend/services/connectors/providers/teams/client.py
"""
Resilient Microsoft Graph Client for Teams channels, chats, and meeting transcripts.
"""

import os
import asyncio
import random
from typing import Dict, Any, Optional, Tuple
import httpx

MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
MICROSOFT_GRAPH_BASE = "https://graph.microsoft.com/v1.0"

TEAMS_SCOPES = [
    "offline_access",
    "Team.ReadBasic.All",
    "Channel.ReadBasic.All",
    "ChannelMessage.Read.All",
    "OnlineMeetingArtifact.Read.All",
    "Files.Read.All",
    "User.Read"
]


def get_teams_credentials() -> Tuple[str, str, str, str]:
    """Reads Microsoft Azure Entra OAuth credentials for Teams."""
    client_id = (os.getenv("TEAMS_CLIENT_ID") or os.getenv("MICROSOFT_CLIENT_ID") or os.getenv("ONEDRIVE_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("TEAMS_CLIENT_SECRET") or os.getenv("MICROSOFT_CLIENT_SECRET") or os.getenv("ONEDRIVE_CLIENT_SECRET") or "").strip()
    redirect_uri = (os.getenv("TEAMS_REDIRECT_URI") or os.getenv("MICROSOFT_REDIRECT_URI") or "").strip()
    webhook_url = (os.getenv("TEAMS_WEBHOOK_URL") or os.getenv("MICROSOFT_WEBHOOK_URL") or "").strip()

    if not client_id or not client_secret:
        raise ValueError("TEAMS_CLIENT_ID or TEAMS_CLIENT_SECRET missing in environment.")

    return client_id, client_secret, redirect_uri, webhook_url


async def execute_teams_api_call(
    method: str,
    url: str,
    access_token: str,
    params: Optional[Dict[str, Any]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 45.0,
    max_retries: int = 4
) -> httpx.Response:
    """Executes Microsoft Graph API call with exponential backoff and rate limit handling."""
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

                if res.status_code in (429, 500, 502, 503, 504) and attempt < max_retries - 1:
                    retry_after = res.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after else (2 ** attempt) + random.uniform(0.1, 0.5)
                    print(f"[TEAMS CLIENT] Received HTTP {res.status_code}. Backing off {delay:.2f}s...")
                    await asyncio.sleep(delay)
                    continue

                return res
            except httpx.RequestError as exc:
                if attempt < max_retries - 1:
                    delay = (2 ** attempt) + random.uniform(0.1, 0.5)
                    await asyncio.sleep(delay)
                    continue
                raise

