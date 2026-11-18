# Backend/routes/google_drive.py
"""
API Endpoints for Google Drive Integration with Performance Coach.
Built on the Unified Multi-Connector Engine.

Endpoints:
- GET  /api/integrations/google-drive/status         : Current connection & sync statistics
- GET  /api/integrations/google-drive/auth-url       : Generate OAuth consent URL for admin
- GET  /api/integrations/google-drive/callback       : OAuth redirect callback handler
- GET  /api/integrations/google-drive/folders        : Browse folders (My Drive & Shared Drives)
- POST /api/integrations/google-drive/select-folder  : Set specific folder to monitor
- POST /api/integrations/google-drive/webhook        : Google Drive push notification endpoint
- POST /api/integrations/google-drive/sync-now       : Trigger manual on-demand synchronization
- POST /api/integrations/google-drive/disconnect     : Disconnect Google Drive for company
"""

import os
import json
import html as html_lib
import urllib.parse
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks, Header, Query
from fastapi.responses import RedirectResponse, JSONResponse, Response, HTMLResponse
from pydantic import BaseModel, Field

from config import FRONTEND_URL
from utils.auth import RequestAuth, get_request_auth_required
from utils.db.permissions import check_user_permission
from utils.supabase_client import supabase_admin
from utils.logging import mask_email
from utils.redis_client import redis_client, get_cache, set_cache, delete_cache_pattern

from services.connectors import ConnectorManager, ConnectorRegistry
from routes.connectors import persist_oauth_state, verify_and_consume_oauth_state, _audit_connector_event
from security.rebac import is_missing_schema_error
from services.google_drive_service import (
    generate_auth_url,
    exchange_code_for_tokens,
    get_google_user_email,
    ensure_ingestion_folder,
    register_webhook_watch,
    list_drive_folders,
    list_drive_files,
    select_drive_folder,
    sync_company_drive_files
)

router = APIRouter(
    prefix="/api/integrations/google-drive",
    tags=["Google Drive Integration"]
)


class SelectFolderRequest(BaseModel):
    folder_id: str
    folder_name: str
    folder_path: str = "/"
    drive_id: Optional[str] = None


