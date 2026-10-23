# Backend/services/google_drive_service.py
"""
Google Drive Connector Service for Performance Coach Ingestion.
Handles:
1. OAuth2 Authorization & Token Lifecycle (Encrypted storage).
2. Dedicated Ingestion Folder Management ("Lucid Coach Ingestion").
3. Real-time Google Push Webhook Notifications (drive.changes.watch).
4. File Synchronization, Format Conversion (Google Docs/Sheets -> PDF/Excel),
   and Dispatching to Coach Ingestion Pipeline.
"""

import os
import json
import uuid
import hashlib
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List, Tuple
import httpx

from utils.supabase_client import supabase_admin
from ingestion.coach_store import create_document_record
from ingestion.coach_pipeline import run_coach_file_ingestion

# Google API Endpoints
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"

# Scopes
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email"
]

# Supported extensions
ALLOWED_EXTENSIONS = {"pdf", "docx", "doc", "csv", "xlsx", "xls", "pptx", "ppt"}
BUCKET_NAME = "coach-documents"
TEMP_DIR = os.path.join(os.getcwd(), "storage", "temp_coach_uploads")

# Google Workspace MIME Types for Export
GOOGLE_WORKSPACE_EXPORTS = {
    "application/vnd.google-apps.document": {
        "export_mime": "application/pdf",
        "ext": "pdf"
    },
    "application/vnd.google-apps.spreadsheet": {
        "export_mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ext": "xlsx"
    },
    "application/vnd.google-apps.presentation": {
        "export_mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "ext": "pptx"
    }
}


def _get_oauth_credentials() -> Tuple[str, str, str, str]:
    client_id = os.getenv("GOOGLE_DRIVE_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_DRIVE_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv("GOOGLE_DRIVE_REDIRECT_URI", "").strip()
    webhook_url = os.getenv("GOOGLE_DRIVE_WEBHOOK_URL", "").strip()

    if not client_id or not client_secret:
        raise ValueError("GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET is missing from environment.")
    
    return client_id, client_secret, redirect_uri, webhook_url


def generate_auth_url(company_id: str, user_id: str) -> str:
    """Generates the Google OAuth consent URL with state encoding company & user info."""
    client_id, _, redirect_uri, _ = _get_oauth_credentials()
    
    state_payload = {
        "company_id": company_id,
        "user_id": user_id,
        "nonce": str(uuid.uuid4())
    }
    state_str = urllib.parse.quote(json.dumps(state_payload))

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state_str,
        "include_granted_scopes": "true"
    }

    query_str = urllib.parse.urlencode(params)
    return f"{GOOGLE_AUTH_URL}?{query_str}"


async def exchange_code_for_tokens(code: str) -> Dict[str, Any]:
    """Exchanges the authorization code for access and refresh tokens."""
    client_id, client_secret, redirect_uri, _ = _get_oauth_credentials()

    payload = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code"
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(GOOGLE_TOKEN_URL, data=payload)
        if res.status_code != 200:
            raise RuntimeError(f"Google token exchange failed ({res.status_code}): {res.text}")
        return res.json()


