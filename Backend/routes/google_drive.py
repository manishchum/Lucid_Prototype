# Backend/routes/google_drive.py
"""
API Endpoints for Google Drive Integration with Performance Coach.
Endpoints:
- GET  /api/integrations/google-drive/status      : Get current company connection status
- GET  /api/integrations/google-drive/auth-url    : Generate OAuth URL for admin
- GET  /api/integrations/google-drive/callback    : OAuth redirect callback handler
- POST /api/integrations/google-drive/webhook     : Google Drive push notification endpoint
- POST /api/integrations/google-drive/sync-now    : Trigger manual on-demand synchronization
- POST /api/integrations/google-drive/disconnect  : Disconnect Google Drive for company
"""

import os
import json
import urllib.parse
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks, Header
from fastapi.responses import RedirectResponse, JSONResponse, Response, HTMLResponse

from config import FRONTEND_URL
from utils.auth import RequestAuth, get_request_auth_required
from utils.db.permissions import check_user_permission
from utils.supabase_client import supabase_admin
from services.google_drive_service import (
    generate_auth_url,
    exchange_code_for_tokens,
    get_google_user_email,
    ensure_ingestion_folder,
    register_webhook_watch,
    stop_webhook_watch,
    sync_company_drive_files
)

router = APIRouter(
    prefix="/api/integrations/google-drive",
    tags=["Google Drive Integration"]
)


