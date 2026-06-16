from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Dict, Optional, Tuple
from uuid import uuid4
import json
import logging
import os

import jwt
from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions
from utils.redis_client import get_cache, set_cache


_LOGGER = logging.getLogger("lucid.auth_bridge")

DEFAULT_BRIDGE_TOKEN_TTL_SECONDS = 300
DEFAULT_BRIDGE_REFRESH_WINDOW_SECONDS = 60
MIN_BRIDGE_TOKEN_TTL_SECONDS = 60
MAX_BRIDGE_TOKEN_TTL_SECONDS = 3600
MIN_BRIDGE_REFRESH_WINDOW_SECONDS = 15


class BridgeError(RuntimeError):
    """Base class for bridge-related failures."""


class BridgeConfigurationError(BridgeError):
    """Raised when required bridge configuration is invalid or missing."""


class BridgeResolutionError(BridgeError):
    """Raised when Firebase identity cannot be mapped to an app user."""


def log_bridge_event(event: str, *, level: str = "info", **fields: Any) -> None:
    payload: Dict[str, Any] = {"event": event}
    for key, value in fields.items():
        if value is not None:
            payload[key] = value

    message = json.dumps(payload, default=str, separators=(",", ":"))

    normalized_level = (level or "info").lower()
    if normalized_level == "debug":
        _LOGGER.debug(message)
    elif normalized_level == "warning":
        _LOGGER.warning(message)
    elif normalized_level == "error":
        _LOGGER.error(message)
    else:
        _LOGGER.info(message)