@router.get("/status")
async def get_google_drive_status(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Returns current Google Drive connection details, monitored folder/source, and sync statistics.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    is_mgr = await check_user_permission(auth.user_id, "manager")
    if not is_mgr:
        raise HTTPException(status_code=403, detail="Only managers and administrators can inspect connector status.")

    status = await ConnectorManager.get_connector_status(company_id=company_id, provider="google_drive")

    if not status.connected:
        return {
            "connected": False,
            "message": "Google Drive is not connected for this organization."
        }

    return {
        "connected": True,
        "integration": {
            "id": status.monitored_source_id or "primary",
            "google_account_email": status.account_identifier,
            "folder_id": status.monitored_source_id,
            "folder_name": status.monitored_source_name,
            "folder_path": status.monitored_source_path,
            "sync_status": status.status,
            "is_recursive": status.is_recursive,
            "webhook_active": status.webhook_active,
            "webhook_expiration": status.webhook_expiration,
            "last_synced_at": status.last_synced_at,
            "total_synced_files": status.total_synced_files,
            "error_message": status.error_message,
            "connected_at": status.connected_at,
            "config": status.config
        }
    }


@router.get("/auth-url")
async def get_google_drive_auth_url(
    connection_scope: str = Query("team", description="org | team | personal"),
    assigned_team_id: Optional[str] = Query(None),
    assigned_team_type: Optional[str] = Query(None),
    visibility_mode: str = Query("acl_sync", description="acl_sync | team_only | company_wide"),
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Generates OAuth2 authorization URL. Only managers and administrators (role level >= 2) are authorized;
    'org' / 'company_wide' scope requires Administrator (role level >= 3).
    """
    company_id = auth.company_id
    user_id = auth.user_id

    if not company_id or not user_id:
        raise HTTPException(status_code=400, detail="Authenticated user and company ID are required.")

    is_mgr = await check_user_permission(user_id, "manager")
    if not is_mgr:
        raise HTTPException(status_code=403, detail="Only managers and administrators can connect Google Drive.")

    scope_clean = (connection_scope or "team").lower()
    vis_clean = (visibility_mode or "acl_sync").lower()
    if scope_clean not in ("org", "team", "personal"):
        raise HTTPException(status_code=400, detail="connection_scope must be 'org', 'team', or 'personal'.")
    if vis_clean not in ("acl_sync", "team_only", "company_wide"):
        raise HTTPException(status_code=400, detail="visibility_mode must be 'acl_sync', 'team_only', or 'company_wide'.")

    if scope_clean == "org" or vis_clean == "company_wide":
        is_admin = await check_user_permission(user_id, "admin")
        if not is_admin:
            raise HTTPException(
                status_code=403,
                detail="Only Company Administrators can establish org-wide or company-wide connectors.",
            )

    try:
        url = generate_auth_url(company_id=company_id, user_id=user_id)
        persist_oauth_state(
            provider="google_drive",
            company_id=company_id,
            user_id=user_id,
            auth_url=url,
            extra_state={
                "connection_scope": scope_clean,
                "assigned_team_id": assigned_team_id,
                "assigned_team_type": assigned_team_type,
                "visibility_mode": vis_clean,
            },
        )
        return {"success": True, "auth_url": url, "connection_scope": scope_clean}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate authorization URL: {str(e)}")


def _render_oauth_popup_response(
    success: bool,
    email: str = "",
    error: str = "",
    integration_id: Optional[str] = None,
    needs_source_selection: bool = False,
) -> HTMLResponse:
    """Renders a responsive, self-closing HTML page for OAuth popup communication via window.opener.postMessage."""
    safe_email = html_lib.escape(email or "")
    safe_error = html_lib.escape(error or "")
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
            background: #111827;
            border: 1px solid #1f2937;
            padding: 32px;
            border-radius: 16px;
            max-width: 420px;
            width: 100%;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
        }}
        .icon {{
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: rgba(16, 185, 129, 0.15);
            color: #10b981;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            margin: 0 auto 16px;
            font-weight: bold;
        }}
        h2 {{ margin: 0 0 8px; font-size: 20px; font-weight: 600; color: #f1f5f9; }}
        p {{ margin: 0 0 20px; color: #94a3b8; font-size: 13px; line-height: 1.5; }}
        .btn {{
            background: #4f46e5;
            color: #ffffff;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
        }}
        .btn:hover {{ background: #4338ca; }}
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">✓</div>
        <h2>Connected Successfully!</h2>
        <p>Google Drive account <strong>{safe_email}</strong> has been linked. {"Select your Drive or folder in the dashboard to begin syncing." if needs_source_selection else "You can change your monitored folder anytime."}</p>
        <button class="btn" onclick="window.close()">Close Window</button>
    </div>
    <script>
        try {{
            if (window.opener) {{
                window.opener.postMessage({{
                    type: "CONNECTOR_OAUTH_SUCCESS",
                    provider: "google_drive",
                    account: {json.dumps(email)},
                    integration_id: {json.dumps(integration_id or "")},
                    needs_source_selection: {json.dumps(needs_source_selection)}
                }}, "*");
                window.opener.postMessage({{
                    type: "GOOGLE_DRIVE_OAUTH_SUCCESS",
                    email: {json.dumps(email)}
                }}, "*");
                setTimeout(function() {{
                    window.close();
                }}, 1200);
            }}
        }} catch (e) {{}}
    </script>
</body>
</html>"""
    else:
        html = f"""<!DOCTYPE html>
<html>
<head>
    <title>Google Drive Connection Error</title>
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
            background: #111827;
            border: 1px solid #1f2937;
            padding: 32px;
            border-radius: 16px;
            max-width: 420px;
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
        <p>{safe_error}</p>
        <button class="btn" onclick="window.close()">Close Window</button>
    </div>
    <script>
        try {{
            if (window.opener) {{
                window.opener.postMessage({{
                    type: "CONNECTOR_OAUTH_ERROR",
                    provider: "google_drive",
                    error: {json.dumps(error)}
                }}, "*");
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
    Receives OAuth redirect code from Google, exchanges for tokens, upserts multi-instance
    connector metadata + RBAC scope, encrypts tokens in Vault, initializes designated folder,
    registers watch channel, and returns self-closing popup response.
    """
    if error:
        print(f"[GOOGLE DRIVE CALLBACK ERROR] User cancelled or Google returned error: {error}")
        return _render_oauth_popup_response(success=False, error=f"Google authorization error: {error}")

    if not code or not state:
        return _render_oauth_popup_response(success=False, error="Missing authorization code or state parameter.")

    try:
        # 1. Validate & consume server-persisted state
        state_record = verify_and_consume_oauth_state("google_drive", state)
        if not state_record:
            return _render_oauth_popup_response(success=False, error="Invalid, unknown, or expired OAuth state token. Please initiate connection again.")

        company_id = state_record.get("company_id")
        user_id = state_record.get("user_id")

        if not company_id or not user_id:
            raise ValueError("State payload is missing required company_id or user_id.")

        # 2. Defense-in-depth: re-verify Manager+ role at callback time
        has_perm = await check_user_permission(user_id, "manager")
        if not has_perm:
            _audit_connector_event(
                company_id=company_id,
                actor_id=user_id,
                actor_email=None,
                action="CONNECTOR_OAUTH_CALLBACK_DENIED",
                target_name="google_drive",
                details={"reason": "role_below_manager_at_callback"},
                status="FAILED",
            )
            return HTMLResponse(
                content=_render_oauth_popup_response(
                    success=False,
                    error="Permission denied: Manager role or higher required.",
                ).body.decode("utf-8"),
                status_code=403,
            )

        extra_nested = state_record.get("extra") if isinstance(state_record.get("extra"), dict) else {}
        connection_scope = (state_record.get("connection_scope") or extra_nested.get("connection_scope") or "team").lower()
        assigned_team_id = state_record.get("assigned_team_id") or extra_nested.get("assigned_team_id")
        assigned_team_type = state_record.get("assigned_team_type") or extra_nested.get("assigned_team_type")
        visibility_mode = (state_record.get("visibility_mode") or extra_nested.get("visibility_mode") or "acl_sync").lower()

        if connection_scope == "org" or visibility_mode == "company_wide":
            is_admin = await check_user_permission(user_id, "admin")
            if not is_admin:
                connection_scope = "team"
                visibility_mode = "acl_sync"

        if connection_scope == "team" and not assigned_team_id:
            try:
                u_res = (
                    supabase_admin.table("users")
                    .select("function_id, sub_function_id")
                    .eq("user_id", str(user_id))
                    .maybe_single()
                    .execute()
                )
                u_data = getattr(u_res, "data", None) or {}
                if u_data.get("sub_function_id"):
                    assigned_team_id = str(u_data["sub_function_id"])
                    assigned_team_type = assigned_team_type or "sub_function"
                elif u_data.get("function_id"):
                    assigned_team_id = str(u_data["function_id"])
                    assigned_team_type = assigned_team_type or "function"
            except Exception:
                pass

        # 3. Exchange authorization code for tokens
        tokens = await exchange_code_for_tokens(code)
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in", 3600)
        user_email = tokens.get("account_identifier") or await get_google_user_email(access_token)

        if not access_token:
            raise ValueError("Google token response did not contain an access_token.")

        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat()
        token_expires_at = (now_dt + timedelta(seconds=expires_in)).isoformat()

        # 4. Find or create multi-instance company_integrations record FIRST to get integration_id
        integration_id: Optional[str] = None
        existing_config: Dict[str, Any] = {}
        uses_legacy_schema = False

        base_row = {
            "company_id": company_id,
            "provider": "google_drive",
            "status": "active",
            "connected_by": user_id,
            "owner_user_id": user_id,
            "connection_scope": connection_scope,
            "assigned_team_type": assigned_team_type,
            "assigned_team_id": assigned_team_id,
            "visibility_mode": visibility_mode,
            "account_identifier": user_email,
            "token_expires_at": token_expires_at,
            "updated_at": now_iso,
        }

        try:
            existing_res = (
                supabase_admin.table("company_integrations")
                .select("id, config")
                .eq("company_id", company_id)
                .eq("provider", "google_drive")
                .eq("owner_user_id", user_id)
                .eq("account_identifier", user_email)
                .limit(1)
                .execute()
            )
            existing_rows = getattr(existing_res, "data", None) or []
            if existing_rows:
                integration_id = str(existing_rows[0]["id"])
                existing_config = (existing_rows[0].get("config") or {})
                supabase_admin.table("company_integrations").update(base_row).eq("id", integration_id).execute()
            else:
                ins_res = supabase_admin.table("company_integrations").insert({**base_row, "config": {}}).execute()
                ins_rows = getattr(ins_res, "data", None) or []
                integration_id = str(ins_rows[0]["id"]) if ins_rows else None
        except Exception as col_err:
            if not is_missing_schema_error(col_err):
                raise
            uses_legacy_schema = True
            legacy_row = {
                "company_id": company_id,
                "provider": "google_drive",
                "status": "active",
                "connected_by": user_id,
                "account_identifier": user_email,
                "token_expires_at": token_expires_at,
                "updated_at": now_iso,
            }
            existing_legacy_res = (
                supabase_admin.table("company_integrations")
                .select("id, config")
                .eq("company_id", company_id)
                .eq("provider", "google_drive")
                .limit(1)
                .execute()
            )
            existing_legacy = getattr(existing_legacy_res, "data", None) or []
            if existing_legacy:
                integration_id = str(existing_legacy[0]["id"])
                existing_config = (existing_legacy[0].get("config") or {})
                supabase_admin.table("company_integrations").update(legacy_row).eq("id", integration_id).execute()
            else:
                ins_res = supabase_admin.table("company_integrations").insert({**legacy_row, "config": {}}).execute()
                ins_rows = getattr(ins_res, "data", None) or []
                integration_id = str(ins_rows[0]["id"]) if ins_rows else None

        # 5. If Google did not return a refresh_token (re-auth without revoke), reuse stored Vault token
        if not refresh_token:
            get_args: Dict[str, Any] = {
                "p_company_id": str(company_id),
                "p_provider": "google_drive",
                "p_integration_id": str(integration_id) if integration_id else None,
            }
            try:
                token_rpc = supabase_admin.rpc("get_integration_tokens", get_args).execute()
            except Exception as rpc_err:
                if "PGRST202" in str(rpc_err) or is_missing_schema_error(rpc_err):
                    get_args.pop("p_integration_id", None)
                    token_rpc = supabase_admin.rpc("get_integration_tokens", get_args).execute()
                else:
                    raise
            vault_data = getattr(token_rpc, "data", None) or {}
            if vault_data.get("refresh_token"):
                refresh_token = vault_data["refresh_token"]

        # 6. Store OAuth tokens securely in Supabase Vault (always pass p_integration_id explicitly
        #    so PostgREST resolves uniquely to the 6-arg RPC and avoids PGRST203 overload ambiguity)
        store_args: Dict[str, Any] = {
            "p_company_id": str(company_id),
            "p_provider": "google_drive",
            "p_access_token": access_token,
            "p_refresh_token": refresh_token or "",
            "p_token_expires_at": token_expires_at,
            "p_integration_id": str(integration_id) if integration_id else None,
        }
        try:
            supabase_admin.rpc("store_integration_tokens", store_args).execute()
        except Exception as rpc_err:
            if "PGRST202" in str(rpc_err) or is_missing_schema_error(rpc_err):
                store_args.pop("p_integration_id", None)
                supabase_admin.rpc("store_integration_tokens", store_args).execute()
            else:
                raise

        # 7. Check if user already had a monitored folder configured (e.g. token re-auth).
        #    On a fresh connect, do NOT auto-create 'Lucid Coach Ingestion' or auto-sync:
        #    let the user explicitly choose which Drive or Folder to sync in the picker modal.
        folder_id = existing_config.get("folder_id")
        folder_name = existing_config.get("folder_name")
        needs_source_selection = not bool(folder_id)
        watch_info: Dict[str, Any] = {}

        if folder_id:
            watch_info = await register_webhook_watch(access_token, folder_id)
            config_data = {
                **existing_config,
                "folder_id": folder_id,
                "folder_name": folder_name,
                "webhook_channel_id": watch_info.get("channel_id"),
                "webhook_resource_id": watch_info.get("resource_id"),
                "webhook_expiration": watch_info.get("expiration"),
                "last_page_token": watch_info.get("start_page_token"),
            }
            if integration_id:
                supabase_admin.table("company_integrations").update({
                    "config": config_data,
                    "updated_at": now_iso,
                }).eq("id", integration_id).execute()

                supabase_admin.table("integration_monitored_sources").upsert({
                    "integration_id": integration_id,
                    "company_id": company_id,
                    "source_id": folder_id,
                    "source_type": "folder",
                    "source_name": folder_name,
                    "source_path": f"/{folder_name}",
                    "is_recursive": True,
                    "sync_cursor": watch_info.get("start_page_token"),
                    "updated_at": now_iso,
                }, on_conflict="integration_id,source_id").execute()

        # Record primary external identity alias for ACL mapping
        if not uses_legacy_schema and "@" in str(user_email or ""):
            try:
                supabase_admin.table("user_external_identities").upsert({
                    "user_id": str(user_id),
                    "company_id": str(company_id),
                    "provider": "google_drive",
                    "external_email": str(user_email).strip().lower(),
                    "verified": True,
                    "updated_at": now_iso,
                }, on_conflict="company_id,provider,user_id").execute()
            except Exception:
                pass

        # Maintain legacy google_drive_integrations best-effort when a folder is already chosen
        if folder_id:
            try:
                supabase_admin.table("google_drive_integrations").upsert({
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
                    "updated_at": now_iso,
                }, on_conflict="company_id").execute()
            except Exception:
                pass

        _audit_connector_event(
            company_id=company_id,
            actor_id=user_id,
            actor_email=user_email if "@" in str(user_email or "") else None,
            action="CONNECTOR_CONNECTED",
            target_id=integration_id,
            target_name=f"google_drive:{user_email}",
            details={
                "connection_scope": connection_scope,
                "assigned_team_id": assigned_team_id,
                "visibility_mode": visibility_mode,
                "needs_source_selection": needs_source_selection,
            },
        )

        print(f"[GOOGLE DRIVE] Organization {company_id} connected Google Drive successfully ({mask_email(user_email)}, needs_source_selection={needs_source_selection})")

        # 9. Only trigger immediate initial sync if a folder was already selected;
        #    otherwise sync begins when user picks their Drive/Folder in the modal.
        if folder_id:
            if integration_id:
                background_tasks.add_task(
                    ConnectorManager.sync_company_files,
                    company_id=company_id,
                    provider="google_drive",
                    integration_id=integration_id,
                )
            else:
                background_tasks.add_task(sync_company_drive_files, company_id=company_id)

        return _render_oauth_popup_response(
            success=True,
            email=user_email,
            integration_id=integration_id,
            needs_source_selection=needs_source_selection,
        )

    except Exception as exc:
        print(f"[GOOGLE DRIVE CALLBACK EXCEPTION] {exc}")
        return _render_oauth_popup_response(success=False, error=str(exc))


@router.get("/folders")
async def get_drive_folders(
    parent_id: Optional[str] = Query(None, description="Parent folder ID or 'root' for My Drive root"),
    drive_id: Optional[str] = Query(None, description="Shared Drive ID if browsing within a Team Drive"),
    refresh: bool = Query(False, description="Force fresh fetch from Google Drive bypassing cache"),
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Browse Google Drive folder hierarchy and contained files for the connected organization.
    Supports lazy loading of nested subfolders, "Shared with me", and Google Workspace Shared Drives.
    Returns both subfolders and files inside the current folder.
    Includes Redis caching (120s TTL) for instantaneous modal responsiveness.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    is_mgr = await check_user_permission(auth.user_id, "manager")
    if not is_mgr:
        raise HTTPException(status_code=403, detail="Only managers and administrators can browse drive folders.")

    cache_key = f"gdrive:contents:{company_id}:{parent_id or 'root'}:{drive_id or 'none'}"

    # Check cache first for instant sub-millisecond response
    if not refresh:
        cached = get_cache(cache_key)
        if cached is not None:
            if isinstance(cached, dict):
                return {
                    "success": True,
                    "folders": cached.get("folders", []),
                    "files": cached.get("files", []),
                    "total_folders": cached.get("total_folders", 0),
                    "total_files": cached.get("total_files", 0),
                    "cached": True
                }
            elif isinstance(cached, list):
                return {
                    "success": True,
                    "folders": cached,
                    "files": [],
                    "total_folders": len(cached),
                    "total_files": 0,
                    "cached": True
                }

    try:
        access_token = await ConnectorManager.get_valid_access_token(company_id, "google_drive")
        folders_task = list_drive_folders(
            access_token=access_token,
            parent_id=parent_id,
            drive_id=drive_id
        )

        if parent_id is not None:
            files_task = list_drive_files(
                access_token=access_token,
                parent_id=parent_id,
                drive_id=drive_id
            )
            folders, files = await asyncio.gather(folders_task, files_task)
        else:
            folders = await folders_task
            files = []

        eligible_count = sum(1 for f in files if f.get("is_supported"))
        excluded_count = sum(1 for f in files if not f.get("is_supported"))
        total_size_bytes = sum(f.get("size_bytes", 0) for f in files)

        result_payload = {
            "folders": folders,
            "files": files,
            "total_folders": len(folders),
            "total_files": len(files),
            "eligible_count": eligible_count,
            "excluded_count": excluded_count,
            "total_size_bytes": total_size_bytes
        }
        # Cache results for 120 seconds
        set_cache(cache_key, result_payload, ttl=120)

        return {
            "success": True,
            **result_payload,
            "cached": False
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch drive folders: {str(e)}")


@router.get("/folder-files")
async def get_folder_files(
    folder_id: str = Query(..., description="Folder ID to fetch child files for"),
    drive_id: Optional[str] = Query(None, description="Shared Drive ID if applicable"),
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Fetches the list of files in a specific folder for previewing when a folder is selected.
    Includes classification of eligible vs excluded documents.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    is_mgr = await check_user_permission(auth.user_id, "manager")
    if not is_mgr:
        raise HTTPException(status_code=403, detail="Only managers and administrators can preview folder files.")

    cache_key = f"gdrive:files:{company_id}:{folder_id}:{drive_id or 'none'}"
    cached = get_cache(cache_key)
    if cached is not None and isinstance(cached, dict):
        return {"success": True, **cached, "cached": True}

    try:
        access_token = await ConnectorManager.get_valid_access_token(company_id, "google_drive")
        files = await list_drive_files(
            access_token=access_token,
            parent_id=folder_id,
            drive_id=drive_id
        )
        eligible_count = sum(1 for f in files if f.get("is_supported"))
        excluded_count = sum(1 for f in files if not f.get("is_supported"))
        total_size_bytes = sum(f.get("size_bytes", 0) for f in files)

        payload = {
            "files": files,
            "total_files": len(files),
            "eligible_count": eligible_count,
            "excluded_count": excluded_count,
            "total_size_bytes": total_size_bytes
        }
        set_cache(cache_key, payload, ttl=120)
        return {"success": True, **payload, "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch files in folder: {str(e)}")


@router.post("/select-folder")
async def select_monitored_folder(
    payload: SelectFolderRequest,
    background_tasks: BackgroundTasks,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Changes the monitored root folder for automated recursive ingestion.
    Re-registers push notifications and triggers initial scan of the selected folder.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    is_mgr = await check_user_permission(auth.user_id, "manager")
    if not is_mgr:
        raise HTTPException(status_code=403, detail="Only managers and administrators can change monitored folders.")

    try:
        # Invalidate folder navigation and files cache on selection
        delete_cache_pattern(f"gdrive:contents:{company_id}:*")
        delete_cache_pattern(f"gdrive:files:{company_id}:*")
        delete_cache_pattern(f"gdrive:folders:{company_id}:*")

        res = await select_drive_folder(
            company_id=company_id,
            folder_id=payload.folder_id,
            folder_name=payload.folder_name,
            folder_path=payload.folder_path,
            drive_id=payload.drive_id
        )

        # Trigger immediate background sync of the newly chosen folder
        background_tasks.add_task(sync_company_drive_files, company_id=company_id)

        return {
            "success": True,
            "message": f"Successfully set monitored folder to '{payload.folder_name}'. Real-time ingestion is active.",
            "details": res
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set monitored folder: {str(e)}")


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
    Includes Redis debouncing (5-second window) to gracefully coalesce burst notifications.
    """
    if not x_goog_channel_id:
        return Response(status_code=200)

    print(f"[GOOGLE DRIVE WEBHOOK] Push notification: channel={x_goog_channel_id}, state={x_goog_resource_state}")

    if x_goog_resource_state == "sync":
        # Initial registration handshake
        return Response(status_code=200)

    try:
        # Lookup company by webhook_channel_id
        res = (
            supabase_admin.table("company_integrations")
            .select("company_id, status")
            .eq("provider", "google_drive")
            .filter("config->>webhook_channel_id", "eq", x_goog_channel_id)
            .limit(1)
            .execute()
        )
        integration = res.data[0] if (res and getattr(res, "data", None)) else None

        if not integration:
            # Fallback check against legacy table
            legacy_res = (
                supabase_admin.table("google_drive_integrations")
                .select("company_id, sync_status")
                .eq("webhook_channel_id", x_goog_channel_id)
                .limit(1)
                .execute()
            )
            integration = legacy_res.data[0] if (legacy_res and getattr(legacy_res, "data", None)) else None

        if not integration or integration.get("status") not in ("active", None):
            return Response(status_code=200)

        company_id = integration["company_id"]

        # 5-second Redis debouncing
        debounce_key = f"gdrive_webhook_debounce:{company_id}"
        is_new = False
        try:
            # set(key, value, ex=5, nx=True) -> returns True if key was set (i.e. first notification in burst)
            is_new = bool(redis_client.set(debounce_key, "active", ex=5, nx=True))
        except Exception as redis_err:
            print(f"[GOOGLE DRIVE WEBHOOK] Redis debounce note: {redis_err}")
            is_new = True

        if not is_new:
            print(f"[GOOGLE DRIVE WEBHOOK] Coalescing burst notification for company {company_id}")
            return Response(status_code=200)

        # Dispatch background sync
        background_tasks.add_task(sync_company_drive_files, company_id=company_id)

    except Exception as e:
        print(f"[GOOGLE DRIVE WEBHOOK ERROR] {e}")

    return Response(status_code=200)


@router.post("/sync-now")
async def trigger_manual_sync(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Admin on-demand trigger to immediately inspect Google Drive and ingest new/updated files.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    is_mgr = await check_user_permission(auth.user_id, "manager")
    if not is_mgr:
        raise HTTPException(status_code=403, detail="Only managers and administrators can trigger sync.")

    try:
        result = await sync_company_drive_files(company_id=company_id)
        return {
            "success": True,
            "message": f"Sync completed. Ingested {result.get('synced_count', 0)} new file(s), updated {result.get('updated_count', 0)}, skipped {result.get('skipped_count', 0)} file(s).",
            "details": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to synchronize Google Drive: {str(e)}")


@router.post("/disconnect")
async def disconnect_google_drive(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Disconnects Google Drive, terminates active watch channels, and clears credentials from Vault.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    is_mgr = await check_user_permission(auth.user_id, "manager")
    if not is_mgr:
        raise HTTPException(status_code=403, detail="Only managers and administrators can disconnect integrations.")
    try:
        delete_cache_pattern(f"gdrive:contents:{company_id}:*")
        delete_cache_pattern(f"gdrive:files:{company_id}:*")
        delete_cache_pattern(f"gdrive:folders:{company_id}:*")
        await ConnectorManager.disconnect_integration(company_id=company_id, provider="google_drive")
        return {"success": True, "message": "Google Drive integration disconnected successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to disconnect Google Drive: {str(e)}")