async def get_google_user_email(access_token: str) -> str:
    """Fetches user email from Google userinfo endpoint."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"}
        )
        if res.status_code == 200:
            data = res.json()
            return data.get("email") or "unknown@google.com"
        return "unknown@google.com"


async def get_valid_access_token(integration: Dict[str, Any]) -> str:
    """
    Returns a valid Google Drive access token retrieved securely from Supabase Vault.
    If the token is near expiration or missing, automatically refreshes it using the stored
    refresh token in Vault and updates the secret.
    """
    company_id = integration.get("company_id")
    if not company_id:
        raise ValueError("Integration dictionary must contain company_id.")

    current_time = datetime.now(timezone.utc)

    # 1. Fetch decrypted credentials from Supabase Vault via secure service_role RPC
    token_rpc = supabase_admin.rpc("get_google_drive_tokens", {"p_company_id": str(company_id)}).execute()
    vault_data = getattr(token_rpc, "data", None) or {}

    access_token = vault_data.get("access_token")
    refresh_token = vault_data.get("refresh_token")
    token_expires_at = vault_data.get("token_expires_at") or integration.get("token_expires_at")

    # Check if access token is still valid (with 3-minute grace period)
    is_valid = False
    if access_token and token_expires_at:
        try:
            exp_dt = datetime.fromisoformat(str(token_expires_at).replace("Z", "+00:00"))
            if exp_dt > current_time + timedelta(minutes=3):
                is_valid = True
        except Exception:
            is_valid = False

    if is_valid and access_token:
        return access_token

    # 2. Token is expired or missing; perform refresh using refresh_token stored in Vault
    if not refresh_token:
        raise ValueError(f"No refresh token available in Supabase Vault for company {company_id}")

    client_id, client_secret, _, _ = _get_oauth_credentials()

    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token"
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(GOOGLE_TOKEN_URL, data=payload)
        if res.status_code != 200:
            raise RuntimeError(f"Token refresh failed ({res.status_code}): {res.text}")
        token_data = res.json()

    new_access_token = token_data.get("access_token")
    new_refresh_token = token_data.get("refresh_token") or refresh_token
    expires_in = token_data.get("expires_in", 3600)
    new_expires_at = (current_time + timedelta(seconds=expires_in)).isoformat()

    # 3. Store refreshed tokens securely into Supabase Vault via RPC
    supabase_admin.rpc("store_google_drive_tokens", {
        "p_company_id": str(company_id),
        "p_access_token": new_access_token,
        "p_refresh_token": new_refresh_token,
        "p_token_expires_at": new_expires_at
    }).execute()

    return new_access_token


async def ensure_ingestion_folder(access_token: str, folder_name: str = "Lucid Coach Ingestion") -> Tuple[str, str]:
    """
    Searches for a designated folder. If not present, creates it.
    Returns (folder_id, folder_name).
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    query = f"mimeType = 'application/vnd.google-apps.folder' and name = '{folder_name}' and trashed = false"

    async with httpx.AsyncClient(timeout=25.0) as client:
        # Search in both My Drive and Google Workspace Shared/Team Drives
        res = await client.get(
            f"{GOOGLE_DRIVE_API_BASE}/files",
            headers=headers,
            params={
                "q": query,
                "fields": "files(id, name)",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true"
            }
        )

        if res.status_code == 200:
            files = res.json().get("files", [])
            if files:
                print(f"[GOOGLE DRIVE] Located existing designated folder '{folder_name}' (ID: {files[0]['id']})")
                return files[0]["id"], files[0]["name"]
        else:
            err_body = res.text
            print(f"[GOOGLE DRIVE] Folder lookup returned status {res.status_code}: {err_body}")
            if res.status_code == 403 and ("accessNotConfigured" in err_body or "SERVICE_DISABLED" in err_body):
                try:
                    data = res.json()
                    msg = data.get("error", {}).get("message", "Google Drive API is disabled.")
                except Exception:
                    msg = "Google Drive API is disabled in your Google Cloud Project."
                raise RuntimeError(msg)

        # Folder does not exist, attempt to create it automatically
        print(f"[GOOGLE DRIVE] Folder '{folder_name}' not found. Attempting to create it...")
        create_res = await client.post(
            f"{GOOGLE_DRIVE_API_BASE}/files",
            headers=headers,
            params={"supportsAllDrives": "true"},
            json={
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder",
                "description": "Folder monitored by Lucid for automated Employee Performance Coach ingestion."
            }
        )
        if create_res.status_code in (200, 201):
            created_folder = create_res.json()
            print(f"[GOOGLE DRIVE] Successfully created designated folder '{folder_name}' (ID: {created_folder['id']})")
            return created_folder["id"], created_folder["name"]

        err_text = create_res.text
        print(f"[GOOGLE DRIVE] Folder creation failed with status {create_res.status_code}: {err_text}")

        if create_res.status_code == 403:
            if "accessNotConfigured" in err_text or "SERVICE_DISABLED" in err_text:
                try:
                    data = create_res.json()
                    msg = data.get("error", {}).get("message", "Google Drive API is disabled in your Google Cloud project.")
                except Exception:
                    msg = "Google Drive API is disabled in your Google Cloud Project."
                raise RuntimeError(msg)
            elif "insufficientPermissions" in err_text:
                raise RuntimeError(
                    f"Folder '{folder_name}' was not found in your Google Drive and write permissions were not granted. Please create a folder named '{folder_name}' in your Google Drive and reconnect."
                )

    raise RuntimeError(f"Failed to create or locate designated Google Drive ingestion folder '{folder_name}'. Response: {err_text}")


