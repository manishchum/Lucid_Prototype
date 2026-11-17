# Backend/routes/connectors.py
"""
Universal Multi-Connector API Router for Enterprise Integrations.
Serves: Google Drive, OneDrive, Microsoft Teams, Slack, Zoom, Google Meet, and Gmail.
"""

import os
import time
import json
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks, Header, Query
from fastapi.responses import RedirectResponse, JSONResponse, Response, HTMLResponse
from pydantic import BaseModel, Field

from config import FRONTEND_URL
from utils.auth import RequestAuth, get_request_auth_required
from utils.db.permissions import check_user_permission
import hmac
import hashlib
from utils.supabase_client import supabase_admin
from utils.logging import mask_email
from utils.redis_client import redis_client
from services.connectors import ConnectorManager, ConnectorRegistry
from services.connectors.providers.slack.client import verify_slack_signature, get_slack_credentials
from services.connectors.providers.zoom.client import validate_zoom_crc, verify_zoom_signature, get_zoom_credentials
from security.rebac import is_missing_schema_error

router = APIRouter(
    prefix="/api/connectors",
    tags=["Unified Cloud Connectors"]
)


def _audit_connector_event(
    company_id: str,
    actor_id: Optional[str],
    actor_email: Optional[str],
    action: str,
    target_id: Optional[str] = None,
    target_name: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    status: str = "SUCCESS",
) -> None:
    try:
        supabase_admin.table("audit_logs").insert({
            "company_id": str(company_id),
            "actor_id": str(actor_id) if actor_id else None,
            "actor_email": actor_email,
            "action": action,
            "action_category": "CONNECTOR_RBAC",
            "target_type": "connector_integration",
            "target_id": str(target_id) if target_id else None,
            "target_name": target_name,
            "details": details or {},
            "status": status,
        }).execute()
    except Exception as e:
        print(f"[CONNECTOR AUDIT] Note: {e}")


async def require_manager_or_above(
    auth: RequestAuth = Depends(get_request_auth_required),
) -> RequestAuth:
    """Enforces Role Level >= 2 (Manager, Admin, Super Admin, Developer) on all connector endpoints."""
    if not auth.company_id or not auth.user_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id and user_id are required.")

    has_perm = await check_user_permission(auth.user_id, "manager")
    if not has_perm:
        _audit_connector_event(
            company_id=auth.company_id,
            actor_id=auth.user_id,
            actor_email=auth.email,
            action="CONNECTOR_ACCESS_DENIED",
            details={"reason": "role_below_manager"},
            status="FAILED",
        )
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Only users with Manager role or higher can access or manage ingestion connectors.",
        )
    return auth


