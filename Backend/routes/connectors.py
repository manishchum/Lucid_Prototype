# Backend/routes/connectors.py
"""
Universal Multi-Connector API Router for Enterprise Integrations.
Serves: Google Drive, OneDrive, Microsoft Teams, Slack, Zoom, Google Meet, and Gmail.
"""

import os
import json
import urllib.parse
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks, Header, Query
from fastapi.responses import RedirectResponse, JSONResponse, Response, HTMLResponse
from pydantic import BaseModel, Field

from config import FRONTEND_URL
from utils.auth import RequestAuth, get_request_auth_required
from utils.supabase_client import supabase_admin
from utils.logging import mask_email
from services.connectors import ConnectorManager, ConnectorRegistry
from services.connectors.providers.slack.client import verify_slack_signature, get_slack_credentials
from services.connectors.providers.zoom.client import validate_zoom_crc, get_zoom_credentials

router = APIRouter(
    prefix="/api/connectors",
    tags=["Unified Cloud Connectors"]
)


class SelectContainerRequest(BaseModel):
    container_id: str
    container_name: str
    container_path: str = "/"
    container_type: str = "folder"
    is_recursive: bool = True
    drive_id: Optional[str] = None


@router.get("/status")
async def get_all_connectors_status(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Returns connection and sync status for all registered cloud providers.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    providers = ConnectorRegistry.list_providers()
    statuses = []

    for p in providers:
        provider_name = p["provider"]
        try:
            st = await ConnectorManager.get_connector_status(company_id=company_id, provider=provider_name)
            statuses.append({
                "provider": provider_name,
                "display_name": p["display_name"],
                "connected": st.connected,
                "status": st.status,
                "account_identifier": st.account_identifier,
                "monitored_source_id": st.monitored_source_id,
                "monitored_source_name": st.monitored_source_name,
                "monitored_source_path": st.monitored_source_path,
                "monitored_source_type": st.monitored_source_type,
                "is_recursive": st.is_recursive,
                "webhook_active": st.webhook_active,
                "last_synced_at": st.last_synced_at,
                "total_synced_files": st.total_synced_files,
                "error_message": st.error_message,
                "connected_at": st.connected_at
            })
        except Exception as e:
            statuses.append({
                "provider": provider_name,
                "display_name": p["display_name"],
                "connected": False,
                "status": "error",
                "error_message": str(e)
            })

    return {"connectors": statuses}


@router.get("/{provider}/status")
async def get_single_connector_status(
    provider: str,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Returns detailed status of a specific cloud connector."""
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id is required.")

    if not ConnectorRegistry.is_registered(provider):
        raise HTTPException(status_code=404, detail=f"Provider '{provider}' is not supported.")

    status = await ConnectorManager.get_connector_status(company_id=company_id, provider=provider)
    return {
        "connected": status.connected,
        "provider": provider,
        "integration": {
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


@router.get("/{provider}/auth-url")
async def get_connector_auth_url(
    provider: str,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Generates the OAuth consent URL for the requested cloud provider."""
    company_id = auth.company_id
    user_id = auth.user_id
    if not company_id or not user_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id and user_id required.")

    try:
        connector = ConnectorRegistry.get(provider)
        auth_url = connector.generate_auth_url(company_id=company_id, user_id=user_id)
        return {"provider": provider, "auth_url": auth_url}
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
    background_tasks: BackgroundTasks = None
):
    """
    Universal OAuth redirect callback.
    Exchanges code for tokens, encrypts in Supabase Vault, creates integration record,
    and returns a postMessage HTML popup response.
    """
    if error:
        err_msg = error_description or error
        return HTMLResponse(content=f"""
        <html><body><script>
            if (window.opener) {{
                window.opener.postMessage({{ type: "CONNECTOR_OAUTH_ERROR", provider: "{provider}", error: "{err_msg}" }}, "*");
            }}
            window.close();
        </script><p>Authentication failed: {err_msg}</p></body></html>
        """, status_code=400)

    if not code:
        raise HTTPException(status_code=400, detail="Authorization code missing from callback.")

    # Decode CSRF state
    company_id = None
    user_id = None
    if state:
        try:
            state_data = json.loads(urllib.parse.unquote(state))
            company_id = state_data.get("company_id")
            user_id = state_data.get("user_id")
        except Exception:
            pass

    if not company_id:
        raise HTTPException(status_code=400, detail="Invalid state parameter: missing company context.")

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

    # 1. Upsert company_integrations record
    now_iso = now_dt.isoformat()
    integration_row = {
        "company_id": company_id,
        "provider": provider,
        "status": "active",
        "connected_by": user_id,
        "account_identifier": account_identifier,
        "token_expires_at": token_expires_at,
        "config": token_payload.get("extra") or {},
        "updated_at": now_iso
    }
    supabase_admin.table("company_integrations").upsert(
        integration_row,
        on_conflict="company_id,provider"
    ).execute()

    # 2. Store tokens in Supabase Vault securely
    supabase_admin.rpc("store_integration_tokens", {
        "p_company_id": str(company_id),
        "p_provider": provider,
        "p_access_token": access_token,
        "p_refresh_token": refresh_token or "",
        "p_token_expires_at": token_expires_at
    }).execute()

    # 3. Discover default container & trigger initial sync in background
    async def _post_connect_setup():
        try:
            containers = await connector.list_containers(access_token)
            if containers:
                first_container = containers[0]
                await ConnectorManager.select_monitored_container(
                    company_id=company_id,
                    container_id=first_container.id,
                    container_name=first_container.name,
                    container_path=first_container.path,
                    container_type=first_container.container_type,
                    drive_id=first_container.drive_id,
                    provider=provider
                )
                await ConnectorManager.sync_company_files(company_id, provider=provider)
        except Exception as e:
            print(f"[{provider.upper()} AUTO-SETUP] Note: {e}")

    if background_tasks:
        background_tasks.add_task(_post_connect_setup)

    return HTMLResponse(content=f"""
    <!DOCTYPE html>
    <html>
    <head><title>Authentication Successful</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f8fafc;">
      <div style="background: white; padding: 32px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 400px;">
        <h2 style="color: #0f172a; margin-top: 0;">Connected to {connector.display_name}!</h2>
        <p style="color: #64748b; font-size: 14px;">Identity: <strong>{account_identifier}</strong></p>
        <p style="color: #10b981; font-weight: 600; font-size: 14px;">Closing window and updating your dashboard...</p>
      </div>
      <script>
        if (window.opener) {{
          window.opener.postMessage({{
            type: "CONNECTOR_OAUTH_SUCCESS",
            provider: "{provider}",
            account: "{account_identifier}"
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
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Returns browseable hierarchy of containers (folders, channels, labels, recordings).
    Supports lazy hierarchical drill-down via parent_id / drive_id.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id required.")

    connector = ConnectorRegistry.get(provider)
    access_token = await ConnectorManager.get_valid_access_token(company_id, provider)

    try:
        containers = await connector.list_containers(
            access_token=access_token,
            parent_id=parent_id,
            drive_id=drive_id,
            query=query
        )
        return {
            "provider": provider,
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
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Sets the active monitored source for the provider and kicks off real-time push watch.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id required.")

    result = await ConnectorManager.select_monitored_container(
        company_id=company_id,
        container_id=payload.container_id,
        container_name=payload.container_name,
        container_path=payload.container_path,
        container_type=payload.container_type,
        is_recursive=payload.is_recursive,
        drive_id=payload.drive_id,
        provider=provider
    )

    # Trigger initial scan in background
    background_tasks.add_task(
        ConnectorManager.sync_company_files,
        company_id=company_id,
        provider=provider
    )

    return {
        "success": True,
        "message": f"Successfully monitoring {payload.container_name}. Initial sync initiated.",
        "result": result
    }


@router.post("/{provider}/sync-now")
async def sync_connector_now(
    provider: str,
    background_tasks: BackgroundTasks,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Triggers an on-demand sync run across all monitored sources for the provider."""
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id required.")

    # Execute sync directly or in background
    res = await ConnectorManager.sync_company_files(company_id=company_id, provider=provider)
    return {
        "success": True,
        "provider": provider,
        "result": res.model_dump()
    }


@router.post("/{provider}/disconnect")
async def disconnect_connector(
    provider: str,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Disconnects provider, cleans Vault tokens, and terminates webhooks."""
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id required.")

    success = await ConnectorManager.disconnect_integration(company_id=company_id, provider=provider)
    return {
        "success": success,
        "message": f"Disconnected {provider} successfully."
    }


@router.post("/{provider}/webhook")
async def connector_webhook_listener(
    provider: str,
    request: Request,
    background_tasks: BackgroundTasks,
    validationToken: Optional[str] = Query(None)
):
    """
    Universal Webhook Listener. Handles:
    - Microsoft Graph subscription handshake (validationToken query param)
    - Slack URL verification challenge and HMAC signature validation
    - Zoom CRC challenge verification (endpoint.url_validation)
    - Google Push Notifications (X-Goog-Channel-ID)
    """
    # 1. Microsoft Graph Webhook Handshake
    if validationToken:
        return Response(content=validationToken, media_type="text/plain", status_code=200)

    raw_body = await request.body()
    body_json: Dict[str, Any] = {}
    if raw_body:
        try:
            body_json = json.loads(raw_body.decode("utf-8"))
        except Exception:
            pass

    # 2. Slack Challenge Verification & HMAC Signature
    if provider == "slack":
        if body_json.get("type") == "url_verification":
            return JSONResponse(content={"challenge": body_json.get("challenge")})

        # Verify HMAC signature
        ts = request.headers.get("X-Slack-Request-Timestamp", "")
        sig = request.headers.get("X-Slack-Signature", "")
        _, _, signing_secret, _, _ = get_slack_credentials()
        if signing_secret and not verify_slack_signature(raw_body, ts, sig, signing_secret):
            raise HTTPException(status_code=401, detail="Invalid Slack webhook signature.")

    # 3. Zoom CRC Challenge Verification
    if provider == "zoom":
        if body_json.get("event") == "endpoint.url_validation":
            plain_token = (body_json.get("payload") or {}).get("plainToken", "")
            _, _, secret_token, _, _ = get_zoom_credentials()
            if not secret_token:
                raise HTTPException(status_code=500, detail="ZOOM_WEBHOOK_SECRET_TOKEN missing.")
            encrypted_token = validate_zoom_crc(plain_token, secret_token)
            return JSONResponse(content={
                "plainToken": plain_token,
                "encryptedToken": encrypted_token
            })

    # 4. Trigger background delta sync for relevant companies
    async def _handle_webhook_change():
        try:
            # Query active integrations for this provider
            res = (
                supabase_admin.table("company_integrations")
                .select("company_id")
                .eq("provider", provider)
                .eq("status", "active")
                .execute()
            )
            companies = res.data if (res and getattr(res, "data", None)) else []
            for c in companies:
                await ConnectorManager.sync_company_files(c["company_id"], provider=provider)
        except Exception as e:
            print(f"[{provider.upper()} WEBHOOK] Background sync note: {e}")

    background_tasks.add_task(_handle_webhook_change)

    return JSONResponse(content={"status": "received", "provider": provider}, status_code=200)

