import os
import sys
import traceback
from contextvars import ContextVar, Token
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Dict, Tuple, Any
from dotenv import load_dotenv
from supabase import create_client, Client
from supabase.lib.client_options import SyncClientOptions

# Load environment variables
load_dotenv()


@dataclass(frozen=True)
class UserContext:
    user_id: str
    company_id: Optional[str] = None
    email: Optional[str] = None
    endpoint: Optional[str] = None
    method: Optional[str] = None


_current_user_context: ContextVar[Optional[UserContext]] = ContextVar(
    "current_user_context", default=None
)
_current_request_info: ContextVar[Optional[Dict[str, str]]] = ContextVar(
    "current_request_info", default=None
)

# In-memory cache for user-scoped Supabase clients keyed by (user_id, company_id)
_user_client_cache: Dict[Tuple[str, Optional[str]], Client] = {}
_MAX_CACHED_CLIENTS = 512


class UnauthenticatedDatabaseAccessError(PermissionError):
    """Raised when client-scoped database access is attempted without authenticated user context."""

    def __init__(
        self,
        message: str,
        action: Optional[str] = None,
        caller_info: Optional[str] = None,
    ):
        super().__init__(message)
        self.action = action
        self.caller_info = caller_info


def set_current_user_context(
    user_id: str,
    company_id: Optional[str] = None,
    email: Optional[str] = None,
    endpoint: Optional[str] = None,
    method: Optional[str] = None,
) -> Token:
    """Set the active user context for the current async task or thread."""
    ctx = UserContext(
        user_id=str(user_id) if user_id else "",
        company_id=str(company_id) if company_id else None,
        email=str(email) if email else None,
        endpoint=str(endpoint) if endpoint else None,
        method=str(method) if method else None,
    )
    return _current_user_context.set(ctx)


def reset_current_user_context(token: Token) -> None:
    """Reset the user context using the token returned by set_current_user_context."""
    try:
        _current_user_context.reset(token)
    except Exception:
        _current_user_context.set(None)


def set_current_request_info(endpoint: str, method: str) -> Token:
    """Set the active request info (endpoint, method) for error logging context."""
    return _current_request_info.set({"endpoint": str(endpoint), "method": str(method)})


def clear_current_user_context() -> None:
    """Unconditionally clear the user context and request info for the current async task."""
    _current_user_context.set(None)
    _current_request_info.set(None)


def get_current_user_context() -> Optional[UserContext]:
    """Retrieve the active user context if set."""
    return _current_user_context.get()


@contextmanager
def user_supabase_context(
    user_id: str,
    company_id: Optional[str] = None,
    email: Optional[str] = None,
    endpoint: Optional[str] = None,
    method: Optional[str] = None,
):
    """Context manager for scoping database operations to a specific user/company."""
    token = set_current_user_context(user_id, company_id, email, endpoint, method)
    try:
        yield
    finally:
        reset_current_user_context(token)


def get_supabase_client() -> Client:
    """
    Get base Supabase client instance using the ANON key.
    """
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    # No-bypass mode: always use anon key so RLS is enforced.
    supabase_key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_ANON_KEY")

    if not supabase_url:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL environment variable not set")
    if not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable not set")

    return create_client(supabase_url.rstrip("/") + "/", supabase_key)

def get_user_supabase_client(user_id: Optional[str] = None, company_id: Optional[str] = None) -> Client:
    """
    Get Supabase client instance scoped to a user and company using the ANON key.
    Passes x-user-id and x-company-id headers so PostgREST RLS functions (current_app_user_id,
    current_app_company_id, can_access_company, can_access_user) work under RLS enforcement.
    Reuses cached clients to prevent continuous connection pool recreation.
    """
    cache_key = (str(user_id or ""), str(company_id or "") if company_id else None)
    if cache_key in _user_client_cache:
        return _user_client_cache[cache_key]

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_ANON_KEY")

    if not supabase_url:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL environment variable not set")
    if not supabase_key:
        raise ValueError("NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable not set")

    headers = {}
    if user_id:
        headers["x-user-id"] = str(user_id)
    if company_id:
        headers["x-company-id"] = str(company_id)

    options = SyncClientOptions(headers=headers) if headers else None
    client = create_client(supabase_url.rstrip("/") + "/", supabase_key, options=options)

    if len(_user_client_cache) >= _MAX_CACHED_CLIENTS:
        _user_client_cache.clear()
    _user_client_cache[cache_key] = client
    return client