async def register_webhook_watch(access_token: str, folder_id: str) -> Dict[str, Any]:
    """
    Registers a Google Drive push notification watch channel for changes.
    """
    _, _, _, webhook_url = _get_oauth_credentials()
    if not webhook_url:
        print("[GOOGLE DRIVE] GOOGLE_DRIVE_WEBHOOK_URL is not configured; skipping push webhook registration.")
        return {}

    channel_id = str(uuid.uuid4())
    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        # First get startPageToken
        token_res = await client.get(
            f"{GOOGLE_DRIVE_API_BASE}/changes/startPageToken",
            headers=headers
        )
        if token_res.status_code != 200:
            print(f"[GOOGLE DRIVE] Could not fetch startPageToken: {token_res.text}")
            return {}
        
        start_page_token = token_res.json().get("startPageToken")

        # Watch for changes
        watch_payload = {
            "id": channel_id,
            "type": "web_hook",
            "address": webhook_url,
            "payload": True
        }

        watch_res = await client.post(
            f"{GOOGLE_DRIVE_API_BASE}/changes/watch",
            headers=headers,
            params={"pageToken": start_page_token, "supportsAllDrives": True},
            json=watch_payload
        )

        if watch_res.status_code in (200, 201):
            watch_data = watch_res.json()
            expiration_ms = int(watch_data.get("expiration", 0))
            expiration_dt = datetime.fromtimestamp(expiration_ms / 1000.0, timezone.utc) if expiration_ms else None

            print(f"[GOOGLE DRIVE] Watch channel registered successfully: id={channel_id}")
            return {
                "channel_id": channel_id,
                "resource_id": watch_data.get("resourceId"),
                "expiration": expiration_dt.isoformat() if expiration_dt else None,
                "start_page_token": start_page_token
            }
        else:
            print(f"[GOOGLE DRIVE] Webhook registration note ({watch_res.status_code}): {watch_res.text}")
            return {}


async def stop_webhook_watch(access_token: str, channel_id: str, resource_id: str) -> bool:
    """Stops an active Google watch channel."""
    if not channel_id or not resource_id:
        return True

    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{GOOGLE_DRIVE_API_BASE}/channels/stop",
            headers=headers,
            json={"id": channel_id, "resourceId": resource_id}
        )
        return res.status_code in (200, 204)


