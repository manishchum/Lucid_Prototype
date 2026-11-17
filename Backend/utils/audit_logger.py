import logging
from typing import Any, Dict, Optional
from fastapi import Request

from utils.auth import RequestAuth
from utils.auth_bridge import get_service_supabase_client

logger = logging.getLogger("lucid.audit_logger")

SENSITIVE_KEYS = {
    "password",
    "current_password",
    "new_password",
    "confirm_password",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "api_key",
    "authorization",
    "cookie",
}


def _sanitize_data(data: Any) -> Any:
    """Recursively mask sensitive keys in dicts/lists for SOC 2 / GDPR compliance."""
    if isinstance(data, dict):
        sanitized = {}
        for k, v in data.items():
            if any(sensitive in str(k).lower() for sensitive in SENSITIVE_KEYS):
                sanitized[k] = "***REDACTED***"
            else:
                sanitized[k] = _sanitize_data(v)
        return sanitized
    elif isinstance(data, list):
        return [_sanitize_data(item) for item in data]
    return data


def extract_client_ip(request: Optional[Request]) -> Optional[str]:
    """Extract the real client IP considering Cloudflare, proxies, and forwarded headers."""
    if not request:
        return None
    # 1. Cloudflare header
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    # 2. X-Forwarded-For header (comma-separated list of IPs)
    x_forwarded_for = request.headers.get("x-forwarded-for")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    # 3. Direct client host
    if request.client and request.client.host:
        return request.client.host
    return None


def extract_user_agent(request: Optional[Request]) -> Optional[str]:
    """Extract the client User-Agent."""
    if not request:
        return None
    return request.headers.get("user-agent")


async def log_audit_event(
    action: str,
    target_type: str,
    action_category: str = "IAM",
    target_id: Optional[str] = None,
    target_name: Optional[str] = None,
    changes: Optional[Dict[str, Any]] = None,
    details: Optional[Dict[str, Any]] = None,
    request: Optional[Request] = None,
    auth_ctx: Optional[RequestAuth] = None,
    actor_id: Optional[str] = None,
    actor_email: Optional[str] = None,
    actor_role: Optional[str] = None,
    company_id: Optional[str] = None,
    status: str = "SUCCESS",
    error_message: Optional[str] = None,
) -> None:
    """
    Log an immutable audit trail entry for SOC 2 and GDPR compliance.
    
    This function is completely non-blocking to the caller and will never throw
    an unhandled exception that impacts the primary business transaction.
    """
    try:
        resolved_actor_id = actor_id
        resolved_actor_email = actor_email
        resolved_actor_role = actor_role
        resolved_company_id = company_id

        if auth_ctx:
            resolved_actor_id = resolved_actor_id or getattr(auth_ctx, "user_id", None)
            resolved_actor_email = resolved_actor_email or getattr(auth_ctx, "email", None)
            resolved_company_id = resolved_company_id or getattr(auth_ctx, "company_id", None)
            if not resolved_actor_role and getattr(auth_ctx, "claims", None):
                resolved_actor_role = (
                    auth_ctx.claims.get("role")
                    or auth_ctx.claims.get("user_role")
                    or auth_ctx.claims.get("level")
                )

        ip_address = extract_client_ip(request)
        user_agent = extract_user_agent(request)

        sanitized_changes = _sanitize_data(changes) if changes is not None else None
        sanitized_details = _sanitize_data(details) if details is not None else None

        record = {
            "actor_id": str(resolved_actor_id) if resolved_actor_id else None,
            "actor_email": str(resolved_actor_email) if resolved_actor_email else None,
            "actor_role": str(resolved_actor_role) if resolved_actor_role else None,
            "company_id": str(resolved_company_id) if resolved_company_id else None,
            "action": str(action),
            "action_category": str(action_category).upper(),
            "target_type": str(target_type).lower(),
            "target_id": str(target_id) if target_id else None,
            "target_name": str(target_name) if target_name else None,
            "changes": sanitized_changes,
            "details": sanitized_details,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "status": str(status).upper(),
            "error_message": str(error_message) if error_message else None,
        }

        # Filter None values that DB defaults can handle, but retain explicit fields
        db = get_service_supabase_client()
        db.table("audit_logs").insert(record).execute()

    except Exception as exc:
        # Guarantee that audit log failures do not disrupt user operations
        logger.error(f"[AuditLog] Failed to record audit log for action={action}: {exc}", exc_info=True)
