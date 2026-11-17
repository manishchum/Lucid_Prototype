import os
import base64
from typing import Optional
from cryptography.fernet import Fernet

def _get_fernet() -> Fernet:
    raw_key = os.getenv("INTEGRATION_ENCRYPTION_KEY", "")
    if not raw_key:
        raise ValueError("INTEGRATION_ENCRYPTION_KEY environment variable is not set.")
    
    # Support 64-char hex string (32 bytes) or raw 32-byte base64 string
    try:
        if len(raw_key) == 64:
            key_bytes = bytes.fromhex(raw_key)
        else:
            key_bytes = raw_key.encode("utf-8")[:32].ljust(32, b"0")
    except Exception:
        key_bytes = raw_key.encode("utf-8")[:32].ljust(32, b"0")

    url_safe_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(url_safe_key)


def encrypt_token(token: Optional[str]) -> str:
    """Encrypts a plain text token string."""
    if not token:
        return ""
    f = _get_fernet()
    return f.encrypt(token.encode("utf-8")).decode("utf-8")


def decrypt_token(encrypted_token: Optional[str]) -> str:
    """Decrypts a previously encrypted token string."""
    if not encrypted_token:
        return ""
    try:
        f = _get_fernet()
        return f.decrypt(encrypted_token.encode("utf-8")).decode("utf-8")
    except Exception as e:
        print(f"[CRYPTO] Failed to decrypt token: {e}")
        return ""
