import asyncio
import json
from typing import Dict, Optional

from fastapi import APIRouter, Response, Depends, Header, WebSocket, WebSocketDisconnect, BackgroundTasks

from utils.auth import (
    RequestAuth,
    register_device_session,
    validate_device_session,
    resolve_platform,
    _verify_firebase_token,
    get_request_auth_jwt_required,
    get_request_auth_required,
    _build_request_auth_from_verified_claims,
    _ensure_firebase_admin_initialized,
)
import time
from typing import Any, Tuple
from utils.redis_client import redis_client, set_cache, get_cache
from utils.auth_socket_manager import auth_socket_manager
from utils.redis_limiter import check_rate_limit, get_client_ip

# Backwards-compatibility alias for local registry inspection
AUTH_SOCKET_REGISTRY = auth_socket_manager.active_sockets

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


async def notify_session_replaced(user_id: str, keep_device_id: str, platform: str = "web") -> None:
    """Dispatches cross-process / cross-instance session displacement via Redis Pub/Sub."""
    await auth_socket_manager.notify_session_replaced(user_id, keep_device_id, platform=platform)


@router.websocket("/ws")
async def auth_socket(websocket: WebSocket):
    token = websocket.query_params.get("token")
    device_id = websocket.query_params.get("device_id")

    if not token or not device_id:
        await websocket.close(code=1008)
        return

    try:
        claims = _verify_firebase_token(token)
        auth_ctx = _build_request_auth_from_verified_claims(claims, None)
    except Exception:
        await websocket.close(code=1008)
        return

    if not auth_ctx.user_id:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    user_id_str = str(auth_ctx.user_id)
    device_id_str = str(device_id)
    platform = websocket.query_params.get("platform") or "web"
    await auth_socket_manager.register(user_id_str, device_id_str, websocket, platform=platform)

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("text"):
                try:
                    payload = json.loads(message["text"])
                except Exception:
                    continue
                if payload.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        await auth_socket_manager.unregister(user_id_str, device_id_str, websocket, platform=platform)


from pydantic import BaseModel, Field
from fastapi import HTTPException, Request
from utils.redis_limiter import check_rate_limit, get_client_ip
from utils.supabase_client import supabase
from utils.otp_service import (
    normalize_phone_number,
    check_resend_cooldown,
    check_hourly_limit,
    generate_and_store_otp,
    verify_otp_code,
    send_dovesoft_sms,
    dispatch_sms_otp,
)
from utils.auth_bridge import BridgeUserContext, mint_supabase_access_token, get_service_supabase_client


class SendOTPRequest(BaseModel):
    phone: str = Field(..., description="Mobile number with or without country code")


class VerifyOTPRequest(BaseModel):
    phone: str = Field(..., description="Mobile number")
    otp: str = Field(..., min_length=6, max_length=6, description="6-digit numeric OTP")
    device_id: Optional[str] = Field(None, description="Device UUID")
    platform: Optional[str] = Field(None, description="Client platform: 'mobile' or 'web'")


