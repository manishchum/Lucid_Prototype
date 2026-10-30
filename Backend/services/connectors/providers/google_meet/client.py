# Backend/services/connectors/providers/google_meet/client.py
"""
Client for Google Meet API and Google Workspace Meet Recordings.
"""

import os
from typing import Tuple
from services.connectors.providers.google_drive.client import (
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    GOOGLE_DRIVE_API_BASE,
    execute_google_api_call
)

GOOGLE_MEET_SCOPES = [
    "https://www.googleapis.com/auth/meetings.space.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
]


def get_google_meet_credentials() -> Tuple[str, str, str, str]:
    """Reads Google Cloud credentials from environment."""
    client_id = (os.getenv("GOOGLE_MEET_CLIENT_ID") or os.getenv("GOOGLE_DRIVE_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("GOOGLE_MEET_CLIENT_SECRET") or os.getenv("GOOGLE_DRIVE_CLIENT_SECRET") or "").strip()
    redirect_uri = (os.getenv("GOOGLE_MEET_REDIRECT_URI") or os.getenv("GOOGLE_DRIVE_REDIRECT_URI") or "").strip()
    webhook_url = (os.getenv("GOOGLE_MEET_WEBHOOK_URL") or os.getenv("GOOGLE_DRIVE_WEBHOOK_URL") or "").strip()

    if not client_id or not client_secret:
        raise ValueError("GOOGLE_MEET_CLIENT_ID or GOOGLE_DRIVE_CLIENT_ID missing in environment.")

    return client_id, client_secret, redirect_uri, webhook_url

