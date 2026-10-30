# Backend/services/connectors/providers/google_drive/connector.py
"""
Google Drive Connector Implementation of BaseConnector.
Supports:
- OAuth2 token lifecycle with secure Vault storage
- My Drive and Google Workspace Shared Drives (Team Drives)
- Deep recursive subfolder scanning and ancestor resolution
- Real-time push webhooks (drive.changes.watch) & incremental delta fetching
- Automatic Google Docs/Sheets/Slides export to PDF/Excel/PPTX
"""

import os
import uuid
import json
import urllib.parse
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple, Set
import httpx

from services.connectors.base import BaseConnector
from services.connectors.models import (
    ConnectorAccountInfo,
    ContainerItem,
    SyncItemInfo
)
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
    list_shared_with_me_folders,
    list_child_folders,
    build_folder_subtree_map,
    is_item_descendant_of,
    fetch_folder_metadata
)

# Supported extensions
ALLOWED_EXTENSIONS = {"pdf", "docx", "doc", "csv", "xlsx", "xls", "pptx", "ppt"}

# Google Workspace MIME types for auto-export
WORKSPACE_EXPORTS = {
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


class GoogleDriveConnector(BaseConnector):
    """Full-featured Google Drive Enterprise Connector."""

    @property
    def provider_name(self) -> str:
        return "google_drive"

    @property
    def display_name(self) -> str:
        return "Google Drive"

    def generate_auth_url(self, company_id: str, user_id: str, redirect_uri: Optional[str] = None) -> str:
        client_id, _, default_redirect, _ = get_oauth_credentials()
        redirect = redirect_uri or default_redirect

        state_payload = {
            "company_id": company_id,
            "user_id": user_id,
            "provider": self.provider_name,
            "nonce": str(uuid.uuid4())
        }
        state_str = urllib.parse.quote(json.dumps(state_payload))

        params = {
            "client_id": client_id,
            "redirect_uri": redirect,
            "response_type": "code",
            "scope": " ".join(GOOGLE_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state_str,
            "include_granted_scopes": "true"
        }
        return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
        client_id, client_secret, default_redirect, _ = get_oauth_credentials()
        redirect = redirect_uri or default_redirect

        payload = {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect,
            "grant_type": "authorization_code"
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(GOOGLE_TOKEN_URL, data=payload)
            if res.status_code != 200:
                raise RuntimeError(f"Google Drive token exchange failed ({res.status_code}): {res.text}")
            token_data = res.json()

        access_token = token_data.get("access_token")
        if not access_token:
            raise RuntimeError("Token response missing access_token")

        account_info = await self.get_account_info(access_token)

        return {
            "access_token": access_token,
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in", 3600),
            "account_identifier": account_info.account_identifier,
            "extra": {
                "account_name": account_info.account_name,
                "token_type": token_data.get("token_type", "Bearer"),
                "scope": token_data.get("scope")
            }
        }

    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        client_id, client_secret, _, _ = get_oauth_credentials()
        payload = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(GOOGLE_TOKEN_URL, data=payload)
            if res.status_code != 200:
                raise RuntimeError(f"Google Drive token refresh failed ({res.status_code}): {res.text}")
            token_data = res.json()

        return {
            "access_token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token") or refresh_token,
            "expires_in": token_data.get("expires_in", 3600)
        }

    async def get_account_info(self, access_token: str) -> ConnectorAccountInfo:
        res = await execute_google_api_call(
            method="GET",
            url=GOOGLE_USERINFO_URL,
            access_token=access_token
        )
        if res.status_code == 200:
            data = res.json()
            return ConnectorAccountInfo(
                provider=self.provider_name,
                account_identifier=data.get("email") or "unknown@google.com",
                account_name=data.get("name"),
                account_avatar=data.get("picture"),
                extra={"hd": data.get("hd")}
            )
        return ConnectorAccountInfo(
            provider=self.provider_name,
            account_identifier="unknown@google.com"
        )

    async def list_containers(
        self,
        access_token: str,
        parent_id: Optional[str] = None,
        drive_id: Optional[str] = None,
        query: Optional[str] = None
    ) -> List[ContainerItem]:
        """
        Lists containers for browsing.
        - If parent_id is None and drive_id is None:
          Returns "📁 My Drive" virtual container PLUS all Shared Drives.
        - If parent_id is specified (or drive_id is specified):
          Returns the child folders under that parent/drive.
        """
        items: List[ContainerItem] = []

        if not parent_id and not drive_id:
            # 1. Virtual "My Drive" container
            items.append(
                ContainerItem(
                    id="root",
                    name="My Drive",
                    container_type="folder",
                    parent_id=None,
                    path="/My Drive",
                    has_children=True,
                    can_select=True,
                    metadata={"is_my_drive_root": True}
                )
            )

            # 2. Virtual "Shared with me" container
            items.append(
                ContainerItem(
                    id="shared_with_me",
                    name="Shared with me",
                    container_type="folder",
                    parent_id=None,
                    path="/Shared with me",
                    has_children=True,
                    can_select=False,
                    metadata={"is_shared_with_me_root": True}
                )
            )

            # 3. Shared Drives (Team Drives)
            try:
                shared_drives = await list_shared_drives(access_token)
                items.extend(shared_drives)
            except Exception as e:
                print(f"[GOOGLE DRIVE] Note: Error listing shared drives: {e}")

            return items

        # If navigating directly inside "Shared with me"
        if parent_id == "shared_with_me":
            return await list_shared_with_me_folders(access_token)

        # Lazy load children under parent_id / drive_id
        return await list_child_folders(
            access_token=access_token,
            parent_id=parent_id,
            drive_id=drive_id
        )

    async def register_watch(
        self,
        access_token: str,
        source_id: str,
        webhook_url: str
    ) -> Dict[str, Any]:
        """
        Registers push notifications using drive.changes.watch.
        """
        if not webhook_url:
            return {}

        channel_id = str(uuid.uuid4())

        # 1. Get initial startPageToken
        res_token = await execute_google_api_call(
            method="GET",
            url=f"{GOOGLE_DRIVE_API_BASE}/changes/startPageToken",
            access_token=access_token,
            params={"supportsAllDrives": "true"}
        )
        if res_token.status_code != 200:
            print(f"[GOOGLE DRIVE] Failed to get startPageToken: {res_token.text}")
            return {}

        start_page_token = res_token.json().get("startPageToken")

        # 2. Register watch channel
        watch_payload = {
            "id": channel_id,
            "type": "web_hook",
            "address": webhook_url,
            "payload": True
        }

        watch_res = await execute_google_api_call(
            method="POST",
            url=f"{GOOGLE_DRIVE_API_BASE}/changes/watch",
            access_token=access_token,
            params={"pageToken": start_page_token, "supportsAllDrives": "true"},
            json_data=watch_payload
        )

        if watch_res.status_code in (200, 201):
            data = watch_res.json()
            exp_ms = int(data.get("expiration", 0))
            exp_dt = datetime.fromtimestamp(exp_ms / 1000.0, timezone.utc) if exp_ms else None
            return {
                "channel_id": channel_id,
                "resource_id": data.get("resourceId"),
                "expiration": exp_dt.isoformat() if exp_dt else None,
                "start_cursor": start_page_token
            }
        else:
            print(f"[GOOGLE DRIVE] Webhook watch response ({watch_res.status_code}): {watch_res.text}")
            return {}

    async def stop_watch(
        self,
        access_token: str,
        channel_id: str,
        resource_id: str
    ) -> bool:
        if not channel_id or not resource_id:
            return True

        res = await execute_google_api_call(
            method="POST",
            url=f"{GOOGLE_DRIVE_API_BASE}/channels/stop",
            access_token=access_token,
            json_data={"id": channel_id, "resourceId": resource_id}
        )
        return res.status_code in (200, 204)

    async def fetch_items_in_container(
        self,
        access_token: str,
        container_id: str,
        is_recursive: bool = True,
        drive_id: Optional[str] = None
    ) -> List[SyncItemInfo]:
        """
        Recursively scans all valid files inside the monitored folder container.
        """
        subtree_map: Dict[str, Dict[str, Any]] = {}
        if is_recursive:
            subtree_map = await build_folder_subtree_map(
                access_token=access_token,
                root_folder_id=container_id,
                drive_id=drive_id
            )
        else:
            meta = await fetch_folder_metadata(access_token, container_id)
            root_name = meta.get("name", "Root") if meta else "Root"
            subtree_map[container_id] = {
                "id": container_id,
                "name": root_name,
                "parent_id": None,
                "relative_path": ""
            }

        all_items: List[SyncItemInfo] = []
        folder_ids = list(subtree_map.keys())
        sem = asyncio.Semaphore(8)

        async def _scan_folder(fid: str) -> List[SyncItemInfo]:
            folder_items: List[SyncItemInfo] = []
            folder_meta = subtree_map.get(fid, {})
            folder_rel_path = folder_meta.get("relative_path", "")

            query = f"mimeType != 'application/vnd.google-apps.folder' and '{fid}' in parents and trashed = false"
            params: Dict[str, Any] = {
                "q": query,
                "fields": "nextPageToken, files(id, name, mimeType, size, md5Checksum, modifiedTime, parents)",
                "pageSize": 100,
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true"
            }
            if drive_id:
                params["corpora"] = "drive"
                params["driveId"] = drive_id

            page_token = None
            async with sem:
                while True:
                    if page_token:
                        params["pageToken"] = page_token

                    res = await execute_google_api_call(
                        method="GET",
                        url=f"{GOOGLE_DRIVE_API_BASE}/files",
                        access_token=access_token,
                        params=params
                    )
                    if res.status_code != 200:
                        print(f"[GOOGLE DRIVE] Error listing files in folder {fid}: {res.text}")
                        break

                    data = res.json()
                    files = data.get("files", [])

                    for f in files:
                        file_id = f["id"]
                        raw_name = f.get("name", "untitled")
                        mime_type = f.get("mimeType", "")
                        mod_str = f.get("modifiedTime")
                        mod_dt = None
                        if mod_str:
                            try:
                                mod_dt = datetime.fromisoformat(mod_str.replace("Z", "+00:00"))
                            except Exception:
                                mod_dt = None

                        is_workspace = mime_type in WORKSPACE_EXPORTS
                        if is_workspace:
                            ext = WORKSPACE_EXPORTS[mime_type]["ext"]
                            clean_name = f"{raw_name}.{ext}" if not raw_name.lower().endswith(f".{ext}") else raw_name
                        else:
                            ext = raw_name.split(".")[-1].lower() if "." in raw_name else ""
                            clean_name = raw_name

                        if ext not in ALLOWED_EXTENSIONS:
                            continue

                        # Determine checksum/hash
                        # Google Docs do not have md5Checksum, we use modifiedTime as fallback hash
                        content_hash = f.get("md5Checksum") or f"gdoc_{mod_str or file_id}"
                        rel_path = f"{folder_rel_path}/{clean_name}".strip("/")

                        folder_items.append(
                            SyncItemInfo(
                                item_id=file_id,
                                item_name=clean_name,
                                item_type=ext,
                                size_bytes=int(f.get("size", 0)),
                                content_hash=content_hash,
                                parent_container_id=fid,
                                relative_path=rel_path,
                                modified_time=mod_dt,
                                is_deleted=False,
                                is_native_workspace=is_workspace,
                                mime_type=mime_type,
                                metadata={
                                    "original_name": raw_name,
                                    "raw_mime": mime_type,
                                    "parents": f.get("parents", [])
                                }
                            )
                        )

                    page_token = data.get("nextPageToken")
                    if not page_token:
                        break

            return folder_items

        results = await asyncio.gather(*[_scan_folder(fid) for fid in folder_ids], return_exceptions=True)
        for r in results:
            if isinstance(r, list):
                all_items.extend(r)
            elif isinstance(r, Exception):
                print(f"[GOOGLE DRIVE] Folder scan error: {r}")

        return all_items

    async def fetch_incremental_changes(
        self,
        access_token: str,
        sync_cursor: Optional[str],
        monitored_source_ids: List[str],
        drive_id: Optional[str] = None
    ) -> Tuple[List[SyncItemInfo], Optional[str]]:
        """
        Polls Google Drive incremental changes API since sync_cursor.
        Filters changes to ensure they belong to monitored_source_ids subtree.
        """
        if not sync_cursor:
            # Get latest cursor if none provided
            res = await execute_google_api_call(
                method="GET",
                url=f"{GOOGLE_DRIVE_API_BASE}/changes/startPageToken",
                access_token=access_token,
                params={"supportsAllDrives": "true"}
            )
            if res.status_code == 200:
                return [], res.json().get("startPageToken")
            return [], None

        changed_items: List[SyncItemInfo] = []
        page_token = sync_cursor
        new_start_page_token = None

        # Build set of monitored root IDs
        root_set = set(monitored_source_ids)
        # Pre-cache known subtrees
        known_subtree_ids: Set[str] = set(root_set)
        for root_id in monitored_source_ids:
            try:
                tree = await build_folder_subtree_map(access_token, root_id, drive_id=drive_id, max_depth=6)
                known_subtree_ids.update(tree.keys())
            except Exception as e:
                print(f"[GOOGLE DRIVE] Note: Pre-caching subtree for {root_id} warning: {e}")

        params: Dict[str, Any] = {
            "pageToken": page_token,
            "fields": "nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, trashed, parents, md5Checksum, modifiedTime, size))",
            "pageSize": 100,
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true"
        }
        if drive_id:
            params["corpora"] = "drive"
            params["driveId"] = drive_id

        while True:
            params["pageToken"] = page_token
            res = await execute_google_api_call(
                method="GET",
                url=f"{GOOGLE_DRIVE_API_BASE}/changes",
                access_token=access_token,
                params=params
            )

            if res.status_code != 200:
                print(f"[GOOGLE DRIVE] Changes API returned status {res.status_code}: {res.text}")
                break

            data = res.json()
            changes = data.get("changes", [])

            for ch in changes:
                file_id = ch.get("fileId")
                is_removed = ch.get("removed", False)
                f = ch.get("file")

                if is_removed or (f and f.get("trashed")):
                    # Item was deleted or trashed in Drive
                    changed_items.append(
                        SyncItemInfo(
                            item_id=file_id,
                            item_name=f.get("name", "deleted") if f else "deleted",
                            item_type="deleted",
                            size_bytes=0,
                            content_hash="deleted",
                            is_deleted=True,
                            metadata={"removed": True}
                        )
                    )
                    continue

                if not f:
                    continue

                mime_type = f.get("mimeType", "")
                if mime_type == "application/vnd.google-apps.folder":
                    # Subfolder created or moved; add to known subtree cache if child of monitored folder
                    parents = f.get("parents", [])
                    if any(p in known_subtree_ids for p in parents):
                        known_subtree_ids.add(file_id)
                    continue

                parents = f.get("parents", [])
                # Verify ancestor belongs to monitored folder
                is_member = False
                for root_id in monitored_source_ids:
                    if await is_item_descendant_of(access_token, parents, root_id, known_subtree_ids):
                        is_member = True
                        break

                if not is_member:
                    continue

                raw_name = f.get("name", "untitled")
                is_workspace = mime_type in WORKSPACE_EXPORTS
                if is_workspace:
                    ext = WORKSPACE_EXPORTS[mime_type]["ext"]
                    clean_name = f"{raw_name}.{ext}" if not raw_name.lower().endswith(f".{ext}") else raw_name
                else:
                    ext = raw_name.split(".")[-1].lower() if "." in raw_name else ""
                    clean_name = raw_name

                if ext not in ALLOWED_EXTENSIONS:
                    continue

                mod_str = f.get("modifiedTime")
                mod_dt = None
                if mod_str:
                    try:
                        mod_dt = datetime.fromisoformat(mod_str.replace("Z", "+00:00"))
                    except Exception:
                        mod_dt = None

                content_hash = f.get("md5Checksum") or f"gdoc_{mod_str or file_id}"

                changed_items.append(
                    SyncItemInfo(
                        item_id=file_id,
                        item_name=clean_name,
                        item_type=ext,
                        size_bytes=int(f.get("size", 0)),
                        content_hash=content_hash,
                        parent_container_id=parents[0] if parents else None,
                        relative_path=clean_name,
                        modified_time=mod_dt,
                        is_deleted=False,
                        is_native_workspace=is_workspace,
                        mime_type=mime_type,
                        metadata={"parents": parents, "raw_mime": mime_type}
                    )
                )

            next_page = data.get("nextPageToken")
            if next_page:
                page_token = next_page
            else:
                new_start_page_token = data.get("newStartPageToken")
                break

        return changed_items, (new_start_page_token or page_token)

    async def download_item(
        self,
        access_token: str,
        item: SyncItemInfo
    ) -> Tuple[bytes, str, str]:
        """
        Downloads binary content or exports native Google Workspace document.
        Returns (content_bytes, final_file_name, extension).
        """
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient(timeout=180.0) as client:
            if item.is_native_workspace and item.mime_type in WORKSPACE_EXPORTS:
                export_meta = WORKSPACE_EXPORTS[item.mime_type]
                export_mime = export_meta["export_mime"]
                ext = export_meta["ext"]

                res = await client.get(
                    f"{GOOGLE_DRIVE_API_BASE}/files/{item.item_id}/export",
                    headers=headers,
                    params={"mimeType": export_mime}
                )
            else:
                ext = item.item_type
                res = await client.get(
                    f"{GOOGLE_DRIVE_API_BASE}/files/{item.item_id}",
                    headers=headers,
                    params={"alt": "media", "supportsAllDrives": "true"}
                )

            if res.status_code != 200:
                raise RuntimeError(f"Google Drive file download failed ({res.status_code}): {res.text}")

            content = res.content
            clean_name = item.item_name
            if not clean_name.lower().endswith(f".{ext}"):
                clean_name = f"{clean_name}.{ext}"

            return content, clean_name, ext
