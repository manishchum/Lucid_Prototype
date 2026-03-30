"""
Unsubscribe Token Manager

Handles cryptographic token generation and verification for email unsubscribe links.
Uses HMAC-SHA256 with a shared secret between Frontend and Backend.

Token Format:
    eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJ1c2VyX2lkIjoiYWJjMTIzIiwiZXhwaXJlc0F0IjoxNzA3NzAwMDAwfQ.HMAC_SIGNATURE

Components:
    1. Header: {"alg": "HS256", "typ": "JWT"}
    2. Payload: {"email": "...", "user_id": "...", "expiresAt": <timestamp>}
    3. Signature: HMAC-SHA256(header.payload, secret)

Expiration:
    - Tokens expire after 30 days
    - Expired tokens cannot be used to unsubscribe

Security:
    - Constant-time comparison to prevent timing attacks
    - HMAC-SHA256 signature verification
    - Email and user_id included in payload for audit trail
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


# ── Exceptions ──────────────────────────────────────────────────


class InvalidTokenError(Exception):
    """Token signature is invalid or corrupted."""
    pass


class ExpiredTokenError(Exception):
    """Token has expired."""
    pass


class MissingSecretError(Exception):
    """UNSUBSCRIBE_SECRET environment variable not configured."""
    pass


# ── Constants ───────────────────────────────────────────────────


# Token expiration: 30 days in seconds
TOKEN_EXPIRATION_SECONDS = 30 * 24 * 60 * 60  # 2,592,000 seconds

# HMAC algorithm
ALGORITHM = "HS256"

# Token type
TOKEN_TYPE = "JWT"


# ── Helper Functions ────────────────────────────────────────────


def get_secret() -> str:
    """
    Get the UNSUBSCRIBE_SECRET from environment.
    
    Returns:
        str: The secret key for signing tokens
        
    Raises:
        MissingSecretError: If UNSUBSCRIBE_SECRET is not configured
    """
    secret = os.getenv("UNSUBSCRIBE_SECRET")
    if not secret:
        raise MissingSecretError(
            "UNSUBSCRIBE_SECRET environment variable not configured. "
            "Set it to a 32+ character random string."
        )
    return secret


def base64_url_encode(data: bytes) -> str:
    """
    Encode bytes to base64url format (RFC 4648).
    
    Args:
        data: Bytes to encode
        
    Returns:
        str: Base64url encoded string
    """
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def base64_url_decode(data: str) -> bytes:
    """
    Decode base64url format (RFC 4648) to bytes.
    
    Args:
        data: Base64url encoded string
        
    Returns:
        bytes: Decoded bytes
        
    Raises:
        ValueError: If data is invalid base64url
    """
    # Add back padding if needed
    padding_needed = 4 - (len(data) % 4)
    if padding_needed != 4:
        data += "=" * padding_needed
    
    return base64.urlsafe_b64decode(data)


def constant_time_compare(a: str, b: str) -> bool:
    """
    Compare two strings in constant time to prevent timing attacks.
    
    Args:
        a: First string
        b: Second string
        
    Returns:
        bool: True if strings are equal
    """
    return hmac.compare_digest(a, b)


# ── Token Generation ────────────────────────────────────────────


def generate_token(email: str, user_id: str) -> str:
    """
    Generate a cryptographically signed unsubscribe token.
    
    Args:
        email: User's email address
        user_id: User's UUID
        
    Returns:
        str: Signed JWT token that can be used in unsubscribe links
        
    Raises:
        MissingSecretError: If UNSUBSCRIBE_SECRET is not configured
        
    Example:
        >>> token = generate_token("user@example.com", "abc-123-def")
        >>> # Token can be used in URL: 
        >>> # https://example.com/api/unsubscribe?token={token}
    """
    try:
        secret = get_secret()
        
        # Create header
        header = {
            "alg": ALGORITHM,
            "typ": TOKEN_TYPE,
        }
        
        # Create payload with expiration
        now_timestamp = int(time.time())
        expires_at = now_timestamp + TOKEN_EXPIRATION_SECONDS
        
        payload = {
            "email": email,
            "user_id": user_id,
            "expiresAt": expires_at,
            "iat": now_timestamp,  # issued at
        }
        
        # Encode header and payload
        header_encoded = base64_url_encode(json.dumps(header).encode("utf-8"))
        payload_encoded = base64_url_encode(json.dumps(payload).encode("utf-8"))
        
        # Create signature
        message = f"{header_encoded}.{payload_encoded}".encode("utf-8")
        signature = hmac.new(
            secret.encode("utf-8"),
            message,
            hashlib.sha256
        ).digest()
        signature_encoded = base64_url_encode(signature)
        
        # Combine into JWT
        token = f"{header_encoded}.{payload_encoded}.{signature_encoded}"
        
        logger.debug(f"Generated unsubscribe token for {email}")
        return token
        
    except MissingSecretError as e:
        logger.error(f"Token generation failed: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error generating token: {e}")
        raise


# ── Token Verification ──────────────────────────────────────────


def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify and decode an unsubscribe token.
    
    Checks:
        1. Token has three parts (header.payload.signature)
        2. Signature is valid (HMAC-SHA256)
        3. Token has not expired
        
    Args:
        token: The JWT token to verify
        
    Returns:
        dict: Decoded payload {"email": "...", "user_id": "...", "expiresAt": ...}
              Returns None if token is invalid or expired
        
    Raises:
        InvalidTokenError: If signature is invalid
        ExpiredTokenError: If token has expired
        
    Example:
        >>> token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20i..."
        >>> payload = verify_token(token)
        >>> if payload:
        ...     print(f"Email: {payload['email']}")
    """
    try:
        secret = get_secret()
        
        # Split token into parts
        parts = token.split(".")
        if len(parts) != 3:
            raise InvalidTokenError(f"Invalid token format: expected 3 parts, got {len(parts)}")
        
        header_encoded, payload_encoded, signature_provided = parts
        
        # Verify signature
        message = f"{header_encoded}.{payload_encoded}".encode("utf-8")
        expected_signature = hmac.new(
            secret.encode("utf-8"),
            message,
            hashlib.sha256
        ).digest()
        expected_signature_encoded = base64_url_encode(expected_signature)
        
        # Constant-time comparison
        if not constant_time_compare(signature_provided, expected_signature_encoded):
            logger.warning(f"Invalid token signature for token starting with {token[:20]}...")
            raise InvalidTokenError("Token signature is invalid")
        
        # Decode payload
        payload_bytes = base64_url_decode(payload_encoded)
        payload = json.loads(payload_bytes.decode("utf-8"))
        
        # Check expiration
        expires_at = payload.get("expiresAt")
        if expires_at is None:
            raise InvalidTokenError("Token missing expiration time")
        
        now_timestamp = int(time.time())
        if now_timestamp > expires_at:
            logger.warning(f"Token expired at {expires_at}, current time: {now_timestamp}")
            raise ExpiredTokenError(f"Token expired {now_timestamp - expires_at} seconds ago")
        
        logger.debug(f"Token verified for {payload.get('email')}")
        return payload
        
    except (InvalidTokenError, ExpiredTokenError):
        raise
    except MissingSecretError as e:
        logger.error(f"Token verification failed: {e}")
        raise InvalidTokenError(str(e))
    except json.JSONDecodeError as e:
        logger.error(f"Failed to decode token payload: {e}")
        raise InvalidTokenError("Token payload is not valid JSON")
    except Exception as e:
        logger.error(f"Unexpected error verifying token: {e}")
        raise InvalidTokenError(f"Token verification failed: {e}")


# ── Token Building ──────────────────────────────────────────────


def build_unsubscribe_url(
    token: str,
    frontend_url: Optional[str] = None
) -> str:
    """
    Build a complete unsubscribe URL for use in emails.
    
    Args:
        token: The unsubscribe token
        frontend_url: Frontend base URL (defaults to FRONTEND_URL env var)
        
    Returns:
        str: Complete URL like https://lucid.workfloww.ai/api/unsubscribe?token=...
        
    Example:
        >>> token = generate_token("user@example.com", "abc-123-def")
        >>> url = build_unsubscribe_url(token)
        >>> print(url)
        https://lucid.workfloww.ai/api/unsubscribe?token=eyJ...
    """
    if frontend_url is None:
        frontend_url = os.getenv("FRONTEND_URL", "https://lucid.workfloww.ai")
    
    # Ensure frontend_url doesn't end with /
    frontend_url = frontend_url.rstrip("/")
    
    return f"{frontend_url}/api/unsubscribe?token={token}"
