from typing import Optional

from fastapi import HTTPException

from utils.auth import _ensure_firebase_admin_initialized
from utils.db.users_db import DEFAULT_PASSWORD


def ensure_firebase_user(email: str, display_name: Optional[str], plain_password_or_none: Optional[str]) -> str:
    """
    Ensure a Firebase Auth user exists for the given email.

    Behavior:
    1) Try to load user by email.
    2) If found, return uid.
    3) If not found, create user with provided password or DEFAULT_PASSWORD, then return uid.
    """
    normalized_email = (email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="Email is required for Firebase provisioning")

    _ensure_firebase_admin_initialized()

    from firebase_admin import auth as firebase_auth

    try:
        existing_user = firebase_auth.get_user_by_email(normalized_email)
        return existing_user.uid
    except firebase_auth.UserNotFoundError:
        password = plain_password_or_none or DEFAULT_PASSWORD
        try:
            created_user = firebase_auth.create_user(
                email=normalized_email,
                display_name=display_name,
                password=password,
            )
            return created_user.uid
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Failed to create Firebase user") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to fetch Firebase user") from exc