def _parse_int_env(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default

    try:
        value = int(str(raw).strip())
    except Exception as exc:
        raise BridgeConfigurationError(f"{name} must be an integer number of seconds; got {raw!r}") from exc

    if value < minimum or value > maximum:
        raise BridgeConfigurationError(f"{name} must be between {minimum} and {maximum} seconds; got {value}")

    return value


@lru_cache(maxsize=1)
def get_bridge_token_policy() -> Tuple[int, int]:
    ttl_seconds = _parse_int_env(
        "BRIDGE_TOKEN_TTL_SECONDS",
        DEFAULT_BRIDGE_TOKEN_TTL_SECONDS,
        minimum=MIN_BRIDGE_TOKEN_TTL_SECONDS,
        maximum=MAX_BRIDGE_TOKEN_TTL_SECONDS,
    )
    refresh_window_seconds = _parse_int_env(
        "BRIDGE_TOKEN_REFRESH_WINDOW_SECONDS",
        DEFAULT_BRIDGE_REFRESH_WINDOW_SECONDS,
        minimum=MIN_BRIDGE_REFRESH_WINDOW_SECONDS,
        maximum=MAX_BRIDGE_TOKEN_TTL_SECONDS,
    )

    if refresh_window_seconds >= ttl_seconds:
        raise BridgeConfigurationError(
            "BRIDGE_TOKEN_REFRESH_WINDOW_SECONDS must be less than BRIDGE_TOKEN_TTL_SECONDS"
        )

    return ttl_seconds, refresh_window_seconds


def _resolve_policy(ttl_seconds: Optional[int], refresh_window_seconds: Optional[int]) -> Tuple[int, int]:
    default_ttl, default_refresh = get_bridge_token_policy()

    ttl = default_ttl if ttl_seconds is None else int(ttl_seconds)
    refresh = default_refresh if refresh_window_seconds is None else int(refresh_window_seconds)

    if ttl < MIN_BRIDGE_TOKEN_TTL_SECONDS or ttl > MAX_BRIDGE_TOKEN_TTL_SECONDS:
        raise BridgeConfigurationError(
            f"ttl_seconds must be between {MIN_BRIDGE_TOKEN_TTL_SECONDS} and {MAX_BRIDGE_TOKEN_TTL_SECONDS}; got {ttl}"
        )

    if refresh < MIN_BRIDGE_REFRESH_WINDOW_SECONDS or refresh >= ttl:
        raise BridgeConfigurationError(
            f"refresh_window_seconds must be between {MIN_BRIDGE_REFRESH_WINDOW_SECONDS} and {ttl - 1}; got {refresh}"
        )

    return ttl, refresh


def _get_env(*names: str, required: bool = False) -> Optional[str]:
    for name in names:
        value = os.getenv(name)
        if value:
            return value

    if required:
        raise BridgeConfigurationError(
            f"Missing required bridge environment variable. Expected one of: {', '.join(names)}"
        )
    return None


def get_supabase_url() -> str:
    value = _get_env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", required=True)
    return value.strip() if value else ""


def get_supabase_anon_key() -> str:
    value = _get_env("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", required=True)
    return value.strip() if value else ""


def get_supabase_service_role_key() -> str:
    value = _get_env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", required=True)
    return value.strip() if value else ""


def get_supabase_jwt_secret() -> str:
    value = _get_env("SUPABASE_JWT_SECRET", "SUPABASE_JWT_SIGNING_SECRET", "JWT_SECRET", required=True)
    return value.strip() if value else ""


def get_service_supabase_client() -> Client:
    return create_client(get_supabase_url(), get_supabase_service_role_key())


@dataclass(frozen=True)
class BridgeUserContext:
    user_id: str
    email: str
    company_id: Optional[str] = None
    firebase_uid: Optional[str] = None
    claims: Optional[Dict[str, Any]] = None


def _normalize_email(email: Optional[str]) -> str:
    return (email or "").strip().lower()


def _extract_firebase_identity(claims: Dict[str, Any]) -> Tuple[str, str, Optional[Any]]:
    email = _normalize_email(claims.get("email"))
    firebase_uid = str(claims.get("uid") or claims.get("user_id") or claims.get("sub") or "").strip()
    token_exp = claims.get("exp")
    return email, firebase_uid, token_exp


def _build_user_lookup_query(client: Client):
    return client.table("users").select("user_id,email,company_id,firebase_uid,is_active")


def _resolve_user_context_by_identity(
    client: Client,
    *,
    email: str,
    firebase_uid: str,
    claims: Dict[str, Any],
    token_exp: Optional[Any],
) -> Optional[BridgeUserContext]:
    search_order = []
    if firebase_uid:
        search_order.append(("firebase_uid", firebase_uid))
    if email:
        search_order.append(("email", email))

    lookup_errors = []

    for column, value in search_order:
        try:
            query = _build_user_lookup_query(client)
            if column == "email":
                response = query.ilike("email", value).eq("is_active", True).limit(1).execute()
            else:
                response = query.eq(column, value).eq("is_active", True).limit(1).execute()

            rows = getattr(response, "data", None) or []
            if rows:
                row = rows[0]
                user_id = str(row.get("user_id") or "").strip()
                row_email = _normalize_email(row.get("email") or email)
                if user_id and row_email:
                    company_id = str(row.get("company_id")) if row.get("company_id") else None
                    resolved_firebase_uid = (
                        str(row.get("firebase_uid") or firebase_uid)
                        if (row.get("firebase_uid") or firebase_uid)
                        else None
                    )
                    log_bridge_event(
                        "bridge_user_resolved",
                        firebase_uid=resolved_firebase_uid,
                        app_user_id=user_id,
                        company_id=company_id,
                        token_exp=token_exp,
                        lookup_column=column,
                    )
                    return BridgeUserContext(
                        user_id=user_id,
                        email=row_email,
                        company_id=company_id,
                        firebase_uid=resolved_firebase_uid,
                        claims=claims,
                    )
        except Exception as exc:
            lookup_errors.append(f"{column}: {exc}")
            log_bridge_event(
                "bridge_lookup_error",
                level="warning",
                firebase_uid=firebase_uid or None,
                app_user_id=None,
                company_id=None,
                token_exp=token_exp,
                lookup_column=column,
                reason=str(exc),
            )

    reason: Optional[str]
    if lookup_errors:
        reason = (
            f"Bridge lookup failed for firebase_uid={firebase_uid or 'n/a'}, "
            f"email={email or 'n/a'}; errors={'; '.join(lookup_errors[:2])}"
        )
    else:
        reason = (
            f"No active app user mapping found for firebase_uid={firebase_uid or 'n/a'}, "
            f"email={email or 'n/a'}"
        )

    log_bridge_event(
        "bridge_resolution_failed",
        level="error",
        firebase_uid=firebase_uid or None,
        app_user_id=None,
        company_id=None,
        token_exp=token_exp,
        reason=reason,
    )
    return None


def resolve_user_context_from_claims(
    claims: Dict[str, Any],
    *,
    fail_fast: bool = True,
) -> Optional[BridgeUserContext]:
    email, firebase_uid, token_exp = _extract_firebase_identity(claims)
    cache_key = (f"auth:{firebase_uid}")
    cached = get_cache(cache_key)
    if cached:
        # print("Cache Hit",{"cache_key": cache_key, "cached": cached})
        return BridgeUserContext(
            user_id = cached["user_id"],
            email = cached["email"],
            company_id = cached["company_id"],
            firebase_uid = cached["firebase_uid"],
            claims = claims,
        )

    
    
    if not email and not firebase_uid:
        reason = "Bridge claims missing both email and firebase_uid"
        log_bridge_event(
            "bridge_resolution_failed",
            level="error",
            firebase_uid=None,
            app_user_id=None,
            company_id=None,
            token_exp=token_exp,
            reason=reason,
        )
        if fail_fast:
            raise BridgeResolutionError(reason)
        return None

    client = get_service_supabase_client()
    context = _resolve_user_context_by_identity(
        client,
        email=email,
        firebase_uid=firebase_uid,
        claims=claims,
        token_exp=token_exp,
    )

    if context:
        # print("Redis Miss:", cache_key)
        set_cache(
            cache_key,{
                "user_id": context.user_id,
                "email": context.email,
                "company_id": context.company_id,
                "firebase_uid": context.firebase_uid,
            },
            ttl=3600
        )
        return context

    if fail_fast:
        raise BridgeResolutionError(
            f"Unable to resolve active app user context from Firebase claims "
            f"(firebase_uid={firebase_uid or 'n/a'}, email={email or 'n/a'})"
        )

    return None


def mint_supabase_access_token(
    context: BridgeUserContext,
    *,
    ttl_seconds: Optional[int] = None,
    issuer: str = "lucid-backend",
    audience: str = "authenticated",
    now: Optional[datetime] = None,
) -> Tuple[str, datetime]:
    effective_ttl, _ = _resolve_policy(ttl_seconds, None)
    current_time = now or datetime.now(timezone.utc)
    expires_at = current_time + timedelta(seconds=effective_ttl)

    claims = {
        "sub": context.user_id,
        "role": "authenticated",
        "email": context.email,
        "company_id": context.company_id,
        "firebase_uid": context.firebase_uid,
        "app_user_id": context.user_id,
        "iss": issuer,
        "aud": audience,
        "iat": int(current_time.timestamp()),
        "nbf": int(current_time.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": str(uuid4()),
    }

    token = jwt.encode(claims, get_supabase_jwt_secret(), algorithm="HS256")
    log_bridge_event(
        "bridge_token_minted",
        firebase_uid=context.firebase_uid,
        app_user_id=context.user_id,
        company_id=context.company_id,
        token_exp=int(expires_at.timestamp()),
        ttl_seconds=effective_ttl,
    )
    return token, expires_at


def decode_supabase_access_token(token: str, *, verify: bool = True) -> Dict[str, Any]:
    if verify:
        return jwt.decode(
            token,
            get_supabase_jwt_secret(),
            algorithms=["HS256"],
            audience="authenticated",
            leeway=30,
            options={"require": ["sub", "role", "email", "exp", "iat"]},
        )
    return jwt.decode(token, options={"verify_signature": False})


def is_supabase_token_expiring_soon(token: str, *, within_seconds: int = 60, now: Optional[datetime] = None) -> bool:
    decoded = decode_supabase_access_token(token, verify=True)
    expires_at = datetime.fromtimestamp(int(decoded["exp"]), tz=timezone.utc)
    current_time = now or datetime.now(timezone.utc)
    return expires_at <= current_time + timedelta(seconds=within_seconds)


def ensure_supabase_access_token(
    context: BridgeUserContext,
    *,
    existing_token: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
    refresh_window_seconds: Optional[int] = None,
    now: Optional[datetime] = None,
) -> Tuple[str, datetime, bool]:
    ttl_seconds, refresh_window_seconds = _resolve_policy(ttl_seconds, refresh_window_seconds)

    if existing_token:
        try:
            if not is_supabase_token_expiring_soon(existing_token, within_seconds=refresh_window_seconds, now=now):
                decoded = decode_supabase_access_token(existing_token, verify=True)
                expires_at = datetime.fromtimestamp(int(decoded["exp"]), tz=timezone.utc)
                log_bridge_event(
                    "bridge_token_reused",
                    firebase_uid=context.firebase_uid,
                    app_user_id=context.user_id,
                    company_id=context.company_id,
                    token_exp=int(decoded["exp"]),
                    ttl_seconds=ttl_seconds,
                    refresh_window_seconds=refresh_window_seconds,
                )
                return existing_token, expires_at, False
        except Exception:
            pass

    token, expires_at = mint_supabase_access_token(context, ttl_seconds=ttl_seconds, now=now)
    log_bridge_event(
        "bridge_token_refreshed",
        firebase_uid=context.firebase_uid,
        app_user_id=context.user_id,
        company_id=context.company_id,
        token_exp=int(expires_at.timestamp()),
        ttl_seconds=ttl_seconds,
        refresh_window_seconds=refresh_window_seconds,
    )
    return token, expires_at, True


def build_user_scoped_supabase_client_options(access_token: str) -> SyncClientOptions:
    return SyncClientOptions(
        headers={"Authorization": f"Bearer {access_token}"},
        auto_refresh_token=False,
        persist_session=False,
    )


def create_user_scoped_supabase_client(
    context: BridgeUserContext,
    *,
    existing_token: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
    refresh_window_seconds: Optional[int] = None,
    now: Optional[datetime] = None,
) -> Tuple[Client, str, datetime, bool]:
    token, expires_at, refreshed = ensure_supabase_access_token(
        context,
        existing_token=existing_token,
        ttl_seconds=ttl_seconds,
        refresh_window_seconds=refresh_window_seconds,
        now=now,
    )
    client = create_client(
        get_supabase_url(),
        get_supabase_anon_key(),
        options=build_user_scoped_supabase_client_options(token),
    )
    return client, token, expires_at, refreshed


def create_user_scoped_supabase_client_from_claims(
    claims: Dict[str, Any],
    *,
    existing_token: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
    refresh_window_seconds: Optional[int] = None,
    now: Optional[datetime] = None,
) -> Tuple[Client, BridgeUserContext, str, datetime, bool]:
    email, firebase_uid, _ = _extract_firebase_identity(claims)
    context = resolve_user_context_from_claims(claims, fail_fast=True)
    if not context:
        raise BridgeResolutionError(
            f"Unable to resolve app user context from Firebase claims "
            f"(firebase_uid={firebase_uid or 'n/a'}, email={email or 'n/a'})"
        )

    client, token, expires_at, refreshed = create_user_scoped_supabase_client(
        context,
        existing_token=existing_token,
        ttl_seconds=ttl_seconds,
        refresh_window_seconds=refresh_window_seconds,
        now=now,
    )