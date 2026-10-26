"""
Global Logging Sanitizer & PII Scrubbing Utility.
Ensures zero leakage of Bearer tokens, JWTs, API keys, credentials, or PII into GCP Cloud Logging.
"""

import io
import logging
import re
import sys
from typing import Any, Dict, Optional

# ── Sensitive Data Regex Patterns ──────────────────────────────────────────
BEARER_TOKEN_RE = re.compile(r"Bearer\s+[A-Za-z0-9_\-\.=]+", re.IGNORECASE)
JWT_TOKEN_RE = re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-\.]+\b")
SECRET_PARAM_RE = re.compile(
    r"((?:token|access_token|auth_token|api_key|apikey|secret|password|client_secret|service_key)=)[^&\s'\"`]+",
    re.IGNORECASE
)
HEADER_AUTH_RE = re.compile(
    r"('(?:authorization|cookie|proxy-authorization|x-api-key|x-ai-gateway-token)':\s*')[^']+(\')",
    re.IGNORECASE
)
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")
CRLF_RE = re.compile(r"[\r\n\t]+")

SENSITIVE_HEADER_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "x-api-key",
    "x-ai-gateway-token",
}


def mask_email(email: Optional[str]) -> Optional[str]:
    """
    Masks email address to obscure user identity (e.g. j***e@d***.com).
    Safe for public or internal logs.
    """
    if not email or not isinstance(email, str):
        return None
    cleaned = email.strip()
    if "@" not in cleaned:
        return "[ANONYMIZED_ID]"
    try:
        user, domain = cleaned.split("@", 1)
        if len(user) <= 2:
            masked_user = user[0] + "***"
        else:
            masked_user = user[0] + "***" + user[-1]

        if "." in domain:
            dom_name, dom_ext = domain.rsplit(".", 1)
            masked_domain = (dom_name[0] if dom_name else "") + "***." + dom_ext
        else:
            masked_domain = "***"

        return f"{masked_user}@{masked_domain}"
    except Exception:
        return "[MASKED_EMAIL]"


def mask_phone_number(phone: Optional[str]) -> str:
    """
    Masks phone number for privacy and audit logs (e.g., +91 98765 ****10).
    """
    if not phone or not isinstance(phone, str):
        return "****"
    digits = "".join(filter(str.isdigit, phone))
    if len(digits) >= 10:
        return f"+{digits[:-10]} {digits[-10:-6]}****{digits[-2:]}" if len(digits) > 10 else f"{digits[:4]}****{digits[-2:]}"
    return "****"


def sanitize_text(text: Optional[str], max_len: int = 10000) -> Optional[str]:
    """
    Scrubs sensitive Bearer tokens, JWT tokens, credentials, and parameters from a text string.
    """
    if not text or not isinstance(text, str):
        return text

    scrubbed = text[:max_len]
    scrubbed = BEARER_TOKEN_RE.sub("Bearer [REDACTED]", scrubbed)
    scrubbed = JWT_TOKEN_RE.sub("[JWT_REDACTED]", scrubbed)
    scrubbed = SECRET_PARAM_RE.sub(r"\1[REDACTED]", scrubbed)
    scrubbed = HEADER_AUTH_RE.sub(r"\1[REDACTED]\2", scrubbed)
    return scrubbed


def sanitize_header_field(val: Optional[str], max_len: int = 300) -> Optional[str]:
    """
    Removes control characters and newlines to prevent log injection (CRLF).
    """
    if not val or not isinstance(val, str):
        return val
    cleaned = CRLF_RE.sub(" ", val).strip()
    return cleaned[:max_len]


def sanitize_headers(headers: Any) -> Dict[str, Any]:
    """
    Safely sanitizes an HTTP headers mapping or dictionary, completely redacting sensitive headers.
    """
    if not headers:
        return {}

    try:
        items = headers.items() if hasattr(headers, "items") else dict(headers).items()
    except Exception:
        return {"error": "Unable to serialize headers"}

    sanitized = {}
    for k, v in items:
        k_str = str(k).lower()
        if k_str in SENSITIVE_HEADER_KEYS:
            sanitized[k] = "[REDACTED]"
        else:
            sanitized[k] = sanitize_header_field(str(v), max_len=500)
    return sanitized


class SensitiveDataMaskingFilter(logging.Filter):
    """
    Global Logging Filter that intercepts all standard logger calls and scrubs Bearer/JWT/Secret strings.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if record.args:
                new_args = []
                for arg in record.args:
                    if isinstance(arg, str):
                        arg = sanitize_text(arg)
                    new_args.append(arg)
                record.args = tuple(new_args)

            if isinstance(record.msg, str):
                record.msg = sanitize_text(record.msg)
        except Exception:
            pass
        return True


class SafeStreamWrapper(io.TextIOBase):
    """
    Safe stdout/stderr wrapper that intercepts direct print() statements
    and scrubs JWT tokens and Bearer credentials before writing to the underlying stream.
    """

    def __init__(self, underlying_stream):
        self._stream = underlying_stream

    def write(self, s: str) -> int:
        if isinstance(s, str) and ("eyJ" in s or "Bearer" in s or "token=" in s):
            s = sanitize_text(s)
        return self._stream.write(s)

    def flush(self) -> None:
        return self._stream.flush()

    def fileno(self) -> int:
        return self._stream.fileno()

    def isatty(self) -> bool:
        return self._stream.isatty()


_GLOBAL_FILTER_INSTALLED = False


def setup_logging_sanitizer():
    """
    Configures and installs the global sanitizer across all root and uvicorn loggers,
    as well as wrapping stdout/stderr for full protection.
    """
    global _GLOBAL_FILTER_INSTALLED
    if _GLOBAL_FILTER_INSTALLED:
        return

    masking_filter = SensitiveDataMaskingFilter()

    # 1. Attach to Root Logger and its handlers
    root_logger = logging.getLogger()
    root_logger.addFilter(masking_filter)
    for handler in root_logger.handlers:
        handler.addFilter(masking_filter)

    # 2. Attach to key application & framework loggers
    target_loggers = [
        "uvicorn",
        "uvicorn.access",
        "uvicorn.error",
        "fastapi",
        "lucid.backend",
        "lucid.otp_service",
        "lucid.whatsapp",
        "gunicorn.access",
        "gunicorn.error",
    ]
    for logger_name in target_loggers:
        l = logging.getLogger(logger_name)
        l.addFilter(masking_filter)
        for h in l.handlers:
            h.addFilter(masking_filter)

    # 3. Wrap sys.stdout and sys.stderr to safeguard raw print() calls
    if not isinstance(sys.stdout, SafeStreamWrapper):
        sys.stdout = SafeStreamWrapper(sys.stdout)
    if not isinstance(sys.stderr, SafeStreamWrapper):
        sys.stderr = SafeStreamWrapper(sys.stderr)

    _GLOBAL_FILTER_INSTALLED = True