async def sync_company_drive_files(company_id: str) -> Dict[str, Any]:
    """
    Main Synchronization Routine:
    1. Fetches integration configuration for company.
    2. Queries Google Drive files inside the designated folder.
    3. Converts native Google Workspace files (Docs/Sheets/Slides) or downloads binary files.
    4. Deduplicates against google_drive_synced_files.
    5. Saves into Supabase Storage 'coach-documents'.
    6. Calls coach_pipeline.run_coach_file_ingestion to parse, vectorize, and index.
    """
    # 1. Fetch integration
    res = (
        supabase_admin.table("google_drive_integrations")
        .select("*")
        .eq("company_id", company_id)
        .eq("sync_status", "active")
        .limit(1)
        .execute()
    )
    integration = res.data[0] if (res and getattr(res, "data", None)) else None
    if not integration:
        return {"status": "skipped", "message": "No active Google Drive integration found for company."}

    folder_id = integration["folder_id"]
    integration_id = integration["id"]
    connected_user_id = integration["connected_by"]

    # 2. Get valid access token
    access_token = await get_valid_access_token(integration)
    headers = {"Authorization": f"Bearer {access_token}"}

    # 3. List files in folder
    query = f"'{folder_id}' in parents and trashed = false"
    async with httpx.AsyncClient(timeout=60.0) as client:
        list_res = await client.get(
            f"{GOOGLE_DRIVE_API_BASE}/files",
            headers=headers,
            params={
                "q": query,
                "fields": "files(id, name, mimeType, size, md5Checksum, modifiedTime)",
                "pageSize": 100,
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true"
            }
        )

        if list_res.status_code != 200:
            err_msg = f"Failed to list folder files ({list_res.status_code}): {list_res.text}"
            supabase_admin.table("google_drive_integrations").update({
                "error_message": err_msg
            }).eq("id", integration_id).execute()
            return {"status": "error", "message": err_msg}

        files = list_res.json().get("files", [])

    print(f"[GOOGLE DRIVE SYNC] Found {len(files)} files in folder for company {company_id}")

    synced_count = 0
    skipped_count = 0
    errors = []

    for item in files:
        file_id = item["id"]
        raw_name = item["name"]
        mime_type = item.get("mimeType", "")
        modified_time = item.get("modifiedTime")
        md5_checksum = item.get("md5Checksum")

        # Determine extension and format handling
        is_workspace = mime_type in GOOGLE_WORKSPACE_EXPORTS
        if is_workspace:
            export_info = GOOGLE_WORKSPACE_EXPORTS[mime_type]
            ext = export_info["ext"]
            clean_filename = f"{raw_name}.{ext}" if not raw_name.lower().endswith(f".{ext}") else raw_name
        else:
            ext = raw_name.split(".")[-1].lower() if "." in raw_name else ""
            clean_filename = raw_name

        if ext not in ALLOWED_EXTENSIONS:
            print(f"[GOOGLE DRIVE SYNC] Skipping unsupported file: {clean_filename} (type: {ext})")
            skipped_count += 1
            continue

        # Check deduplication in google_drive_synced_files
        query_check = (
            supabase_admin.table("google_drive_synced_files")
            .select("id, status")
            .eq("company_id", company_id)
            .eq("drive_file_id", file_id)
        )
        if md5_checksum:
            query_check = query_check.eq("md5_checksum", md5_checksum)

        existing_record = None
        try:
            existing_check = query_check.limit(1).execute()
            if existing_check and getattr(existing_check, "data", None):
                existing_record = existing_check.data[0]
        except Exception as check_err:
            print(f"[GOOGLE DRIVE SYNC] Deduplication lookup note: {check_err}")

        if existing_record and existing_record.get("status") == "completed":
            print(f"[GOOGLE DRIVE SYNC] File '{clean_filename}' already synced and completed. Skipping.")
            skipped_count += 1
            continue

        # Download or export file content
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                if is_workspace:
                    export_mime = GOOGLE_WORKSPACE_EXPORTS[mime_type]["export_mime"]
                    dl_res = await client.get(
                        f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}/export",
                        headers=headers,
                        params={"mimeType": export_mime}
                    )
                else:
                    dl_res = await client.get(
                        f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}",
                        headers=headers,
                        params={"alt": "media"}
                    )

                if dl_res.status_code != 200:
                    raise RuntimeError(f"Download failed with status {dl_res.status_code}: {dl_res.text}")

                content = dl_res.content

            file_size = len(content)
            if file_size == 0:
                print(f"[GOOGLE DRIVE SYNC] File {clean_filename} is empty, skipping.")
                skipped_count += 1
                continue

            file_hash = hashlib.sha256(content).hexdigest()
            doc_id = str(uuid.uuid4())
            safe_filename = f"{doc_id}_{clean_filename}"
            storage_path = f"{company_id}/{doc_id}/{clean_filename}"

            # 4. Upload to Supabase Storage bucket 'coach-documents'
            try:
                supabase_admin.storage.from_(BUCKET_NAME).upload(
                    path=storage_path,
                    file=content,
                    file_options={"content-type": "application/octet-stream", "upsert": "true"}
                )
            except Exception as st_err:
                print(f"[GOOGLE DRIVE SYNC] Storage upload warning: {st_err}")
                storage_path = f"local_storage/{safe_filename}"

            # 5. Create master document record in coach_uploaded_documents
            doc_record = create_document_record(
                company_id=company_id,
                uploaded_by=connected_user_id,
                file_name=clean_filename,
                file_type=ext,
                file_size_bytes=file_size,
                storage_path=storage_path,
                file_hash=file_hash,
                target_employee_id=None,
                manual_description=f"Auto-imported from Google Drive: {integration.get('folder_name', 'Lucid Coach Ingestion')}"
            )

            # 6. Save locally for coach_pipeline ingestion
            os.makedirs(TEMP_DIR, exist_ok=True)
            temp_file_path = os.path.join(TEMP_DIR, safe_filename)
            with open(temp_file_path, "wb") as f:
                f.write(content)

            # 7. Execute Coach Ingestion Pipeline
            try:
                run_coach_file_ingestion(
                    file_path=temp_file_path,
                    document_id=doc_record["id"],
                    company_id=company_id,
                    file_name=clean_filename,
                    file_type=ext,
                    target_employee_id=None
                )
            finally:
                if os.path.exists(temp_file_path):
                    try:
                        os.remove(temp_file_path)
                    except Exception:
                        pass

            # 8. Record in google_drive_synced_files
            supabase_admin.table("google_drive_synced_files").upsert({
                "company_id": company_id,
                "integration_id": integration_id,
                "drive_file_id": file_id,
                "file_name": clean_filename,
                "file_type": ext,
                "file_size_bytes": file_size,
                "md5_checksum": md5_checksum or file_hash,
                "drive_modified_time": modified_time,
                "coach_document_id": doc_record["id"],
                "status": "completed",
                "synced_at": datetime.now(timezone.utc).isoformat()
            }, on_conflict="company_id,drive_file_id,md5_checksum").execute()

            synced_count += 1
            print(f"[GOOGLE DRIVE SYNC] Successfully ingested: {clean_filename}")

        except Exception as e:
            err_text = str(e)
            print(f"[GOOGLE DRIVE SYNC ERROR] Failed to ingest {clean_filename}: {err_text}")
            errors.append({"file": clean_filename, "error": err_text})

            # Record failed sync status
            try:
                fallback_checksum = md5_checksum or (file_hash if 'file_hash' in locals() else file_id)
                supabase_admin.table("google_drive_synced_files").upsert({
                    "company_id": company_id,
                    "integration_id": integration_id,
                    "drive_file_id": file_id,
                    "file_name": clean_filename,
                    "file_type": ext,
                    "md5_checksum": fallback_checksum,
                    "status": "failed",
                    "error_message": err_text,
                    "synced_at": datetime.now(timezone.utc).isoformat()
                }, on_conflict="company_id,drive_file_id,md5_checksum").execute()
            except Exception as upsert_err:
                print(f"[GOOGLE DRIVE SYNC] Failed to record error status: {upsert_err}")

    # Update integration last synced time
    now_iso = datetime.now(timezone.utc).isoformat()
    supabase_admin.table("google_drive_integrations").update({
        "last_synced_at": now_iso,
        "error_message": None if not errors else f"{len(errors)} file(s) failed during sync"
    }).eq("id", integration_id).execute()

    return {
        "status": "success",
        "synced_count": synced_count,
        "skipped_count": skipped_count,
        "errors": errors
    }


