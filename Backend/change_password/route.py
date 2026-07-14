import os

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from utils.auth import RequestAuth, _ensure_firebase_admin_initialized, get_request_auth_jwt_required
from utils.auth_bridge import get_service_supabase_client

router = APIRouter()


async def _verify_current_password_with_firebase(email: str, current_password: str) -> bool:
    api_key = os.getenv("FIREBASE_WEB_API_KEY") or os.getenv("NEXT_PUBLIC_FIREBASE_API_KEY")
    if not api_key:
        raise RuntimeError("Missing FIREBASE_WEB_API_KEY or NEXT_PUBLIC_FIREBASE_API_KEY")

    endpoint = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={api_key}"
    payload = {
        "email": email,
        "password": current_password,
        "returnSecureToken": True,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(endpoint, json=payload)

    if response.status_code == 200:
        return True

    try:
        data = response.json()
        firebase_message = ((data.get("error") or {}).get("message") or "").upper()
    except Exception:
        firebase_message = ""

    if firebase_message in {"INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND", "USER_DISABLED"}:
        return False

    raise RuntimeError(f"Firebase credential verification failed: status={response.status_code}")


@router.post("/change-password")
async def POST(
    req: Request,
    auth_ctx: RequestAuth = Depends(get_request_auth_jwt_required),
):
    try:
        body = await req.json()

        user_id = auth_ctx.user_id
        current_password = body.get("current_password")
        new_password = body.get("new_password")

        claims = auth_ctx.claims or {}
        firebase_claims = claims.get("firebase") if isinstance(claims, dict) else {}
        sign_in_provider = ""
        if isinstance(firebase_claims, dict):
            sign_in_provider = str(firebase_claims.get("sign_in_provider") or "").lower()
        is_password_provider = sign_in_provider in {"password", "email"}

        if is_password_provider and not current_password:
            return JSONResponse(
                {"error": "current_password is required"},
                status_code=400
            )

        # Load internal user profile linkage from Supabase.
        try:
            db = get_service_supabase_client()
            query = db.table("users") \
                .select("user_id,email,firebase_uid") \
                .eq("user_id", user_id) \
                .maybe_single() \
                .execute()

            userData = query.data

            if not userData:
                return JSONResponse(
                    {"error": "User not found"},
                    status_code=404
                )
        except Exception as fetch_error:
            print(f"Error fetching user: {fetch_error}")
            return JSONResponse(
                {"error": "User not found"},
                status_code=404
            )

        email = (userData.get("email") or "").strip().lower()
        firebase_uid = userData.get("firebase_uid")
        if not email:
            return JSONResponse(
                {"error": "User email not found"},
                status_code=400
            )

        # Validate current password only for password-based sign-ins.
        if is_password_provider:
            try:
                is_valid = await _verify_current_password_with_firebase(email, current_password)
                if not is_valid:
                    return JSONResponse(
                        {"error": "Current password is incorrect"},
                        status_code=401
                    )
            except RuntimeError as verify_error:
                print(f"Error verifying password with Firebase: {verify_error}")
                return JSONResponse(
                    {"error": "Error verifying current password"},
                    status_code=500
                )

        # If no new password provided, just return success after validating current password
        if not new_password or not new_password.strip():
            return JSONResponse({
                "message": "Current password validated successfully" if is_password_provider else "Federated sign-in detected; current password check skipped",
                "validated": True,
                "provider": sign_in_provider or "unknown"
            })

        # Update password in Firebase (source-of-truth).
        try:
            _ensure_firebase_admin_initialized()
            from firebase_admin import auth as firebase_auth

            if not firebase_uid:
                try:
                    firebase_uid = firebase_auth.get_user_by_email(email).uid
                    # Backfill linkage opportunistically when missing.
                    db.table("users").update({"firebase_uid": firebase_uid}).eq("user_id", user_id).execute()
                except firebase_auth.UserNotFoundError:
                    return JSONResponse(
                        {"error": "No Firebase account found for this user"},
                        status_code=404
                    )

            firebase_auth.update_user(firebase_uid, password=new_password.strip())
            # Revoke refresh tokens so prior sessions must refresh/re-authenticate.
            firebase_auth.revoke_refresh_tokens(firebase_uid)
        except Exception as update_error:
            print(f"Error updating Firebase password: {update_error}")
            return JSONResponse(
                {"error": "Failed to update password"},
                status_code=500
            )

        return JSONResponse({
            "message": "Password changed successfully",
            "changed": True
        })

    except Exception as error:
        print(f"Change password unexpected error: {error}")
        import traceback
        traceback.print_exc()

        return JSONResponse(
            {"error": "Internal server error"},
            status_code=500
        )