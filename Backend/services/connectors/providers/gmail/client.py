# Backend/services/connectors/providers/gmail/client.py
"""
Resilient Gmail API Client with Jittered Exponential Backoff.
"""

import os
from typing import Tuple
from services.connectors.providers.google_drive.client import (
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    execute_google_api_call
)

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
]


def get_gmail_credentials() -> Tuple[str, str, str, str]:
    """Reads Gmail OAuth credentials from environment."""
    client_id = (os.getenv("GMAIL_CLIENT_ID") or os.getenv("GOOGLE_DRIVE_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("GMAIL_CLIENT_SECRET") or os.getenv("GOOGLE_DRIVE_CLIENT_SECRET") or "").strip()
    redirect_uri = (os.getenv("GMAIL_REDIRECT_URI") or os.getenv("GOOGLE_DRIVE_REDIRECT_URI") or "").strip()
    webhook_url = (os.getenv("GMAIL_WEBHOOK_URL") or os.getenv("GOOGLE_DRIVE_WEBHOOK_URL") or "").strip()

    if not client_id or not client_secret:
        raise ValueError("GMAIL_CLIENT_ID or GOOGLE_DRIVE_CLIENT_ID missing in environment.")

    return client_id, client_secret, redirect_uri, webhook_url