async def _verify_integration_management_access(
    auth: RequestAuth,
    provider: str,
    integration_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Verifies caller has permission to inspect/mutate a connector instance:
    - Admin+ (level >= 3) can manage any instance in their company.
    - Manager (level == 2) can only manage instances they own (`owner_user_id` or `connected_by`).
    """
    is_admin = await check_user_permission(auth.user_id, "admin")
    q = (
        supabase_admin.table("company_integrations")
        .select("*")
        .eq("company_id", str(auth.company_id))
        .eq("provider", provider)
        .eq("status", "active")
    )
    if integration_id:
        q = q.eq("id", integration_id)
    elif not is_admin:
        # Prefer manager's own instance when integration_id is omitted
        try:
            own_res = (
                supabase_admin.table("company_integrations")
                .select("*")
                .eq("company_id", str(auth.company_id))
                .eq("provider", provider)
                .eq("status", "active")
                .eq("owner_user_id", str(auth.user_id))
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
            own_rows = getattr(own_res, "data", None) or []
            if own_rows:
                return own_rows[0]
        except Exception as col_err:
            if not is_missing_schema_error(col_err):
                raise
            own_res = (
                supabase_admin.table("company_integrations")
                .select("*")
                .eq("company_id", str(auth.company_id))
                .eq("provider", provider)
                .eq("status", "active")
                .eq("connected_by", str(auth.user_id))
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
            own_rows = getattr(own_res, "data", None) or []
            if own_rows:
                return own_rows[0]

    res = q.order("updated_at", desc=True).limit(1).execute()
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=404, detail=f"No active '{provider}' connector integration found.")

    integ = rows[0]
    owner_id = str(integ.get("owner_user_id") or integ.get("connected_by") or "")
    if not is_admin and owner_id != str(auth.user_id):
        _audit_connector_event(
            company_id=auth.company_id,
            actor_id=auth.user_id,
            actor_email=auth.email,
            action="CONNECTOR_MANAGEMENT_DENIED",
            target_id=str(integ.get("id")),
            target_name=provider,
            details={"owner_user_id": owner_id, "connection_scope": integ.get("connection_scope")},
            status="FAILED",
        )
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Managers can only manage their own connected integrations.",
        )
    return integ


class SelectContainerRequest(BaseModel):
    container_id: str
    container_name: str
    container_path: str = "/"
    container_type: str = "folder"
    is_recursive: bool = True
    drive_id: Optional[str] = None
    integration_id: Optional[str] = None


@router.get("/status")
async def get_all_connectors_status(
    auth: RequestAuth = Depends(require_manager_or_above)
):
    """
    Returns connection and sync status for all registered cloud providers and accessible multi-instance connections.
    Admins see all org instances; Managers see instances they own or org-wide connectors.
    """
    company_id = auth.company_id
    is_admin = await check_user_permission(auth.user_id, "admin")

    providers = ConnectorRegistry.list_providers()
    display_map = {p["provider"]: p["display_name"] for p in providers}

    all_instances = await ConnectorManager.list_connector_statuses(company_id=company_id)
    visible_instances = []
    for st in all_instances:
        is_owner = str(st.owner_user_id or "") == str(auth.user_id)
        if is_admin or is_owner or st.connection_scope == "org":
            dump = st.model_dump()
            dump["display_name"] = display_map.get(st.provider, st.provider.replace("_", " ").title())
            dump["is_owner"] = is_owner
            dump["can_manage"] = is_admin or is_owner
            visible_instances.append(dump)

    statuses = []

    for p in providers:
        provider_name = p["provider"]
        try:
            matching = [inst for inst in visible_instances if inst["provider"] == provider_name]
            # Prefer caller's own instance if multiple exist for same provider
            matching.sort(key=lambda x: (not x.get("is_owner"), x.get("connection_scope") != "org"))
            if matching:
                st = matching[0]
                statuses.append({
                    "provider": provider_name,
                    "display_name": p["display_name"],
                    "integration_id": st.get("integration_id"),
                    "owner_user_id": st.get("owner_user_id"),
                    "connection_scope": st.get("connection_scope"),
                    "assigned_team_id": st.get("assigned_team_id"),
                    "visibility_mode": st.get("visibility_mode"),
                    "can_manage": st.get("can_manage", False),
                    "connected": st.get("connected", False),
                    "status": st.get("status", "disconnected"),
                    "account_identifier": st.get("account_identifier"),
                    "monitored_source_id": st.get("monitored_source_id"),
                    "monitored_source_name": st.get("monitored_source_name"),
                    "monitored_source_path": st.get("monitored_source_path"),
                    "monitored_source_type": st.get("monitored_source_type"),
                    "is_recursive": st.get("is_recursive", True),
                    "webhook_active": st.get("webhook_active", False),
                    "last_synced_at": st.get("last_synced_at"),
                    "total_synced_files": st.get("total_synced_files", 0),
                    "error_message": st.get("error_message"),
                    "connected_at": st.get("connected_at"),
                })
            else:
                statuses.append({
                    "provider": provider_name,
                    "display_name": p["display_name"],
                    "connected": False,
                    "status": "disconnected",
                    "can_manage": True,
                })
        except Exception as e:
            statuses.append({
                "provider": provider_name,
                "display_name": p["display_name"],
                "connected": False,
                "status": "error",
                "error_message": str(e),
            })

    return {"connectors": statuses, "instances": visible_instances}


@router.get("/{provider}/status")
async def get_single_connector_status(
    provider: str,
    integration_id: Optional[str] = Query(None),
    auth: RequestAuth = Depends(require_manager_or_above)
):
    """Returns detailed status of a specific cloud connector (or instance)."""
    company_id = auth.company_id
    if not ConnectorRegistry.is_registered(provider):
        raise HTTPException(status_code=404, detail=f"Provider '{provider}' is not supported.")

    is_admin = await check_user_permission(auth.user_id, "admin")
    all_instances = await ConnectorManager.list_connector_statuses(company_id=company_id, provider=provider)
    if integration_id:
        all_instances = [st for st in all_instances if st.integration_id == integration_id]
    visible = [
        st for st in all_instances
        if is_admin or str(st.owner_user_id or "") == str(auth.user_id) or st.connection_scope == "org"
    ]
    if visible:
        visible.sort(key=lambda x: (str(x.owner_user_id or "") != str(auth.user_id), x.connection_scope != "org"))
        status = visible[0]
    else:
        status = await ConnectorManager.get_connector_status(company_id=company_id, provider=provider, integration_id=integration_id)
        if not is_admin and status.connected and str(status.owner_user_id or "") != str(auth.user_id) and status.connection_scope != "org":
            return {"connected": False, "provider": provider, "integration": None}

    return {
        "connected": status.connected,
        "provider": provider,
        "integration": {
            "id": status.integration_id,
            "owner_user_id": status.owner_user_id,
            "connection_scope": status.connection_scope,
            "assigned_team_id": status.assigned_team_id,
            "visibility_mode": status.visibility_mode,
            "account_identifier": status.account_identifier,
            "container_id": status.monitored_source_id,
            "container_name": status.monitored_source_name,
            "container_path": status.monitored_source_path,
            "container_type": status.monitored_source_type,
            "status": status.status,
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


_in_memory_oauth_state: Dict[str, Dict[str, Any]] = {}


def persist_oauth_state(
    provider: str,
    company_id: str,
    user_id: str,
    auth_url: str,
    ttl: int = 900,
    extra_state: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """
    Extracts the nonce / state token from auth_url, persists it in Redis (and memory fallback)
    with a TTL (default 15 mins = 900s) to prevent CSRF, session fixation, and account binding attacks.
    """
    try:
        parsed = urllib.parse.urlparse(auth_url)
        qs = urllib.parse.parse_qs(parsed.query)
        raw_state = qs.get("state", [None])[0]
        if not raw_state:
            return None

        nonce = None
        try:
            decoded = urllib.parse.unquote(raw_state)
            data = json.loads(decoded)
            if isinstance(data, dict):
                nonce = data.get("nonce")
        except Exception:
            nonce = None

        state_record = {
            "company_id": str(company_id),
            "user_id": str(user_id),
            "provider": provider,
            "nonce": nonce,
            "created_at": time.time(),
            **(extra_state or {}),
        }
        record_json = json.dumps(state_record)

        keys_to_set = []
        if nonce:
            keys_to_set.append(f"oauth_state:{provider}:{nonce}")
            keys_to_set.append(f"oauth_state:{nonce}")

        state_hash = hashlib.sha256(raw_state.encode("utf-8")).hexdigest()
        keys_to_set.append(f"oauth_state_hash:{state_hash}")

        for k in keys_to_set:
            try:
                redis_client.setex(k, ttl, record_json)
            except Exception as r_err:
                print(f"[OAUTH STATE] Redis setex warning for {k}: {r_err}")

        exp_time = time.time() + ttl
        for k in keys_to_set:
            _in_memory_oauth_state[k] = {"record": state_record, "expires_at": exp_time}

        return nonce or raw_state
    except Exception as e:
        print(f"[OAUTH STATE] Error persisting oauth state: {e}")
        return None


def verify_and_consume_oauth_state(provider: str, state: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Validates the state parameter against server-persisted state in Redis (and memory fallback).
    Consumes the state token upon successful verification (one-time use to prevent replay).
    Returns state data dict with company_id, user_id, provider, or None if invalid/unknown/expired.
    """
    if not state:
        return None

    nonce = None
    try:
        decoded = urllib.parse.unquote(state)
        data = json.loads(decoded)
        if isinstance(data, dict):
            nonce = data.get("nonce")
    except Exception:
        nonce = None

    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()

    candidate_keys = []
    if nonce:
        candidate_keys.append(f"oauth_state:{provider}:{nonce}")
        candidate_keys.append(f"oauth_state:{nonce}")
    candidate_keys.append(f"oauth_state_hash:{state_hash}")
    candidate_keys.append(f"oauth_state:{provider}:{state}")
    candidate_keys.append(f"oauth_state:{state}")

    matched_record = None

    # 1. Try Redis first
    for k in candidate_keys:
        try:
            val = redis_client.get(k)
            if val:
                matched_record = json.loads(val)
                break
        except Exception as r_err:
            print(f"[OAUTH STATE] Redis get note for {k}: {r_err}")

    # 2. In-memory fallback
    if not matched_record:
        now = time.time()
        for k in candidate_keys:
            cached = _in_memory_oauth_state.get(k)
            if cached and cached.get("expires_at", 0) > now:
                matched_record = cached.get("record")
                break

    if not matched_record:
        return None

    # Validate provider matches
    record_provider = matched_record.get("provider")
    if record_provider and record_provider != provider:
        print(f"[OAUTH STATE] Provider mismatch: expected {provider}, found {record_provider}")
        return None

    # 3. Consume token (delete all candidate keys to prevent replay / session fixation)
    for k in candidate_keys:
        try:
            redis_client.delete(k)
        except Exception:
            pass
        _in_memory_oauth_state.pop(k, None)

    return matched_record


@router.get("/{provider}/auth-url")
async def get_connector_auth_url(
    provider: str,
    connection_scope: str = Query("team", description="org | team | personal"),
    assigned_team_id: Optional[str] = Query(None),
    assigned_team_type: Optional[str] = Query(None),
    visibility_mode: str = Query("acl_sync", description="acl_sync | team_only | company_wide"),
    auth: RequestAuth = Depends(require_manager_or_above)
):
    """Generates the OAuth consent URL for the requested cloud provider and persists RBAC scope server-side."""
    company_id = auth.company_id
    user_id = auth.user_id

    scope_clean = (connection_scope or "team").lower()
    vis_clean = (visibility_mode or "acl_sync").lower()
    if scope_clean not in ("org", "team", "personal"):
        raise HTTPException(status_code=400, detail="connection_scope must be 'org', 'team', or 'personal'.")
    if vis_clean not in ("acl_sync", "team_only", "company_wide"):
        raise HTTPException(status_code=400, detail="visibility_mode must be 'acl_sync', 'team_only', or 'company_wide'.")

    # Org-wide / company-wide connections require Admin+
    if scope_clean == "org" or vis_clean == "company_wide":
        is_admin = await check_user_permission(user_id, "admin")
        if not is_admin:
            raise HTTPException(
                status_code=403,
                detail="Only Company Administrators can establish org-wide or company-wide connectors.",
            )

    try:
        connector = ConnectorRegistry.get(provider)
        auth_url = connector.generate_auth_url(company_id=company_id, user_id=user_id)
        persist_oauth_state(
            provider=provider,
            company_id=company_id,
            user_id=user_id,
            auth_url=auth_url,
            extra_state={
                "connection_scope": scope_clean,
                "assigned_team_id": assigned_team_id,
                "assigned_team_type": assigned_team_type,
                "visibility_mode": vis_clean,
            },
        )
        return {"provider": provider, "auth_url": auth_url, "connection_scope": scope_clean}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate auth URL: {str(e)}")


@router.get("/{provider}/callback")
async def connector_oauth_callback(
    provider: str,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    error_subcode: Optional[str] = Query(None),
    background_tasks: BackgroundTasks = None
):
    """
    Universal OAuth redirect callback.
    Re-verifies manager+ role, creates multi-instance integration record, encrypts in Vault,
    and returns a postMessage HTML popup response.
    """
    if error:
        is_cancelled = (error_subcode == "cancel") or ("cancel" in str(error).lower()) or ("cancel" in str(error_description or "").lower())
        err_msg = "Sign-in was cancelled by user." if is_cancelled else (error_description or error)
        status_title = "Sign-in Cancelled" if is_cancelled else "Authentication Error"

        return HTMLResponse(content=f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>{status_title}</title>
            <style>
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #f8fafc;
                    color: #1e293b;
                }}
                .card {{
                    background: #ffffff;
                    border: 1px solid #e2e8f0;
                    border-radius: 16px;
                    padding: 32px;
                    text-align: center;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
                    max-width: 380px;
                }}
                h2 {{ margin: 0 0 8px; font-size: 16px; font-weight: 600; color: #0f172a; }}
                p {{ margin: 0; font-size: 13px; color: #64748b; }}
            </style>
        </head>
        <body>
            <div class="card">
                <h2>{status_title}</h2>
                <p>{err_msg}</p>
            </div>
            <script>
                if (window.opener) {{
                    window.opener.postMessage({{
                        type: "CONNECTOR_OAUTH_ERROR",
                        provider: "{provider}",
                        error: "{err_msg}",
                        cancelled: {"true" if is_cancelled else "false"}
                    }}, "*");
                }}
                setTimeout(function() {{
                    window.close();
                }}, 1200);
            </script>
        </body>
        </html>
        """, status_code=200)

    if not code:
        return HTMLResponse(content=f"""
        <html><body><script>
            if (window.opener) {{
                window.opener.postMessage({{ type: "CONNECTOR_OAUTH_ERROR", provider: "{provider}", error: "Authorization code missing from callback." }}, "*");
            }}
            window.close();
        </script><p>Authentication failed: Authorization code missing from callback.</p></body></html>
        """, status_code=400)

    # Validate and consume OAuth state from server-side cache (Redis)
    state_record = verify_and_consume_oauth_state(provider, state)
    if not state_record:
        return HTMLResponse(content=f"""
        <html><body><script>
            if (window.opener) {{
                window.opener.postMessage({{ type: "CONNECTOR_OAUTH_ERROR", provider: "{provider}", error: "Invalid, unknown, or expired OAuth state token. Please initiate connection again." }}, "*");
            }}
            window.close();
        </script><p>Authentication failed: Invalid, unknown, or expired OAuth state token.</p></body></html>
        """, status_code=400)

    company_id = state_record.get("company_id")
    user_id = state_record.get("user_id")

    if not company_id or not user_id:
        return HTMLResponse(content=f"""
        <html><body><script>
            if (window.opener) {{
                window.opener.postMessage({{ type: "CONNECTOR_OAUTH_ERROR", provider: "{provider}", error: "State parameter missing company or user context." }}, "*");
            }}
            window.close();
        </script><p>Authentication failed: State parameter missing company context.</p></body></html>
        """, status_code=400)

    # Defense-in-depth: verify caller still has Manager+ role at callback time
    has_perm = await check_user_permission(user_id, "manager")
    if not has_perm:
        _audit_connector_event(
            company_id=company_id,
            actor_id=user_id,
            actor_email=None,
            action="CONNECTOR_OAUTH_CALLBACK_DENIED",
            target_name=provider,
            details={"reason": "role_below_manager_at_callback"},
            status="FAILED",
        )
        return HTMLResponse(content=f"""
        <html><body><script>
            if (window.opener) {{
                window.opener.postMessage({{ type: "CONNECTOR_OAUTH_ERROR", provider: "{provider}", error: "Permission denied: Manager role or higher required." }}, "*");
            }}
            window.close();
        </script><p>Permission denied: Manager role or higher required.</p></body></html>
        """, status_code=403)

    connection_scope = state_record.get("connection_scope") or "team"
    assigned_team_id = state_record.get("assigned_team_id")
    assigned_team_type = state_record.get("assigned_team_type")
    visibility_mode = state_record.get("visibility_mode") or "acl_sync"

    # Re-check Admin role if org scope requested
    if connection_scope == "org" or visibility_mode == "company_wide":
        is_admin = await check_user_permission(user_id, "admin")
        if not is_admin:
            connection_scope = "team"
            visibility_mode = "acl_sync"

    # Auto-derive assigned_team_id from manager's function/sub_function if team scope omitted it
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

    connector = ConnectorRegistry.get(provider)

    try:
        token_payload = await connector.exchange_code(code)
    except Exception as exc:
        return HTMLResponse(content=f"""
        <html><body><script>
            if (window.opener) {{
                window.opener.postMessage({{ type: "CONNECTOR_OAUTH_ERROR", provider: "{provider}", error: "{str(exc)}" }}, "*");
            }}
            window.close();
        </script><p>Token exchange failed: {str(exc)}</p></body></html>
        """, status_code=500)

    access_token = token_payload["access_token"]
    refresh_token = token_payload.get("refresh_token")
    expires_in = token_payload.get("expires_in", 3600)
    account_identifier = token_payload.get("account_identifier", "connected_account")
    now_dt = datetime.now(timezone.utc)
    token_expires_at = (now_dt + timedelta(seconds=expires_in)).isoformat()

    # 1. Upsert multi-instance company_integrations record
    now_iso = now_dt.isoformat()
    integration_row = {
        "company_id": company_id,
        "provider": provider,
        "status": "active",
        "connected_by": user_id,
        "owner_user_id": user_id,
        "connection_scope": connection_scope,
        "assigned_team_type": assigned_team_type,
        "assigned_team_id": assigned_team_id,
        "visibility_mode": visibility_mode,
        "account_identifier": account_identifier,
        "token_expires_at": token_expires_at,
        "config": token_payload.get("extra") or {},
        "updated_at": now_iso
    }

    try:
        existing_inst_res = (
            supabase_admin.table("company_integrations")
            .select("id")
            .eq("company_id", company_id)
            .eq("provider", provider)
            .eq("owner_user_id", user_id)
            .eq("account_identifier", account_identifier)
            .limit(1)
            .execute()
        )
        existing_inst = getattr(existing_inst_res, "data", None) or []
        if existing_inst:
            integration_id = str(existing_inst[0]["id"])
            supabase_admin.table("company_integrations").update(integration_row).eq("id", integration_id).execute()
        else:
            ins_res = supabase_admin.table("company_integrations").insert(integration_row).execute()
            ins_rows = getattr(ins_res, "data", None) or []
            integration_id = str(ins_rows[0]["id"]) if ins_rows else None
    except Exception as col_err:
        if not is_missing_schema_error(col_err):
            raise
        legacy_row = {
            "company_id": company_id,
            "provider": provider,
            "status": "active",
            "connected_by": user_id,
            "account_identifier": account_identifier,
            "token_expires_at": token_expires_at,
            "config": token_payload.get("extra") or {},
            "updated_at": now_iso,
        }
        existing_legacy_res = (
            supabase_admin.table("company_integrations")
            .select("id")
            .eq("company_id", company_id)
            .eq("provider", provider)
            .limit(1)
            .execute()
        )
        existing_legacy = getattr(existing_legacy_res, "data", None) or []
        if existing_legacy:
            integration_id = str(existing_legacy[0]["id"])
            supabase_admin.table("company_integrations").update(legacy_row).eq("id", integration_id).execute()
        else:
            ins_res = supabase_admin.table("company_integrations").insert(legacy_row).execute()
            ins_rows = getattr(ins_res, "data", None) or []
            integration_id = str(ins_rows[0]["id"]) if ins_rows else None

    # Record primary external identity alias for ACL mapping
    try:
        if "@" in str(account_identifier):
            supabase_admin.table("user_external_identities").upsert({
                "user_id": str(user_id),
                "company_id": str(company_id),
                "provider": provider,
                "external_email": str(account_identifier).strip().lower(),
                "verified": True,
                "updated_at": now_iso,
            }, on_conflict="company_id,provider,user_id").execute()
    except Exception:
        pass

    # 2. Store tokens in Supabase Vault securely scoped by integration_id
    vault_args: Dict[str, Any] = {
        "p_company_id": str(company_id),
        "p_provider": provider,
        "p_access_token": access_token,
        "p_refresh_token": refresh_token or "",
        "p_token_expires_at": token_expires_at,
        "p_integration_id": integration_id,
    }
    try:
        supabase_admin.rpc("store_integration_tokens", vault_args).execute()
    except Exception as rpc_err:
        if "PGRST202" in str(rpc_err) or is_missing_schema_error(rpc_err):
            vault_args.pop("p_integration_id", None)
            supabase_admin.rpc("store_integration_tokens", vault_args).execute()
        else:
            raise

    _audit_connector_event(
        company_id=company_id,
        actor_id=user_id,
        actor_email=account_identifier if "@" in str(account_identifier) else None,
        action="CONNECTOR_CONNECTED",
        target_id=integration_id,
        target_name=f"{provider}:{account_identifier}",
        details={
            "connection_scope": connection_scope,
            "assigned_team_id": assigned_team_id,
            "visibility_mode": visibility_mode,
        },
    )

    # 3. Check whether a monitored source is already configured; if not, prompt user in UI
    needs_source_selection = True
    if integration_id:
        try:
            src_chk = (
                supabase_admin.table("integration_monitored_sources")
                .select("id")
                .eq("integration_id", integration_id)
                .limit(1)
                .execute()
            )
            if getattr(src_chk, "data", None):
                needs_source_selection = False
        except Exception:
            pass

    return HTMLResponse(content=f"""
    <!DOCTYPE html>
    <html>
    <head><title>Authentication Successful</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f8fafc;">
      <div style="background: white; padding: 32px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 400px;">
        <h2 style="color: #0f172a; margin-top: 0;">Connected to {connector.display_name}!</h2>
        <p style="color: #64748b; font-size: 14px;">Identity: <strong>{account_identifier}</strong></p>
        <p style="color: #10b981; font-weight: 600; font-size: 14px;">Closing window — choose your folder or channel in the dashboard...</p>
      </div>
      <script>
        if (window.opener) {{
          window.opener.postMessage({{
            type: "CONNECTOR_OAUTH_SUCCESS",
            provider: "{provider}",
            account: "{account_identifier}",
            integration_id: "{integration_id or ''}",
            needs_source_selection: {"true" if needs_source_selection else "false"}
          }}, "*");
        }}
        setTimeout(() => {{ window.close(); }}, 1200);
      </script>
    </body>
    </html>
    """)


@router.get("/{provider}/containers")
async def list_connector_containers(
    provider: str,
    parent_id: Optional[str] = Query(None),
    drive_id: Optional[str] = Query(None),
    query: Optional[str] = Query(None),
    integration_id: Optional[str] = Query(None),
    auth: RequestAuth = Depends(require_manager_or_above)
):
    """
    Returns browseable hierarchy of containers (folders, channels, labels, recordings).
    Supports lazy hierarchical drill-down via parent_id / drive_id.
    """
    company_id = auth.company_id
    integ = await _verify_integration_management_access(auth, provider, integration_id=integration_id)
    target_int_id = str(integ["id"])

    connector = ConnectorRegistry.get(provider)
    access_token = await ConnectorManager.get_valid_access_token(company_id, provider, integration_id=target_int_id)

    try:
        containers = await connector.list_containers(
            access_token=access_token,
            parent_id=parent_id,
            drive_id=drive_id,
            query=query
        )
        return {
            "provider": provider,
            "integration_id": target_int_id,
            "parent_id": parent_id,
            "containers": [c.model_dump() for c in containers]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list containers: {str(e)}")


@router.post("/{provider}/select-container")
async def select_connector_container(
    provider: str,
    payload: SelectContainerRequest,
    background_tasks: BackgroundTasks,
    integration_id: Optional[str] = Query(None),
    auth: RequestAuth = Depends(require_manager_or_above)
):
    """
    Sets the active monitored source for the provider instance and kicks off real-time push watch.
    """
    company_id = auth.company_id
    if provider == "google_drive" and payload.container_id == "shared_with_me":
        raise HTTPException(
            status_code=400,
            detail="Please open 'Shared with me' and select a specific shared folder rather than the virtual root.",
        )

    target_int_id_req = payload.integration_id or integration_id
    integ = await _verify_integration_management_access(auth, provider, integration_id=target_int_id_req)
    target_int_id = str(integ["id"])

    result = await ConnectorManager.select_monitored_container(
        company_id=company_id,
        container_id=payload.container_id,
        container_name=payload.container_name,
        container_path=payload.container_path,
        container_type=payload.container_type,
        is_recursive=payload.is_recursive,
        drive_id=payload.drive_id,
        provider=provider,
        integration_id=target_int_id,
    )

    _audit_connector_event(
        company_id=company_id,
        actor_id=auth.user_id,
        actor_email=auth.email,
        action="CONNECTOR_CONTAINER_SELECTED",
        target_id=target_int_id,
        target_name=payload.container_name,
        details={"provider": provider, "container_id": payload.container_id},
    )

    # Trigger initial scan in background
    background_tasks.add_task(
        ConnectorManager.sync_company_files,
        company_id=company_id,
        provider=provider,
        integration_id=target_int_id,
    )

    return {
        "success": True,
        "integration_id": target_int_id,
        "message": f"Successfully monitoring {payload.container_name}. Initial sync initiated.",
        "result": result
    }


@router.post("/{provider}/sync-now")
async def sync_connector_now(
    provider: str,
    background_tasks: BackgroundTasks,
    integration_id: Optional[str] = Query(None),
    auth: RequestAuth = Depends(require_manager_or_above)
):
    """Triggers an on-demand sync run across all monitored sources for the provider instance."""
    company_id = auth.company_id
    integ = await _verify_integration_management_access(auth, provider, integration_id=integration_id)
    target_int_id = str(integ["id"])

    res = await ConnectorManager.sync_company_files(
        company_id=company_id,
        provider=provider,
        integration_id=target_int_id,
    )
    _audit_connector_event(
        company_id=company_id,
        actor_id=auth.user_id,
        actor_email=auth.email,
        action="CONNECTOR_SYNC_TRIGGERED",
        target_id=target_int_id,
        target_name=provider,
        details={"synced": res.synced_count, "updated": res.updated_count, "deleted": res.deleted_count},
    )
    return {
        "success": True,
        "provider": provider,
        "integration_id": target_int_id,
        "result": res.model_dump()
    }


@router.post("/{provider}/disconnect")
async def disconnect_connector(
    provider: str,
    integration_id: Optional[str] = Query(None),
    auth: RequestAuth = Depends(require_manager_or_above)
):
    """Disconnects provider instance, cleans Vault tokens, and terminates webhooks."""
    company_id = auth.company_id
    integ = await _verify_integration_management_access(auth, provider, integration_id=integration_id)
    target_int_id = str(integ["id"])

    success = await ConnectorManager.disconnect_integration(
        company_id=company_id,
        provider=provider,
        integration_id=target_int_id,
    )
    _audit_connector_event(
        company_id=company_id,
        actor_id=auth.user_id,
        actor_email=auth.email,
        action="CONNECTOR_DISCONNECTED",
        target_id=target_int_id,
        target_name=provider,
    )
    return {
        "success": success,
        "integration_id": target_int_id,
        "message": f"Disconnected {provider} successfully."
    }


def check_shared_secret(request: Request, provider: str) -> bool:
    """
    Checks if incoming request presents a valid shared secret token:
    Headers:
      - X-Webhook-Token
      - X-Webhook-Secret
      - Authorization: Bearer <token>
    Matched against env vars:
      - {PROVIDER}_WEBHOOK_SECRET / {PROVIDER}_WEBHOOK_TOKEN
      - CONNECTOR_WEBHOOK_SECRET
      - WEBHOOK_SHARED_SECRET
    """
    token_candidate = (
        request.headers.get("X-Webhook-Token")
        or request.headers.get("X-Webhook-Secret")
        or ""
    ).strip()

    if not token_candidate:
        auth_hdr = request.headers.get("Authorization", "").strip()
        if auth_hdr.lower().startswith("bearer "):
            token_candidate = auth_hdr[7:].strip()

    if not token_candidate:
        return False

    prov_upper = provider.upper()
    valid_secrets = [
        os.getenv(f"{prov_upper}_WEBHOOK_SECRET", "").strip(),
        os.getenv(f"{prov_upper}_WEBHOOK_TOKEN", "").strip(),
        os.getenv("CONNECTOR_WEBHOOK_SECRET", "").strip(),
        os.getenv("WEBHOOK_SHARED_SECRET", "").strip(),
    ]

    # Additional provider-specific secret aliases
    if provider in ("google_drive", "gmail", "google_meet"):
        valid_secrets.append(os.getenv("GOOGLE_WEBHOOK_SECRET", "").strip())
        valid_secrets.append(os.getenv("GOOGLE_DRIVE_WEBHOOK_SECRET", "").strip())
    elif provider in ("onedrive", "teams"):
        valid_secrets.append(os.getenv("MICROSOFT_WEBHOOK_SECRET", "").strip())
        valid_secrets.append(os.getenv("MICROSOFT_WEBHOOK_TOKEN", "").strip())

    for secret in valid_secrets:
        if secret and hmac.compare_digest(token_candidate, secret):
            return True

    return False


@router.post("/{provider}/webhook")
async def connector_webhook_listener(
    provider: str,
    request: Request,
    background_tasks: BackgroundTasks,
    validationToken: Optional[str] = Query(None)
):
    """
    Universal Webhook Listener with Strict Authentication & Scoped Tenant Dispatch:
    - Rejects unauthenticated requests with HTTP 401
    - Enforces provider-specific signatures (Slack HMAC, Zoom CRC/HMAC, MS Graph subscription verification)
    - Validates Google push notification channels (X-Goog-Channel-ID) against registered database channels
    - Supports shared secret (X-Webhook-Token) per provider
    - Resolves exact tenant company_id to prevent unconstrained cross-tenant sync
    - Implements Redis burst debouncing
    """
    if not ConnectorRegistry.is_registered(provider):
        raise HTTPException(status_code=404, detail=f"Provider '{provider}' is not supported.")

    # 1. Microsoft Graph Webhook Handshake (subscription validation)
    if validationToken:
        return Response(content=validationToken, media_type="text/plain", status_code=200)

    raw_body = await request.body()
    body_json: Dict[str, Any] = {}
    if raw_body:
        try:
            body_json = json.loads(raw_body.decode("utf-8"))
        except Exception:
            pass

    has_shared_secret = check_shared_secret(request, provider)
    target_targets: List[tuple] = []  # List[(company_id, integration_id)]

    # ── 2. Provider-Specific Verification & Tenant Resolution ───────

    # --- SLACK ---
    if provider == "slack":
        # Slack Challenge Handshake
        if body_json.get("type") == "url_verification":
            challenge = body_json.get("challenge")
            if not challenge:
                raise HTTPException(status_code=400, detail="Missing challenge token.")
            return JSONResponse(content={"challenge": challenge})

        ts = request.headers.get("X-Slack-Request-Timestamp", "")
        sig = request.headers.get("X-Slack-Signature", "")
        signing_secret = (
            os.getenv("SLACK_SIGNING_SECRET", "").strip()
            or os.getenv("SLACK_WEBHOOK_SECRET", "").strip()
        )
        if not signing_secret:
            try:
                _, _, signing_secret, _, _ = get_slack_credentials()
            except Exception:
                pass

        sig_verified = False
        if signing_secret and ts and sig:
            sig_verified = verify_slack_signature(raw_body, ts, sig, signing_secret)

        if not sig_verified and not has_shared_secret:
            raise HTTPException(status_code=401, detail="Invalid or missing Slack webhook signature/secret.")

        # Resolve tenant & integration instance: team_id
        team_id = body_json.get("team_id")
        if not team_id:
            auths = body_json.get("authorizations") or []
            if auths and isinstance(auths, list) and isinstance(auths[0], dict):
                team_id = auths[0].get("team_id")

        if team_id:
            res = (
                supabase_admin.table("company_integrations")
                .select("id, company_id")
                .eq("provider", "slack")
                .eq("status", "active")
                .filter("config->>team_id", "eq", team_id)
                .execute()
            )
            rows = res.data if (res and getattr(res, "data", None)) else []
            if not rows:
                res = (
                    supabase_admin.table("company_integrations")
                    .select("id, company_id")
                    .eq("provider", "slack")
                    .eq("status", "active")
                    .ilike("account_identifier", f"%{team_id}%")
                    .execute()
                )
                rows = res.data if (res and getattr(res, "data", None)) else []
            target_targets = [(r["company_id"], r.get("id")) for r in rows if r.get("company_id")]

    # --- ZOOM ---
    elif provider == "zoom":
        event = body_json.get("event")
        secret_token = (
            os.getenv("ZOOM_WEBHOOK_SECRET_TOKEN", "").strip()
            or os.getenv("ZOOM_WEBHOOK_SECRET", "").strip()
        )
        if not secret_token:
            try:
                _, _, secret_token, _, _ = get_zoom_credentials()
            except Exception:
                pass

        # Zoom CRC Challenge Handshake
        if event == "endpoint.url_validation":
            plain_token = (body_json.get("payload") or {}).get("plainToken", "")
            if not plain_token:
                raise HTTPException(status_code=400, detail="Missing plainToken for Zoom CRC validation.")
            if not secret_token:
                raise HTTPException(status_code=401, detail="ZOOM_WEBHOOK_SECRET_TOKEN missing.")
            encrypted_token = validate_zoom_crc(plain_token, secret_token)
            return JSONResponse(content={
                "plainToken": plain_token,
                "encryptedToken": encrypted_token
            })

        # Regular notification verification
        zm_sig = request.headers.get("x-zm-signature") or request.headers.get("X-Zm-Signature", "")
        zm_ts = request.headers.get("x-zm-request-timestamp") or request.headers.get("X-Zm-Request-Timestamp", "")

        sig_verified = False
        if secret_token and zm_sig and zm_ts:
            sig_verified = verify_zoom_signature(raw_body, zm_ts, zm_sig, secret_token)

        if not sig_verified and not has_shared_secret:
            raise HTTPException(status_code=401, detail="Invalid or missing Zoom webhook signature/secret.")

        # Resolve tenant: host_email or account_id
        payload_obj = body_json.get("payload") or {}
        host_email = (payload_obj.get("object") or {}).get("host_email")
        account_id = payload_obj.get("account_id")

        if host_email:
            res = (
                supabase_admin.table("company_integrations")
                .select("id, company_id")
                .eq("provider", "zoom")
                .eq("status", "active")
                .eq("account_identifier", host_email)
                .execute()
            )
            rows = res.data if (res and getattr(res, "data", None)) else []
            target_targets = [(r["company_id"], r.get("id")) for r in rows if r.get("company_id")]

        if not target_targets and account_id:
            res = (
                supabase_admin.table("company_integrations")
                .select("id, company_id")
                .eq("provider", "zoom")
                .eq("status", "active")
                .filter("config->>account_id", "eq", account_id)
                .execute()
            )
            rows = res.data if (res and getattr(res, "data", None)) else []
            target_targets = [(r["company_id"], r.get("id")) for r in rows if r.get("company_id")]

    # --- MICROSOFT GRAPH (OneDrive, Teams) ---
    elif provider in ("onedrive", "teams"):
        value_list = body_json.get("value")
        sub_items = []
        if isinstance(value_list, list):
            for item in value_list:
                if isinstance(item, dict) and item.get("subscriptionId"):
                    sub_items.append((item.get("subscriptionId"), item.get("clientState")))

        matched_pairs = []
        for sub_id, client_state in sub_items:
            res = (
                supabase_admin.table("company_integrations")
                .select("id, company_id, config")
                .eq("provider", provider)
                .eq("status", "active")
                .filter("config->>webhook_channel_id", "eq", sub_id)
                .limit(1)
                .execute()
            )
            row = res.data[0] if (res and getattr(res, "data", None)) else None
            if row:
                stored_client_state = (row.get("config") or {}).get("client_state")
                if stored_client_state and client_state and not hmac.compare_digest(str(stored_client_state), str(client_state)):
                    continue
                matched_pairs.append((row["company_id"], row.get("id")))

        if not matched_pairs and not has_shared_secret:
            raise HTTPException(status_code=401, detail=f"Unrecognized or inactive {provider} subscription resource.")

        target_targets = list(set(matched_pairs))

    # --- GOOGLE (Google Drive, Google Meet, Gmail) ---
    elif provider in ("google_drive", "google_meet", "gmail"):
        channel_id = (
            request.headers.get("X-Goog-Channel-ID")
            or request.headers.get("x-goog-channel-id")
        )
        resource_state = (
            request.headers.get("X-Goog-Resource-State")
            or request.headers.get("x-goog-resource-state")
        )

        # Initial Google handshake confirmation
        if resource_state == "sync":
            if channel_id:
                res = (
                    supabase_admin.table("company_integrations")
                    .select("company_id")
                    .eq("provider", provider)
                    .filter("config->>webhook_channel_id", "eq", channel_id)
                    .limit(1)
                    .execute()
                )
                if not (res and getattr(res, "data", None)) and not has_shared_secret:
                    raise HTTPException(status_code=401, detail=f"Unrecognized {provider} handshake channel.")
            elif not has_shared_secret:
                raise HTTPException(status_code=401, detail=f"Missing X-Goog-Channel-ID header for {provider}.")
            return Response(content="OK", status_code=200)

        matched_company_id = None
        matched_int_id = None
        if channel_id:
            res = (
                supabase_admin.table("company_integrations")
                .select("id, company_id, status")
                .eq("provider", provider)
                .eq("status", "active")
                .filter("config->>webhook_channel_id", "eq", channel_id)
                .limit(1)
                .execute()
            )
            row = res.data[0] if (res and getattr(res, "data", None)) else None
            if row:
                matched_company_id = row["company_id"]
                matched_int_id = row.get("id")
            elif provider == "google_drive":
                # Fallback check against legacy google_drive_integrations table
                legacy_res = (
                    supabase_admin.table("google_drive_integrations")
                    .select("company_id, sync_status")
                    .eq("webhook_channel_id", channel_id)
                    .limit(1)
                    .execute()
                )
                legacy_row = legacy_res.data[0] if (legacy_res and getattr(legacy_res, "data", None)) else None
                if legacy_row:
                    matched_company_id = legacy_row["company_id"]

        if not matched_company_id and not has_shared_secret:
            raise HTTPException(
                status_code=401,
                detail=f"Unauthenticated {provider} webhook: missing or invalid X-Goog-Channel-ID or shared secret."
            )

        if matched_company_id:
            target_targets = [(matched_company_id, matched_int_id)]

    # --- ANY OTHER REGISTERED PROVIDER ---
    else:
        if not has_shared_secret:
            raise HTTPException(status_code=401, detail=f"Unauthorized webhook for provider '{provider}'.")

    # ── 3. Tenant Target Fallback for Authenticated Shared Secret Calls ───
    if not target_targets and has_shared_secret:
        explicit_company_id = (
            request.query_params.get("company_id")
            or request.headers.get("X-Company-ID")
            or body_json.get("company_id")
        )
        explicit_int_id = request.query_params.get("integration_id") or body_json.get("integration_id")
        if explicit_company_id:
            target_targets = [(str(explicit_company_id), str(explicit_int_id) if explicit_int_id else None)]
        else:
            # Shared secret verified, but no specific tenant indicated.
            # Do NOT broadcast to all companies to avoid unintended cross-tenant sync.
            return JSONResponse(
                content={
                    "status": "ignored",
                    "provider": provider,
                    "detail": "Webhook authenticated but no specific tenant identified; cross-tenant broadcast blocked."
                },
                status_code=200
            )

    if not target_targets:
        return JSONResponse(
            content={
                "status": "ignored",
                "provider": provider,
                "detail": "No active integration matched webhook event."
            },
            status_code=200
        )

    # ── 4. Debounced Background Incremental CDC / Sync ───────────────
    from services.connectors.cdc_worker import run_incremental_cdc_sync

    unique_company_ids = set()
    for cid, int_id in target_targets:
        unique_company_ids.add(cid)
        debounce_key = f"connector_webhook_debounce:{provider}:{int_id or cid}"
        is_new = True
        try:
            is_new = bool(redis_client.set(debounce_key, "active", ex=5, nx=True))
        except Exception as redis_err:
            print(f"[{provider.upper()} WEBHOOK] Redis debounce note: {redis_err}")
            is_new = True

        if is_new:
            if int_id:
                background_tasks.add_task(
                    run_incremental_cdc_sync,
                    company_id=cid,
                    provider=provider,
                    integration_id=int_id,
                )
            else:
                background_tasks.add_task(
                    ConnectorManager.sync_company_files,
                    company_id=cid,
                    provider=provider,
                )
        else:
            print(f"[{provider.upper()} WEBHOOK] Coalescing burst notification for company {cid}")

    return JSONResponse(
        content={
            "status": "received",
            "provider": provider,
            "targeted_companies_count": len(unique_company_ids),
            "targeted_integrations_count": len(target_targets),
        },
        status_code=200
    )

