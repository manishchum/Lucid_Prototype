import re
from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
from utils.redis_limiter import check_rate_limit

router = APIRouter(
    tags=["Client Logs"]
)

# ── PII Sanitization Patterns ─────────────────────────────────────────
BEARER_TOKEN_RE = re.compile(r"Bearer\s+[A-Za-z0-9_\-\.=]+", re.IGNORECASE)
JWT_TOKEN_RE = re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-\.]+")
SECRET_PARAM_RE = re.compile(r"(token|key|secret|password|auth|api_key|apikey|access_token)=[^&\s'\"`]+", re.IGNORECASE)
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")
CRLF_RE = re.compile(r"[\r\n\t]+")


def mask_email(email: Optional[str]) -> Optional[str]:
    """Mask email address to obscure user identity (e.g. j***e@d***.com)."""
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


def sanitize_text(text: Optional[str], max_len: int = 10000) -> Optional[str]:
    """Scrub sensitive PII, JWT tokens, Bearer tokens, passwords, and API keys."""
    if not text or not isinstance(text, str):
        return text

    scrubbed = text[:max_len]
    scrubbed = BEARER_TOKEN_RE.sub("Bearer [REDACTED]", scrubbed)
    scrubbed = JWT_TOKEN_RE.sub("[JWT_REDACTED]", scrubbed)
    scrubbed = SECRET_PARAM_RE.sub(r"\1=[REDACTED]", scrubbed)
    scrubbed = EMAIL_RE.sub("[EMAIL_REDACTED]", scrubbed)
    scrubbed = PHONE_RE.sub("[PHONE_REDACTED]", scrubbed)
    return scrubbed


def sanitize_header_field(val: Optional[str], max_len: int = 300) -> Optional[str]:
    """Remove control characters and newlines to prevent log injection (CRLF)."""
    if not val or not isinstance(val, str):
        return val
    cleaned = CRLF_RE.sub(" ", val).strip()
    return cleaned[:max_len]


class ClientLogPayload(BaseModel):
    error: str = Field(..., max_length=5000, description="Error message")
    error_type: Optional[str] = Field("JSError", max_length=100)
    stack_trace: Optional[str] = Field(None, max_length=15000)
    browser: Optional[str] = Field(None, max_length=300)
    os: Optional[str] = Field(None, max_length=300)
    device: Optional[str] = Field(None, max_length=300)
    action: Optional[str] = Field(None, max_length=1000)
    page_url: Optional[str] = Field(None, max_length=1000)
    email_id: Optional[str] = Field(None, max_length=255)


def get_client_ip(request: Request) -> str:
    """Extract real client IP address for telemetry rate limiting."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/api/logs")
async def ingest_client_logs(
    payload: ClientLogPayload,
    request: Request,
):
    """
    Public telemetry error reporting endpoint.
    - Rate limited to 30 requests/minute per client IP to prevent log injection / DoS attacks.
    - Automatically sanitizes user PII (emails, phone numbers) and secrets (JWTs, tokens, keys).
    - Prevents log injection by stripping CRLF control characters.
    """
    client_ip = get_client_ip(request)

    # 1. Rate limiting by client IP
    await check_rate_limit(user_id=f"ip:{client_ip}", endpoint="client-logs")

    # 2. Scrub PII and sensitive tokens from error and stack trace
    clean_error = sanitize_text(payload.error, max_len=3000)
    clean_stack = sanitize_text(payload.stack_trace, max_len=10000)
    clean_action = sanitize_text(payload.action, max_len=500)
    clean_page_url = sanitize_text(payload.page_url, max_len=500)

    # 3. Mask email address
    masked_email = mask_email(payload.email_id)

    # 4. Prevent CRLF log injection in single-line metadata fields
    clean_error_type = sanitize_header_field(payload.error_type, max_len=100)
    clean_browser = sanitize_header_field(payload.browser, max_len=200)
    clean_os = sanitize_header_field(payload.os, max_len=200)
    clean_device = sanitize_header_field(payload.device, max_len=200)

    # Log sanitized telemetry safely
    print(
        f"[CLIENT_TELEMETRY] [{clean_error_type}] {clean_error} "
        f"| user={masked_email or 'anonymous'} "
        f"| screen={clean_page_url or 'unknown'} "
        f"| device={clean_device or 'unknown'}"
    )

    return {
        "success": True,
        "sanitized": True,
        "recorded_type": clean_error_type,
    }