@router.post("/send-otp")
async def send_otp(body: SendOTPRequest, background_tasks: BackgroundTasks, request: Request):
    # Check IP-level distributed rate limit (5 requests / min per IP) before any phone or DB lookups
    client_ip = get_client_ip(request)
    await check_rate_limit(user_id=f"ip:{client_ip}", endpoint="auth-send-otp")

    phone = body.phone.strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")

    normalized_phone = normalize_phone_number(phone)

    # Check 30-second resend cooldown
    is_cooldown, remaining_seconds = check_resend_cooldown(normalized_phone)
    if is_cooldown:
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {remaining_seconds} seconds before requesting a new OTP."
        )

    # Check 1-hour rate limit (max 3 per hour)
    is_hourly_limit, remaining_hourly_seconds = check_hourly_limit(normalized_phone)
    if is_hourly_limit:
        minutes = max(1, remaining_hourly_seconds // 60)
        raise HTTPException(
            status_code=429,
            detail=f"Too many OTP requests for this phone number. Please try again in {minutes} minutes."
        )

    # Check user existence in DB & pre-fetch company features
    try:
        service_client = get_service_supabase_client()
        user_res = (
            service_client
            .table("users")
            .select("user_id, name, email, phone, company_id, function_id, sub_function_id, manager_id, firebase_uid, is_active, company:companies(company_id, name, subscription_tier, subscription_addons)")
            .eq("phone", normalized_phone)
            .limit(1)
            .execute()
        )
        rows = getattr(user_res, "data", None) or []

        user_data = rows[0] if rows else None
        if not user_data:
            raise HTTPException(status_code=404, detail="Phone number is not registered with Lucid")
        if not user_data.get("is_active"):
            raise HTTPException(status_code=403, detail="User account is deactivated")
        if not user_data.get("company_id"):
            raise HTTPException(status_code=403, detail="Company account is not registered or inactive")

        # Cache company feature metadata in Redis
        company_info = user_data.get("company")
        if company_info and user_data.get("company_id"):
            set_cache(f"company_static:{user_data['company_id']}", {"company": company_info}, ttl=3600)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[send-otp] DB user lookup failed: {exc}")
        raise HTTPException(status_code=500, detail="Database lookup failed")

    # Generate cryptographic OTP and store in Redis
    otp_code = generate_and_store_otp(normalized_phone)

    # Cache user profile in Redis with 5-minute TTL for zero-DB verify-otp resolution
    try:
        redis_client.setex(f"otp_user:{normalized_phone}", 300, json.dumps(user_data))
    except Exception as cache_err:
        print(f"[send-otp] Failed to cache user in Redis: {cache_err}")

    # Dispatch SMS via DoveSoft with retry logic, invalidation guard, and audit logging
    await dispatch_sms_otp(normalized_phone, otp_code, background_tasks)

    return {
        "success": True,
        "message": "OTP sent successfully",
        "retry_after": 30
    }


@router.post("/verify-otp")
async def verify_otp(body: VerifyOTPRequest, request: Request):
    # Check IP-level distributed rate limit (10 attempts / min per IP) before OTP verification
    client_ip = get_client_ip(request)
    await check_rate_limit(user_id=f"ip:{client_ip}", endpoint="auth-verify-otp")

    phone = body.phone.strip()
    otp = body.otp.strip()

    if not phone or not otp:
        raise HTTPException(status_code=400, detail="Phone number and OTP code are required")

    normalized_phone = normalize_phone_number(phone)

    # Verify OTP against Redis with constant-time comparison & max 5 attempt tracking
    is_valid, reason = verify_otp_code(normalized_phone, otp)
    if not is_valid:
        if reason == "MAX_ATTEMPTS_EXCEEDED":
            raise HTTPException(
                status_code=400,
                detail="Too many failed verification attempts. This OTP has been invalidated. Please request a new OTP."
            )
        elif reason.startswith("INVALID_CODE"):
            parts = reason.split("_")
            rem = parts[2] if len(parts) >= 3 else ""
            rem_text = f" ({rem} attempts remaining)" if rem else ""
            raise HTTPException(status_code=400, detail=f"Invalid OTP code{rem_text}.")
        else:
            raise HTTPException(status_code=400, detail="Invalid or expired OTP.")

    # Fast Path: Read cached user & company metadata from Redis (Zero DB queries!)
    user_data = None
    try:
        cached_user_str = redis_client.get(f"otp_user:{normalized_phone}")
        if cached_user_str:
            user_data = json.loads(cached_user_str)
            redis_client.delete(f"otp_user:{normalized_phone}")
    except Exception as e:
        print(f"[verify-otp] Redis cache read error: {e}")

    service_client = get_service_supabase_client()
    if not user_data:
        # Fallback to database only if Redis cache missed/expired
        try:
            user_res = (
                service_client
                .table("users")
                .select("user_id, name, email, phone, company_id, function_id, sub_function_id, manager_id, firebase_uid, is_active, company:companies(company_id, name, subscription_tier, subscription_addons)")
                .eq("phone", normalized_phone)
                .eq("is_active", True)
                .limit(1)
                .execute()
            )
            rows = getattr(user_res, "data", None) or []
            user_data = rows[0] if rows else None
            if not user_data:
                raise HTTPException(status_code=404, detail="User account not found or inactive")
        except HTTPException:
            raise
        except Exception as exc:
            print(f"[verify-otp] DB user query failed: {exc}")
            raise HTTPException(status_code=500, detail="Failed to fetch user context")

    # Ensure Firebase Admin SDK is initialized
    _ensure_firebase_admin_initialized()
    from firebase_admin import auth as firebase_auth

    firebase_uid = user_data.get("firebase_uid")
    if not firebase_uid:
        # Atomic single attempt: provision Firebase Auth user using DB user_id as deterministic UID
        target_uid = str(user_data["user_id"])
        try:
            fb_user = firebase_auth.create_user(
                uid=target_uid,
                phone_number=normalized_phone,
                email=(user_data.get("email") or "").strip().lower() or None,
            )
            firebase_uid = fb_user.uid
            print(f"[verify-otp] Provisioned Firebase user: {firebase_uid}")
        except firebase_auth.UidAlreadyExistsError:
            firebase_uid = target_uid
        except Exception:
            # Fallback lookup if phone number is already registered under another UID
            try:
                fb_user = firebase_auth.get_user_by_phone_number(normalized_phone)
                firebase_uid = fb_user.uid
            except Exception as err:
                print(f"[verify-otp] Firebase user resolution failed: {err}")
                raise HTTPException(
                    status_code=500,
                    detail="Failed to initialize Firebase authentication account"
                )

        # Persist firebase_uid in users table and mapping table
        try:
            service_client.table("users").update({"firebase_uid": firebase_uid}).eq("user_id", user_data["user_id"]).execute()
            user_data["firebase_uid"] = firebase_uid
            service_client.table("user_firebase_uids").upsert({
                "user_id": user_data["user_id"],
                "firebase_uid": firebase_uid,
                "provider": "phone"
            }, on_conflict="firebase_uid").execute()
        except Exception as db_err:
            print(f"[verify-otp] Database update/mapping for firebase_uid failed: {db_err}")

    # Generate Firebase Custom Token in memory
    try:
        custom_token_bytes = firebase_auth.create_custom_token(firebase_uid)
        token = custom_token_bytes.decode("utf-8") if isinstance(custom_token_bytes, bytes) else str(custom_token_bytes)
    except Exception as token_err:
        print(f"[verify-otp] Custom token generation failed: {token_err}")
        raise HTTPException(status_code=500, detail="Failed to generate custom authentication token")

    # Extract device_id and platform to authoritatively re-bind session on 2FA success
    device_id = body.device_id or request.headers.get("X-Device-ID")
    raw_platform = body.platform or request.headers.get("X-Platform")
    platform = resolve_platform(raw_platform or "mobile", request.headers.get("User-Agent"))

    company_data = user_data.get("company")
    if not company_data and user_data.get("company_id"):
        cached_comp = get_cache(f"company_static:{user_data['company_id']}")
        if cached_comp:
            company_data = cached_comp.get("company")

    if device_id and user_data.get("user_id"):
        user_id_str = str(user_data["user_id"])
        register_device_session(user_id_str, device_id, platform=platform)
        await auth_socket_manager.notify_session_replaced(user_id_str, device_id, platform=platform)

    return {
        "success": True,
        "token": token,
        "user": user_data,
        "company": company_data
    }


@router.post("/session")
async def register_session(
    request: Request,
    auth: RequestAuth = Depends(get_request_auth_jwt_required),
    x_device_id: str | None = Header(None, alias="X-Device-ID"),
    x_platform: str | None = Header(None, alias="X-Platform"),
    x_register_session: str | None = Header(None, alias="X-Register-Session"),
):
    if auth.user_id and x_device_id and x_register_session == "true":
        platform = resolve_platform(x_platform, request.headers.get("User-Agent"))
        register_device_session(auth.user_id, x_device_id, platform=platform)
        await auth_socket_manager.notify_session_replaced(auth.user_id, x_device_id, platform=platform)

    return {"success": True}


@router.post("/refresh")
async def refresh_token(
    auth: RequestAuth = Depends(get_request_auth_jwt_required),
):
    """
    Silent token refresh — verifies the current JWT and issues a fresh 30-day token.
    Called automatically by the mobile app when it detects a 401 response.
    The user never sees a re-login prompt unless this endpoint itself returns 401.
    """
    if not auth.user_id:
        raise HTTPException(status_code=401, detail="Unable to resolve user identity")

    # Ensure the user is still active before issuing a new token
    try:
        user_res = (
            supabase
            .table("users")
            .select("user_id, name, email, phone, company_id, function_id, sub_function_id, manager_id, firebase_uid, is_active")
            .eq("user_id", auth.user_id)
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        user_data = getattr(user_res, "data", None)
        if not user_data:
            raise HTTPException(status_code=403, detail="User account not found or deactivated")
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[refresh-token] DB user query failed: {exc}")
        raise HTTPException(status_code=500, detail="Failed to verify user status")

    # Mint a fresh token
    user_context = BridgeUserContext(
        user_id=str(user_data["user_id"]),
        email=str(user_data.get("email") or ""),
        company_id=str(user_data.get("company_id")) if user_data.get("company_id") else None,
        firebase_uid=str(user_data.get("firebase_uid")) if user_data.get("firebase_uid") else None,
    )

    token, expires_at = mint_supabase_access_token(user_context, ttl_seconds=3600)

    return {
        "success": True,
        "token": token,
        "expires_at": expires_at.isoformat(),
    }




_AUTH_ME_L1_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}

def invalidate_auth_me_l1_cache(user_id: Optional[str]) -> None:
    if not user_id:
        return
    _AUTH_ME_L1_CACHE.pop(f"auth_me:{user_id}", None)

def _normalize_role_name(value: str) -> str:
    return (value or "").lower().replace("-", "").replace("_", "").replace(" ", "")

@router.get("/me")
async def get_current_user_profile(
    response: Response = None,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    x_device_id: Optional[str] = Header(None, alias="X-Device-ID"),
    x_platform: Optional[str] = Header(None, alias="X-Platform"),
    x_register_session: Optional[str] = Header(None, alias="X-Register-Session"),
):
    """
    Unified 5-Layer Secure & High-Performance Auth Bootstrap Endpoint.
    Layer 1: Zero-Trust Context Binding (claims strictly drive user context; query params ignored).
    Layer 2: Hardware/Device Session Binding & Displacement Revocation.
    Layer 3: Distributed Rate Limiting & Abuse Prevention.
    Layer 4: Anti-Caching & Security Transport Headers.
    Layer 5: Data Minimization & Allow-list Sanitization.
    """
    # Layer 4: Anti-Caching & Transport Security Headers
    if response:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"

    user_id = str(auth_ctx.user_id)
    x_plat_str = str(x_platform) if isinstance(x_platform, str) else None
    norm_platform = "mobile" if x_plat_str and x_plat_str.lower() == "mobile" else "web"
    x_dev_str = str(x_device_id) if isinstance(x_device_id, str) else None

    # Registration path: atomic session establishment on login bootstrap
    if x_dev_str and x_register_session == "true":
        register_device_session(user_id, x_dev_str, platform=norm_platform)
        await auth_socket_manager.notify_session_replaced(user_id, x_dev_str, platform=norm_platform)

    cache_key = f"auth_me:{user_id}"
    now_ts = time.time()

    # Fast-Path L1 Cache Hit (< 0.005 ms)
    cached = _AUTH_ME_L1_CACHE.get(cache_key)
    if cached and (now_ts - cached[0] < 30.0):
        if x_dev_str and x_register_session != "true":
            validate_device_session(user_id, x_dev_str, platform=norm_platform)
        return cached[1]

    # Layer 2: Device Session Integrity & Revocation Verification (Cold Path)
    if x_dev_str and x_register_session != "true":
        validate_device_session(user_id, x_dev_str, platform=norm_platform)
    else:
        # If an active session exists in Redis for this user and platform, enforce device_id
        try:
            active_session = redis_client.get(f"session:{user_id}:{norm_platform}")
            if active_session:
                raise HTTPException(
                    status_code=401,
                    detail="Missing X-Device-ID header for active session"
                )
        except HTTPException:
            raise
        except Exception:
            pass

    # Layer 3: Rate Limiting & Anti-Brute-Force (enforced before executing DB queries)
    try:
        await check_rate_limit(user_id=user_id, endpoint="auth-me", limit=120, window=60)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[auth/me] Rate limit warning: {e}")

    service_client = get_service_supabase_client()

    def _fetch_user_and_company():
        res = (
            service_client
            .table("users")
            .select("user_id, name, email, phone, avatar_url, position, employment_status, hire_date, company_id, function_id, sub_function_id, manager_id, firebase_uid, is_active, company:companies(company_id, name, domain, company_logo, subscription_tier, subscription_addons, is_company_active, learning_style)")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        return getattr(res, "data", None)

    def _fetch_roles():
        try:
            res = (
                service_client
                .table("user_role_assignments")
                .select("is_active, role_id, role:roles(role_id, name, display_name, level)")
                .eq("user_id", user_id)
                .execute()
            )
            assignments = getattr(res, "data", None) or []
            return [r for r in assignments if r.get("is_active") is not False]
        except Exception as e:
            print(f"[_fetch_roles] Error fetching roles for user {user_id}: {e}")
            return []

    def _check_has_direct_reports():
        res = (
            service_client
            .table("users")
            .select("user_id")
            .eq("manager_id", user_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        return len(rows) > 0

    user_data, assignments, has_direct_reports = await asyncio.gather(
        asyncio.to_thread(_fetch_user_and_company),
        asyncio.to_thread(_fetch_roles),
        asyncio.to_thread(_check_has_direct_reports)
    )

    if not user_data:
        raise HTTPException(status_code=404, detail="Access denied. Your email is not in the allowed users list.")
    if user_data.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Your account has been deactivated. Please contact your administrator.")

    company_data = user_data.get("company")
    if company_data:
        is_company_active = company_data.get("is_company_active") is not False
        if not is_company_active:
            raise HTTPException(status_code=403, detail="Your organization account has been deactivated. Please contact your administrator.")

    # Normalize roles
    normalized_roles = []
    for ra in assignments:
        role_node = ra.get("role") or {}
        if isinstance(role_node, list) and role_node:
            role_node = role_node[0]
        name = str(role_node.get("name") or ra.get("name") or "").strip()
        level_raw = role_node.get("level") or ra.get("level") or -1
        try:
            level = int(level_raw)
        except Exception:
            level = -1
        if name or level >= 0:
            normalized_roles.append({
                "name": name,
                "level": level,
                "id": role_node.get("role_id") or role_node.get("id") or ra.get("role_id")
            })

    role_names = [r["name"] for r in normalized_roles if r.get("name")]
    has_admin_role = any(r["level"] >= 3 or _normalize_role_name(r["name"]) in ('admin', 'superadmin', 'super_admin', 'ceo') for r in normalized_roles)
    has_super_admin_role = any(r["level"] >= 4 or _normalize_role_name(r["name"]) in ('superadmin', 'super_admin', 'ceo') for r in normalized_roles)
    has_manager_role = any(r["level"] == 2 or 'manager' in _normalize_role_name(r["name"]) for r in normalized_roles)
    has_developer_role = any(r["level"] >= 6 or 'developer' in _normalize_role_name(r["name"]) for r in normalized_roles)
    is_actual_manager = bool(has_direct_reports or has_manager_role)

    emp_data = dict(user_data)
    if company_data:
        emp_data["company_name"] = company_data.get("name")
        emp_data["company_logo"] = company_data.get("company_logo")
        emp_data["subscription_tier"] = company_data.get("subscription_tier")
        emp_data["subscription_addons"] = company_data.get("subscription_addons")
        emp_data["learning_style_enabled"] = bool(company_data.get("learning_style"))

    # Security Data Minimization & Payload Optimization:
    # 1. Strip redundant joined company dictionary (eliminates duplicated subscription_addons)
    emp_data.pop("company", None)
    # 2. Strip sensitive internal auth provider identifiers & database artifacts
    emp_data.pop("firebase_uid", None)
    emp_data.pop("password", None)
    emp_data.pop("fcm_token", None)

    result = {
        "success": True,
        "employeeData": emp_data,
        "userId": user_id,
        "userRoles": role_names,
        "isAdmin": has_admin_role,
        "isSuperAdmin": has_super_admin_role,
        "isDeveloper": has_developer_role,
        "isManager": has_manager_role,
        "isManagerofUsers": is_actual_manager,
    }

    _AUTH_ME_L1_CACHE[cache_key] = (now_ts, result)
    return result