async def renew_expiring_webhooks() -> int:
    """
    Checks for Google Drive watch channels expiring within the next 48 hours and renews them.
    Returns the count of successfully renewed channels.
    """
    cutoff = (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat()
    try:
        res = (
            supabase_admin.table("google_drive_integrations")
            .select("*")
            .eq("sync_status", "active")
            .not_.is_("webhook_channel_id", "null")
            .lt("webhook_expiration", cutoff)
            .execute()
        )
    except Exception as query_err:
        print(f"[GOOGLE DRIVE RENEWAL] Error querying expiring channels: {query_err}")
        return 0
    
    integrations = (res.data if (res and getattr(res, "data", None)) else []) or []
    renewed_count = 0

    for item in integrations:
        try:
            access_token = await get_valid_access_token(item)
            watch_info = await register_webhook_watch(access_token, item["folder_id"])
            if watch_info.get("channel_id"):
                supabase_admin.table("google_drive_integrations").update({
                    "webhook_channel_id": watch_info["channel_id"],
                    "webhook_resource_id": watch_info["resource_id"],
                    "webhook_expiration": watch_info["expiration"],
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }).eq("id", item["id"]).execute()
                renewed_count += 1
                print(f"[GOOGLE DRIVE] Renewed webhook channel for company {item['company_id']}")
        except Exception as e:
            print(f"[GOOGLE DRIVE RENEWAL ERROR] Could not renew channel for company {item.get('company_id')}: {e}")

    return renewed_count

