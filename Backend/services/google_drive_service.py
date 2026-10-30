# Backend/services/google_drive_service.py
"""
Google Drive Connector Service for Performance Coach Ingestion.
Maintains backwards compatibility with existing routes and background workers
while delegating directly to the unified Multi-Connector Engine (ConnectorManager).
"""

from typing import Dict, Any, Optional, List, Tuple
from services.connectors import ConnectorRegistry, ConnectorManager
from services.connectors.providers.google_drive.client import (
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    GOOGLE_DRIVE_API_BASE,
    GOOGLE_SCOPES,
    get_oauth_credentials,
    execute_google_api_call
)
from services.connectors.providers.google_drive.folder_tree import (
    list_shared_drives,
    list_child_folders,
    fetch_folder_metadata
)

_connector = ConnectorRegistry.get("google_drive")


def _get_oauth_credentials() -> Tuple[str, str, str, str]:
    return get_oauth_credentials()


def generate_auth_url(company_id: str, user_id: str) -> str:
    """Generates the Google OAuth consent URL with state encoding company & user info."""
    return _connector.generate_auth_url(company_id=company_id, user_id=user_id)


async def exchange_code_for_tokens(code: str) -> Dict[str, Any]:
    """Exchanges authorization code for access and refresh tokens."""
    return await _connector.exchange_code(code)


async def get_google_user_email(access_token: str) -> str:
    """Fetches user email from Google userinfo endpoint."""
    info = await _connector.get_account_info(access_token)
    return info.account_identifier


async def get_valid_access_token(integration: Dict[str, Any]) -> str:
    """Returns valid Google Drive access token retrieved securely from Supabase Vault."""
    company_id = integration.get("company_id")
    if not company_id:
        raise ValueError("Integration dictionary must contain company_id.")
    return await ConnectorManager.get_valid_access_token(company_id, "google_drive")


async def ensure_ingestion_folder(access_token: str, folder_name: str = "Lucid Coach Ingestion") -> Tuple[str, str]:
    """
    Searches for a designated folder. If not present, creates it.
    Returns (folder_id, folder_name).
    """
    query = f"mimeType = 'application/vnd.google-apps.folder' and name = '{folder_name}' and trashed = false"
    res = await execute_google_api_call(
        method="GET",
        url=f"{GOOGLE_DRIVE_API_BASE}/files",
        access_token=access_token,
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

    # Folder does not exist, create it
    print(f"[GOOGLE DRIVE] Folder '{folder_name}' not found. Creating...")
    create_res = await execute_google_api_call(
        method="POST",
        url=f"{GOOGLE_DRIVE_API_BASE}/files",
        access_token=access_token,
        json_data={
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
            "description": "Folder monitored by Lucid for automated Employee Performance Coach ingestion."
        }
    )
    if create_res.status_code in (200, 201):
        created = create_res.json()
        return created["id"], created["name"]

    raise RuntimeError(f"Failed to create or locate Google Drive folder '{folder_name}': {create_res.text}")


async def register_webhook_watch(access_token: str, folder_id: str) -> Dict[str, Any]:
    """Registers a Google Drive push notification watch channel."""
    _, _, _, webhook_url = get_oauth_credentials()
    info = await _connector.register_watch(access_token, folder_id, webhook_url)
    return {
        "channel_id": info.get("channel_id"),
        "resource_id": info.get("resource_id"),
        "expiration": info.get("expiration"),
        "start_page_token": info.get("start_cursor")
    }


async def stop_webhook_watch(access_token: str, channel_id: str, resource_id: str) -> bool:
    """Stops an active Google watch channel."""
    return await _connector.stop_watch(access_token, channel_id, resource_id)


async def list_drive_folders(
    access_token: str,
    parent_id: Optional[str] = None,
    drive_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Lists browseable folders in My Drive or Shared Drives."""
    items = await _connector.list_containers(
        access_token=access_token,
        parent_id=parent_id,
        drive_id=drive_id
    )
    return [item.model_dump() for item in items]


async def list_drive_files(
    access_token: str,
    parent_id: Optional[str] = None,
    drive_id: Optional[str] = None,
    max_files: int = 150
) -> List[Dict[str, Any]]:
    """Lists non-folder files inside a given Drive folder."""
    from services.connectors.providers.google_drive.folder_tree import list_files_in_folder
    return await list_files_in_folder(
        access_token=access_token,
        parent_id=parent_id,
        drive_id=drive_id,
        max_files=max_files
    )



async def select_drive_folder(
    company_id: str,
    folder_id: str,
    folder_name: str,
    folder_path: str = "/",
    drive_id: Optional[str] = None
) -> Dict[str, Any]:
    """Updates the company's monitored folder selection."""
    return await ConnectorManager.select_monitored_container(
        company_id=company_id,
        container_id=folder_id,
        container_name=folder_name,
        container_path=folder_path,
        container_type="folder",
        is_recursive=True,
        drive_id=drive_id,
        provider="google_drive"
    )


async def sync_company_drive_files(company_id: str) -> Dict[str, Any]:
    """
    Main Synchronization Routine:
    Delegates to ConnectorManager.sync_company_files for Google Drive.
    """
    result = await ConnectorManager.sync_company_files(company_id=company_id, provider="google_drive")
    return {
        "status": result.status,
        "synced_count": result.synced_count,
        "updated_count": result.updated_count,
        "deleted_count": result.deleted_count,
        "skipped_count": result.skipped_count,
        "errors": result.errors,
        "message": result.message,
        "duration_seconds": result.duration_seconds
    }


async def renew_expiring_webhooks() -> int:
    """Renews webhooks expiring within 48 hours."""
    return await ConnectorManager.renew_expiring_webhooks("google_drive")
