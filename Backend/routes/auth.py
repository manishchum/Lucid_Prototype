import asyncio
import json
from typing import Dict

from fastapi import APIRouter, Depends, Header, WebSocket, WebSocketDisconnect

from utils.auth import (
    RequestAuth,
    register_device_session,
    _verify_firebase_token,
    get_request_auth_jwt_required,
    _build_request_auth_from_verified_claims,
    _ensure_firebase_admin_initialized,
)

AUTH_SOCKET_REGISTRY: Dict[str, Dict[str, WebSocket]] = {}
AUTH_SOCKET_LOCK = asyncio.Lock()

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


async def _register_auth_socket(user_id: str, device_id: str, websocket: WebSocket) -> None:
    async with AUTH_SOCKET_LOCK:
        device_map = AUTH_SOCKET_REGISTRY.setdefault(user_id, {})
        device_map[device_id] = websocket


async def _unregister_auth_socket(user_id: str, device_id: str, websocket: WebSocket) -> None:
    async with AUTH_SOCKET_LOCK:
        device_map = AUTH_SOCKET_REGISTRY.get(user_id)
        if not device_map:
            return
        current = device_map.get(device_id)
        if current is websocket:
            device_map.pop(device_id, None)
        if not device_map:
            AUTH_SOCKET_REGISTRY.pop(user_id, None)


async def notify_session_replaced(user_id: str, keep_device_id: str) -> None:
    async with AUTH_SOCKET_LOCK:
        device_map = AUTH_SOCKET_REGISTRY.get(user_id, {})
        sockets_to_close = [
            (device_id, socket)
            for device_id, socket in device_map.items()
            if device_id != keep_device_id
        ]

    for device_id, socket in sockets_to_close:
        try:
            await socket.send_json({
                "type": "force_logout",
                "reason": "session_replaced",
            })
        except Exception:
            pass

        try:
            await socket.close(code=4001)
        except Exception:
            pass

        await _unregister_auth_socket(user_id, device_id, socket)


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
    await _register_auth_socket(str(auth_ctx.user_id), str(device_id), websocket)

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
        await _unregister_auth_socket(str(auth_ctx.user_id), str(device_id), websocket)


from pydantic import BaseModel, Field
from fastapi import HTTPException
from utils.supabase_client import supabase
from utils.otp_service import (
    normalize_phone_number,
    check_resend_cooldown,
    check_hourly_limit,
    generate_and_store_otp,
    verify_otp_code,
    send_dovesoft_sms,
)
from utils.auth_bridge import BridgeUserContext, mint_supabase_access_token


class SendOTPRequest(BaseModel):
    phone: str = Field(..., description="Mobile number with or without country code")


class VerifyOTPRequest(BaseModel):
    phone: str = Field(..., description="Mobile number")
    otp: str = Field(..., min_length=6, max_length=6, description="6-digit numeric OTP")


@router.post("/send-otp")
async def send_otp(body: SendOTPRequest):
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

    # Check user existence in DB
    try:
        user_res = (
            supabase
            .table("users")
            .select("user_id, is_active")
            .eq("phone", normalized_phone)
            .maybe_single()
            .execute()
        )
        user_data = getattr(user_res, "data", None)
        if not user_data:
            raise HTTPException(status_code=404, detail="Phone number is not registered with Lucid")
        if not user_data.get("is_active"):
            raise HTTPException(status_code=403, detail="User account is deactivated")
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[send-otp] DB user lookup failed: {exc}")
        raise HTTPException(status_code=500, detail="Database lookup failed")

    # Generate cryptographic OTP and store in Redis
    otp_code = generate_and_store_otp(normalized_phone)

    # Dispatch SMS via DoveSoft
    success, msg = await send_dovesoft_sms(normalized_phone, otp_code)
    if not success:
        print(f"[send-otp] DoveSoft SMS dispatch failed: {msg}")
        return {
            "success": False,
            "message": f"Failed to deliver OTP via SMS: {msg}",
            "retry_after": 30
        }

    return {
        "success": True,
        "message": "OTP sent successfully",
        "dovesoft_response": msg,
        "retry_after": 30
    }


@router.post("/verify-otp")
async def verify_otp(body: VerifyOTPRequest):
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

    # Fetch user details for session token generation
    try:
        user_res = (
            supabase
            .table("users")
            .select("user_id, name, email, phone, company_id, department_id, manager_id, firebase_uid, is_active")
            .eq("phone", normalized_phone)
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        user_data = getattr(user_res, "data", None)
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
        try:
            # Check if user already exists in Firebase Auth by phone
            fb_user = firebase_auth.get_user_by_phone_number(normalized_phone)
            firebase_uid = fb_user.uid
            print(f"[verify-otp] Resolved existing Firebase user by phone: {firebase_uid}")
            
            # Update the local database users table with this firebase_uid
            try:
                supabase.table("users").update({"firebase_uid": firebase_uid}).eq("user_id", user_data["user_id"]).execute()
                user_data["firebase_uid"] = firebase_uid
            except Exception as db_err:
                print(f"[verify-otp] Database update for firebase_uid failed: {db_err}")
                raise HTTPException(status_code=500, detail="Failed to link authentication account")
        except HTTPException:
            raise
        except Exception:
            # User does not exist in Firebase, and we are not allowed to create one via mobile app.
            # User creation is handled on the web portal by admins.
            print(f"[verify-otp] User not found in Firebase Auth: {normalized_phone}")
            raise HTTPException(
                status_code=403, 
                detail="User account is not fully configured for mobile access. Please contact your administrator."
            )

    # Generate Firebase Custom Token
    try:
        custom_token = firebase_auth.create_custom_token(firebase_uid).decode("utf-8")
    except Exception as token_err:
        print(f"[verify-otp] Custom token generation failed: {token_err}")
        raise HTTPException(status_code=500, detail="Failed to generate custom authentication token")

    return {
        "success": True,
        "custom_token": custom_token,
        "user": user_data
    }


@router.post("/session")
async def register_session(
    auth: RequestAuth = Depends(get_request_auth_jwt_required),
    x_device_id: str | None = Header(None, alias="X-Device-ID"),
    x_register_session: str | None = Header(None, alias="X-Register-Session"),
):
    if auth.user_id and x_device_id and x_register_session == "true":
        register_device_session(auth.user_id, x_device_id)
        await notify_session_replaced(auth.user_id, x_device_id)

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
            .select("user_id, name, email, phone, company_id, department_id, manager_id, firebase_uid, is_active")
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