@router.get("/status")
async def get_google_drive_status(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Returns current Google Drive connection details and sync statistics for the admin's company.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    # Fetch integration record
    res = (
        supabase_admin.table("google_drive_integrations")
        .select(
            "id, google_account_email, folder_id, folder_name, sync_status, "
            "webhook_channel_id, webhook_expiration, last_synced_at, error_message, created_at"
        )
        .eq("company_id", company_id)
        .limit(1)
        .execute()
    )

    integration = res.data[0] if (res and getattr(res, "data", None)) else None
    if not integration or integration.get("sync_status") == "disconnected":
        return {
            "connected": False,
            "message": "Google Drive is not connected for this organization."
        }

    # Fetch total synced files count
    synced_files_res = (
        supabase_admin.table("google_drive_synced_files")
        .select("id", count="exact")
        .eq("company_id", company_id)
        .eq("status", "completed")
        .execute()
    )
    synced_count = synced_files_res.count if (synced_files_res and getattr(synced_files_res, "count", None) is not None) else 0

    webhook_active = bool(integration.get("webhook_channel_id"))

    return {
        "connected": True,
        "integration": {
            "id": integration["id"],
            "google_account_email": integration.get("google_account_email"),
            "folder_id": integration.get("folder_id"),
            "folder_name": integration.get("folder_name"),
            "sync_status": integration.get("sync_status"),
            "webhook_active": webhook_active,
            "webhook_expiration": integration.get("webhook_expiration"),
            "last_synced_at": integration.get("last_synced_at"),
            "total_synced_files": synced_count,
            "error_message": integration.get("error_message"),
            "connected_at": integration.get("created_at")
        }
    }


@router.get("/auth-url")
async def get_google_drive_auth_url(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Generates OAuth2 authorization URL. Only company admins (role level >= 3) are authorized.
    """
    company_id = auth.company_id
    user_id = auth.user_id

    if not company_id or not user_id:
        raise HTTPException(status_code=400, detail="Authenticated user and company ID are required.")

    # Validate admin role
    is_admin = await check_user_permission(user_id, "admin")
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only company administrators can connect Google Drive.")

    try:
        url = generate_auth_url(company_id=company_id, user_id=user_id)
        return {"success": True, "auth_url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate authorization URL: {str(e)}")



def _render_oauth_popup_response(success: bool, email: str = "", error: str = "") -> HTMLResponse:
    """Renders a responsive, self-closing HTML page for OAuth popup communication via window.opener.postMessage."""
    frontend_redirect = f"{FRONTEND_URL}/admin/coach-uploads"
    if success:
        html = f"""<!DOCTYPE html>
<html>
<head>
    <title>Google Drive Connected</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #090d16;
            color: #f8fafc;
            text-align: center;
            padding: 24px;
            box-sizing: border-box;
        }}
        .card {{
            background: #131b2e;
            border: 1px solid #1e293b;
            border-radius: 16px;
            padding: 32px 24px;
            max-width: 400px;
            width: 100%;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        }}
        .icon {{
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: rgba(34, 197, 94, 0.15);
            color: #22c55e;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            margin: 0 auto 16px;
            font-weight: bold;
        }}
        h2 {{ margin: 0 0 8px; font-size: 20px; font-weight: 600; color: #f8fafc; }}
        p {{ margin: 0 0 16px; color: #94a3b8; font-size: 14px; line-height: 1.5; }}
        .email {{ color: #60a5fa; font-weight: 600; word-break: break-all; }}
        .spinner {{
            width: 20px;
            height: 20px;
            border: 2px solid #334155;
            border-top-color: #3b82f6;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 12px auto 0;
        }}
        @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">✓</div>
        <h2>Connected Successfully!</h2>
        <p>Google account <span class="email">{email}</span> is now linked to Lucid Coach.</p>
        <p style="font-size: 12px; color: #64748b;">Closing window...</p>
        <div class="spinner"></div>
    </div>
    <script>
        try {{
            if (window.opener) {{
                window.opener.postMessage({{
                    type: "GOOGLE_DRIVE_OAUTH_SUCCESS",
                    email: {json.dumps(email)}
                }}, "*");
                setTimeout(function() {{ window.close(); }}, 900);
            }} else {{
                window.location.href = "{frontend_redirect}?gdrive_connected=true&email={urllib.parse.quote(email)}";
            }}
        }} catch (e) {{
            window.location.href = "{frontend_redirect}?gdrive_connected=true&email={urllib.parse.quote(email)}";
        }}
    </script>
</body>
</html>"""
    else:
        html = f"""<!DOCTYPE html>
<html>
<head>
    <title>Google Drive Authentication Failed</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #090d16;
            color: #f8fafc;
            text-align: center;
            padding: 24px;
            box-sizing: border-box;
        }}
        .card {{
            background: #131b2e;
            border: 1px solid #1e293b;
            border-radius: 16px;
            padding: 32px 24px;
            max-width: 440px;
            width: 100%;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        }}
        .icon {{
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            margin: 0 auto 16px;
            font-weight: bold;
        }}
        h2 {{ margin: 0 0 8px; font-size: 20px; font-weight: 600; color: #f87171; }}
        p {{ margin: 0 0 20px; color: #94a3b8; font-size: 13px; line-height: 1.5; word-break: break-word; }}
        .btn {{
            background: #2563eb;
            color: #ffffff;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
        }}
        .btn:hover {{ background: #1d4ed8; }}
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">✕</div>
        <h2>Connection Failed</h2>
        <p>{error}</p>
        <button class="btn" onclick="window.close()">Close Window</button>
    </div>
    <script>
        try {{
            if (window.opener) {{
                window.opener.postMessage({{
                    type: "GOOGLE_DRIVE_OAUTH_ERROR",
                    error: {json.dumps(error)}
                }}, "*");
            }}
        }} catch (e) {{}}
    </script>
</body>
</html>"""
    return HTMLResponse(content=html, status_code=200)


@router.get("/callback")
async def google_drive_oauth_callback(
    request: Request,
    background_tasks: BackgroundTasks,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None
):
    """
    Receives OAuth redirect code from Google, exchanges for tokens, initializes designated folder,
    registers watch channel, and returns self-closing popup response notifying opener window.
    """
    if error:
        print(f"[GOOGLE DRIVE CALLBACK ERROR] User cancelled or Google returned error: {error}")
        return _render_oauth_popup_response(success=False, error=f"Google authorization error: {error}")

    if not code or not state:
        return _render_oauth_popup_response(success=False, error="Missing authorization code or state parameter.")

    try:
        # 1. Parse state
        decoded_state = urllib.parse.unquote(state)
        state_data = json.loads(decoded_state)
        company_id = state_data.get("company_id")
        user_id = state_data.get("user_id")

        if not company_id or not user_id:
            raise ValueError("State payload is missing required company_id or user_id.")

        # 2. Exchange authorization code for tokens
        tokens = await exchange_code_for_tokens(code)
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in", 3600)

        if not access_token:
            raise ValueError("Google token response did not contain an access_token.")

        # 3. Retrieve Google Account Email
        user_email = await get_google_user_email(access_token)

        # 4. If Google did not return a refresh_token (e.g. re-auth without revoking), check Vault
        if not refresh_token:
            vault_tokens = supabase_admin.rpc("get_google_drive_tokens", {"p_company_id": str(company_id)}).execute()
            vault_data = getattr(vault_tokens, "data", None) or {}
            if vault_data.get("refresh_token"):
                refresh_token = vault_data["refresh_token"]

        # 5. Ensure designated ingestion folder exists ("Lucid Coach Ingestion")
        folder_id, folder_name = await ensure_ingestion_folder(access_token, "Lucid Coach Ingestion")

        # 6. Register real-time push watch channel
        watch_info = await register_webhook_watch(access_token, folder_id)

        # 7. Upsert integration record (OAuth tokens stored separately in Supabase Vault)
        from datetime import timedelta
        token_expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

        integration_row = {
            "company_id": company_id,
            "connected_by": user_id,
            "google_account_email": user_email,
            "folder_id": folder_id,
            "folder_name": folder_name,
            "sync_status": "active",
            "webhook_channel_id": watch_info.get("channel_id"),
            "webhook_resource_id": watch_info.get("resource_id"),
            "webhook_expiration": watch_info.get("expiration"),
            "last_page_token": watch_info.get("start_page_token"),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

        supabase_admin.table("google_drive_integrations").upsert(
            integration_row,
            on_conflict="company_id"
        ).execute()

        # 8. Store OAuth tokens securely inside Supabase Vault (vault.secrets)
        supabase_admin.rpc("store_google_drive_tokens", {
            "p_company_id": str(company_id),
            "p_access_token": access_token,
            "p_refresh_token": refresh_token or "",
            "p_token_expires_at": token_expires_at
        }).execute()

        print(f"[GOOGLE DRIVE] Organization {company_id} connected Google Drive successfully (Account: {user_email}, stored in Supabase Vault)")

        # 9. Trigger immediate initial sync in background
        background_tasks.add_task(sync_company_drive_files, company_id=company_id)

        return _render_oauth_popup_response(success=True, email=user_email)

    except Exception as exc:
        print(f"[GOOGLE DRIVE CALLBACK EXCEPTION] {exc}")
        return _render_oauth_popup_response(success=False, error=str(exc))


@router.post("/webhook")
async def google_drive_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_goog_channel_id: Optional[str] = Header(None, alias="X-Goog-Channel-ID"),
    x_goog_resource_state: Optional[str] = Header(None, alias="X-Goog-Resource-State"),
    x_goog_resource_id: Optional[str] = Header(None, alias="X-Goog-Resource-ID")
):
    """
    Public webhook receiver for Google Drive push change notifications.
    Google sends notification headers whenever changes occur in monitored drive/folder.
    """
    # Immediate 200 OK for handshake or missing channel header
    if not x_goog_channel_id:
        return Response(status_code=200)

    print(f"[GOOGLE DRIVE WEBHOOK] Received push: channel={x_goog_channel_id}, state={x_goog_resource_state}")

    if x_goog_resource_state == "sync":
        # Google sends a 'sync' state upon channel registration handshake
        return Response(status_code=200)

    # Lookup company by channel_id
    try:
        res = (
            supabase_admin.table("google_drive_integrations")
            .select("company_id, sync_status")
            .eq("webhook_channel_id", x_goog_channel_id)
            .limit(1)
            .execute()
        )

        integration = res.data[0] if (res and getattr(res, "data", None)) else None
        if not integration or integration.get("sync_status") != "active":
            print(f"[GOOGLE DRIVE WEBHOOK] Unknown or inactive channel {x_goog_channel_id}")
            return Response(status_code=200)

        company_id = integration["company_id"]

        # Run file sync in background worker
        background_tasks.add_task(sync_company_drive_files, company_id=company_id)

    except Exception as e:
        print(f"[GOOGLE DRIVE WEBHOOK ERROR] Error routing webhook: {e}")

    return Response(status_code=200)


@router.post("/sync-now")
async def trigger_manual_sync(
    background_tasks: BackgroundTasks,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Admin on-demand trigger to immediately inspect the Google Drive folder and ingest new files.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    is_admin = await check_user_permission(auth.user_id, "admin")
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only company administrators can trigger sync.")

    # Run synchronously to give immediate feedback or run in background
    try:
        result = await sync_company_drive_files(company_id=company_id)
        return {
            "success": True,
            "message": f"Sync completed. Ingested {result.get('synced_count', 0)} new file(s), skipped {result.get('skipped_count', 0)} file(s).",
            "details": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to synchronize Google Drive: {str(e)}")


@router.post("/disconnect")
async def disconnect_google_drive(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Disconnects Google Drive, terminates active watch channels, and clears credentials.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    is_admin = await check_user_permission(auth.user_id, "admin")
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only company administrators can disconnect integrations.")

    try:
        # Fetch integration to stop active webhook
        res = (
            supabase_admin.table("google_drive_integrations")
            .select("id, webhook_channel_id, webhook_resource_id")
            .eq("company_id", company_id)
            .limit(1)
            .execute()
        )

        integration = res.data[0] if (res and getattr(res, "data", None)) else None
        if integration:
            channel_id = integration.get("webhook_channel_id")
            resource_id = integration.get("webhook_resource_id")

            # Fetch active token from Vault if available to stop channel
            token_res = supabase_admin.rpc("get_google_drive_tokens", {"p_company_id": str(company_id)}).execute()
            raw_token = (getattr(token_res, "data", None) or {}).get("access_token")

            if channel_id and resource_id and raw_token:
                try:
                    await stop_webhook_watch(raw_token, channel_id, resource_id)
                except Exception as e:
                    print(f"[GOOGLE DRIVE DISCONNECT] Warning: Could not stop watch channel: {e}")

            # Delete secrets from Supabase Vault
            supabase_admin.rpc("delete_google_drive_vault_tokens", {"p_company_id": str(company_id)}).execute()

            # Mark disconnected
            supabase_admin.table("google_drive_integrations").update({
                "sync_status": "disconnected",
                "webhook_channel_id": None,
                "webhook_resource_id": None,
                "webhook_expiration": None,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", integration["id"]).execute()

        return {"success": True, "message": "Google Drive integration disconnected successfully."}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to disconnect Google Drive: {str(e)}")