def get_supabase_admin() -> Client:
    """
    Get Supabase admin instance (bypasses RLS) for specific backend operations and migrations.
    """
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url:
        raise ValueError("NEXT_PUBLIC_SUPABASE_URL environment variable not set")
    if not supabase_key:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY environment variable not set")

    return create_client(supabase_url.rstrip("/") + "/", supabase_key)


def _log_unauthenticated_db_access(action: str) -> str:
    """
    Log unauthenticated database access attempt into public.error_logs with caller stack trace.
    Uses supabase_admin to guarantee insertion even when unauthenticated.
    """
    stack = traceback.format_stack()
    caller_frame = "unknown"
    for frame in reversed(stack[:-1]):
        if "supabase_client.py" not in frame:
            caller_frame = frame.strip()
            break

    stack_trace_str = "".join(stack)
    ctx = _current_user_context.get()
    req_info = _current_request_info.get()
    
    endpoint = (req_info.get("endpoint") if req_info else None) or (ctx.endpoint if ctx else None)
    method = (req_info.get("method") if req_info else None) or (ctx.method if ctx else None)
    page_url = f"{method} {endpoint}" if method and endpoint else (endpoint or "unknown")

    error_msg = (
        f"Unauthenticated database access attempted on action '{action}'. "
        f"No active user context found."
    )

    try:
        admin_client = get_supabase_admin()
        admin_client.table("error_logs").insert(
            {
                "error": error_msg,
                "error_type": "RLS_MISSING_AUTH_CONTEXT",
                "stack_trace": f"Caller:\n{caller_frame}\n\nFull Stack:\n{stack_trace_str}",
                "action": action,
                "page_url": page_url,
                "time": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()
    except Exception as exc:
        print(
            f"[supabase_client] Failed to persist unauthenticated DB access to error_logs: {exc}",
            file=sys.stderr,
        )

    return caller_frame


class ContextAwareSupabaseProxy:
    """
    Transparent proxy for the global Supabase client.
    Routes every operation to an authenticated user client (ANON key + x-user-id / x-company-id headers)
    according to the active UserContext.
    If no user context is set, it logs the violation with a stack trace to public.error_logs
    and raises UnauthenticatedDatabaseAccessError. Zero backdoors.
    """

    def _resolve_client(self, action: str) -> Client:
        ctx = _current_user_context.get()
        if not ctx or not ctx.user_id:
            caller = _log_unauthenticated_db_access(action)
            raise UnauthenticatedDatabaseAccessError(
                f"Client-scoped database operation '{action}' requested without authenticated user context. "
                f"Caller: {caller}",
                action=action,
                caller_info=caller,
            )

        return get_user_supabase_client(user_id=ctx.user_id, company_id=ctx.company_id)

    def table(self, table_name: str):
        return self._resolve_client(f"table:{table_name}").table(table_name)

    def from_(self, table_name: str):
        return self._resolve_client(f"from:{table_name}").from_(table_name)

    def rpc(self, fn: str, params: Optional[Dict[str, Any]] = None):
        return self._resolve_client(f"rpc:{fn}").rpc(fn, params or {})

    @property
    def storage(self):
        return self._resolve_client("storage").storage

    @property
    def auth(self):
        return self._resolve_client("auth").auth

    def __getattr__(self, name: str):
        return getattr(self._resolve_client(name), name)


# Export ready-to-use instances
# supabase: Context-aware proxy that strictly enforces client-scoped RLS using the anon key.
supabase = ContextAwareSupabaseProxy()

# supabase_admin: Service role client explicitly used for internal admin tasks & migrations only.
supabase_admin = get_supabase_admin()