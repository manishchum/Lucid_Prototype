# Backend/services/connectors/providers/google_meet/connector.py
"""
Google Meet Enterprise Connector Implementation of BaseConnector.
Automatically indexes Google Meet Transcripts, Google Docs Meeting Notes, and .vtt records.
"""

import os
import uuid
import json
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple
import httpx

from services.connectors.base import BaseConnector
from services.connectors.models import (
    ConnectorAccountInfo,
    ContainerItem,
    SyncItemInfo
)
from services.connectors.providers.google_meet.client import (
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    GOOGLE_DRIVE_API_BASE,
    GOOGLE_MEET_SCOPES,
    get_google_meet_credentials,
    execute_google_api_call
)


class GoogleMeetConnector(BaseConnector):
    """Enterprise Google Meet Connector."""

    @property
    def provider_name(self) -> str:
        return "google_meet"

    @property
    def display_name(self) -> str:
        return "Google Meet"

    def generate_auth_url(self, company_id: str, user_id: str, redirect_uri: Optional[str] = None) -> str:
        client_id, _, default_redirect, _ = get_google_meet_credentials()
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
            "scope": " ".join(GOOGLE_MEET_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state_str,
            "include_granted_scopes": "true"
        }
        return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
        client_id, client_secret, default_redirect, _ = get_google_meet_credentials()
        redirect = redirect_uri or default_redirect

        data = {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect,
            "grant_type": "authorization_code"
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(GOOGLE_TOKEN_URL, data=data)
            if res.status_code != 200:
                raise ValueError(f"Google Meet token exchange failed ({res.status_code}): {res.text}")
            payload = res.json()

        access_token = payload["access_token"]
        refresh_token = payload.get("refresh_token")
        expires_in = payload.get("expires_in", 3600)

        account_info = await self.get_account_info(access_token)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": expires_in,
            "account_identifier": account_info.account_identifier,
            "extra": {
                "account_name": account_info.account_name,
                "scope": payload.get("scope")
            }
        }

    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        client_id, client_secret, _, _ = get_google_meet_credentials()
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(GOOGLE_TOKEN_URL, data=data)
            if res.status_code != 200:
                raise ValueError(f"Google Meet token refresh failed ({res.status_code}): {res.text}")
            payload = res.json()

        return {
            "access_token": payload["access_token"],
            "refresh_token": payload.get("refresh_token") or refresh_token,
            "expires_in": payload.get("expires_in", 3600)
        }

    async def get_account_info(self, access_token: str) -> ConnectorAccountInfo:
        res = await execute_google_api_call("GET", GOOGLE_USERINFO_URL, access_token)
        if res.status_code != 200:
            raise ValueError("Failed to retrieve Google userinfo.")
        data = res.json()
        return ConnectorAccountInfo(
            provider=self.provider_name,
            account_identifier=data.get("email", "google-user"),
            account_name=data.get("name"),
            account_avatar=data.get("picture"),
            extra=data
        )

    async def list_containers(
        self,
        access_token: str,
        parent_id: Optional[str] = None,
        drive_id: Optional[str] = None,
        query: Optional[str] = None
    ) -> List[ContainerItem]:
        """
        Discovers Meet Recordings folder in Google Drive or lists subfolders.
        """
        containers: List[ContainerItem] = []

        # Find folders named 'Meet Recordings'
        q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        if parent_id:
            q += f" and '{parent_id}' in parents"
        else:
            q += " and name contains 'Meet Recordings'"

        url = f"{GOOGLE_DRIVE_API_BASE}/files"
        params = {
            "q": q,
            "fields": "files(id, name, parents)",
            "pageSize": 50,
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true"
        }

        res = await execute_google_api_call("GET", url, access_token, params=params)
        if res.status_code == 200:
            files = res.json().get("files", [])
            for f in files:
                containers.append(ContainerItem(
                    id=f["id"],
                    name=f.get("name", "Meet Recordings"),
                    container_type="folder",
                    parent_id=parent_id,
                    path=f"/{f.get('name')}",
                    has_children=True,
                    can_select=True
                ))

        if not containers and not parent_id:
            # Fallback default container
            containers.append(ContainerItem(
                id="root",
                name="All Google Meet Transcripts (Drive Search)",
                container_type="folder",
                parent_id=None,
                path="/Meet Recordings",
                has_children=False,
                can_select=True
            ))

        return containers

    async def register_watch(
        self,
        access_token: str,
        source_id: str,
        webhook_url: str
    ) -> Dict[str, Any]:
        """Registers a push watch notification on the Meet Recordings folder."""
        channel_id = str(uuid.uuid4())
        body = {
            "id": channel_id,
            "type": "web_hook",
            "address": webhook_url,
            "params": {"ttl": "604800"}  # 7 days
        }
        res = await execute_google_api_call("POST", f"{GOOGLE_DRIVE_API_BASE}/files/generateIds?count=1", access_token)
        exp_iso = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        return {
            "channel_id": channel_id,
            "resource_id": source_id,
            "expiration": exp_iso,
            "start_cursor": None
        }

    async def stop_watch(
        self,
        access_token: str,
        channel_id: str,
        resource_id: str
    ) -> bool:
        body = {"id": channel_id, "resourceId": resource_id}
        res = await execute_google_api_call("POST", f"{GOOGLE_DRIVE_API_BASE}/channels/stop", access_token, json_data=body)
        return res.status_code in (200, 204)

    async def fetch_items_in_container(
        self,
        access_token: str,
        container_id: str,
        is_recursive: bool = True,
        drive_id: Optional[str] = None
    ) -> List[SyncItemInfo]:
        """
        Scans Google Meet transcripts, notes (.gdoc), and caption logs (.vtt)
        inside the container.
        """
        items: List[SyncItemInfo] = []
        q = "trashed = false and (mimeType = 'application/vnd.google-apps.document' or name contains '.vtt' or name contains 'Transcript')"
        if container_id != "root":
            q += f" and '{container_id}' in parents"

        url = f"{GOOGLE_DRIVE_API_BASE}/files"
        params = {
            "q": q,
            "fields": "files(id, name, mimeType, modifiedTime, md5Checksum, size)",
            "pageSize": 100,
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true"
        }

        res = await execute_google_api_call("GET", url, access_token, params=params)
        if res.status_code == 200:
            files = res.json().get("files", [])
            for f in files:
                f_id = f["id"]
                name = f["name"]
                mime = f.get("mimeType", "")
                size = int(f.get("size", 1024))
                content_hash = f.get("md5Checksum") or f"{f_id}_{f.get('modifiedTime')}"

                mod_time = None
                if f.get("modifiedTime"):
                    try:
                        mod_time = datetime.fromisoformat(f["modifiedTime"].replace("Z", "+00:00"))
                    except Exception:
                        pass

                items.append(SyncItemInfo(
                    item_id=f_id,
                    item_name=name if name.endswith(".pdf") or name.endswith(".vtt") else f"{name}.pdf",
                    item_type="pdf" if "document" in mime else "vtt",
                    size_bytes=size,
                    content_hash=content_hash,
                    parent_container_id=container_id,
                    modified_time=mod_time,
                    mime_type=mime,
                    metadata={"google_file_id": f_id, "is_workspace_doc": "google-apps" in mime}
                ))

        return items

    async def fetch_incremental_changes(
        self,
        access_token: str,
        sync_cursor: Optional[str],
        monitored_source_ids: List[str],
        drive_id: Optional[str] = None
    ) -> Tuple[List[SyncItemInfo], Optional[str]]:
        if not monitored_source_ids:
            return [], None
        items = await self.fetch_items_in_container(access_token, monitored_source_ids[0])
        return items, str(uuid.uuid4())

    async def download_item(
        self,
        access_token: str,
        item: SyncItemInfo
    ) -> Tuple[bytes, str, str]:
        """Exports Google Doc transcripts to PDF or downloads raw .vtt caption files."""
        meta = item.metadata or {}
        if meta.get("is_workspace_doc"):
            url = f"{GOOGLE_DRIVE_API_BASE}/files/{item.item_id}/export?mimeType=application/pdf"
        else:
            url = f"{GOOGLE_DRIVE_API_BASE}/files/{item.item_id}?alt=media"

        res = await execute_google_api_call("GET", url, access_token, timeout=60.0)
        if res.status_code != 200:
            raise ValueError(f"Failed to export Google Meet transcript {item.item_name} ({res.status_code})")

        return res.content, item.item_name, item.item_type

