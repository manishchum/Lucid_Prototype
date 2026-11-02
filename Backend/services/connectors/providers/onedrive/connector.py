# Backend/services/connectors/providers/onedrive/connector.py
"""
Microsoft OneDrive & SharePoint Enterprise Connector.
Full implementation of BaseConnector with Microsoft Graph API.
"""

import os
import uuid
import json
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple, Set
import httpx

from services.connectors.base import BaseConnector
from services.connectors.models import (
    ConnectorAccountInfo,
    ContainerItem,
    SyncItemInfo
)
from services.connectors.providers.onedrive.client import (
    MICROSOFT_AUTH_URL,
    MICROSOFT_TOKEN_URL,
    MICROSOFT_GRAPH_BASE,
    ONEDRIVE_SCOPES,
    get_onedrive_credentials,
    execute_graph_api_call
)

ALLOWED_EXTENSIONS = {"pdf", "docx", "doc", "csv", "xlsx", "xls", "pptx", "ppt"}


class OneDriveConnector(BaseConnector):
    """Enterprise Microsoft OneDrive & SharePoint connector."""

    @property
    def provider_name(self) -> str:
        return "onedrive"

    @property
    def display_name(self) -> str:
        return "Microsoft OneDrive"

    def generate_auth_url(self, company_id: str, user_id: str, redirect_uri: Optional[str] = None) -> str:
        client_id, _, default_redirect, _ = get_onedrive_credentials()
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
            "response_type": "code",
            "redirect_uri": redirect,
            "response_mode": "query",
            "scope": " ".join(ONEDRIVE_SCOPES),
            "state": state_str,
            "prompt": "select_account"
        }
        return f"{MICROSOFT_AUTH_URL}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
        client_id, client_secret, default_redirect, _ = get_onedrive_credentials()
        redirect = redirect_uri or default_redirect

        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(MICROSOFT_TOKEN_URL, data=data)
            if res.status_code != 200:
                raise ValueError(f"Microsoft token exchange failed ({res.status_code}): {res.text}")
            token_payload = res.json()

        access_token = token_payload["access_token"]
        refresh_token = token_payload.get("refresh_token")
        expires_in = token_payload.get("expires_in", 3600)

        # Get account identity
        account_info = await self.get_account_info(access_token)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": expires_in,
            "account_identifier": account_info.account_identifier,
            "extra": {
                "account_name": account_info.account_name,
                "scope": token_payload.get("scope")
            }
        }

    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        client_id, client_secret, _, _ = get_onedrive_credentials()
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(MICROSOFT_TOKEN_URL, data=data)
            if res.status_code != 200:
                raise ValueError(f"Microsoft token refresh failed ({res.status_code}): {res.text}")
            payload = res.json()

        return {
            "access_token": payload["access_token"],
            "refresh_token": payload.get("refresh_token") or refresh_token,
            "expires_in": payload.get("expires_in", 3600)
        }

    async def get_account_info(self, access_token: str) -> ConnectorAccountInfo:
        res = await execute_graph_api_call("GET", "/me", access_token)
        if res.status_code != 200:
            raise ValueError(f"Failed to fetch Microsoft profile ({res.status_code}): {res.text}")
        data = res.json()
        email = data.get("mail") or data.get("userPrincipalName") or "microsoft-user"
        name = data.get("displayName") or email
        return ConnectorAccountInfo(
            provider=self.provider_name,
            account_identifier=email,
            account_name=name,
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
        Lists browseable containers:
        - When parent_id is None: lists Personal OneDrive root and SharePoint Document Libraries.
        - When parent_id is given: lists child folders inside that drive/folder.
        """
        containers: List[ContainerItem] = []

        # If drive_id not passed, fetch primary user drive
        if not drive_id:
            me_drive_res = await execute_graph_api_call("GET", "/me/drive", access_token)
            if me_drive_res.status_code == 200:
                drive_id = me_drive_res.json().get("id")

        if not parent_id:
            # 1. Primary OneDrive
            if drive_id:
                containers.append(ContainerItem(
                    id="root",
                    name="My OneDrive",
                    container_type="folder",
                    parent_id=None,
                    path="/My OneDrive",
                    drive_id=drive_id,
                    drive_name="My OneDrive",
                    has_children=True,
                    can_select=True
                ))

            # 2. SharePoint Document Libraries
            try:
                sites_res = await execute_graph_api_call("GET", "/sites?search=*", access_token)
                if sites_res.status_code == 200:
                    sites = sites_res.json().get("value", [])
                    for site in sites[:10]:
                        site_id = site.get("id")
                        site_name = site.get("displayName") or "SharePoint Site"
                        # Fetch drives in site
                        drives_res = await execute_graph_api_call("GET", f"/sites/{site_id}/drives", access_token)
                        if drives_res.status_code == 200:
                            for d in drives_res.json().get("value", []):
                                containers.append(ContainerItem(
                                    id="root",
                                    name=f"{site_name} - {d.get('name', 'Documents')}",
                                    container_type="shared_drive",
                                    parent_id=None,
                                    path=f"/SharePoint/{site_name}/{d.get('name')}",
                                    drive_id=d.get("id"),
                                    drive_name=f"{site_name} - {d.get('name')}",
                                    has_children=True,
                                    can_select=True
                                ))
            except Exception as e:
                print(f"[ONEDRIVE] Note querying SharePoint sites: {e}")

            return containers

        # Drill-down into child folders
        endpoint = f"/drives/{drive_id}/items/{parent_id}/children"
        params = {"$top": 100}
        if query:
            endpoint = f"/drives/{drive_id}/items/{parent_id}/search(q='{query}')"

        res = await execute_graph_api_call("GET", endpoint, access_token, params=params)
        if res.status_code != 200:
            print(f"[ONEDRIVE] Child list error ({res.status_code}): {res.text}")
            return []

        items = res.json().get("value", [])
        for it in items:
            # Only return folder items for container tree navigation
            if "folder" in it:
                child_count = it.get("folder", {}).get("childCount", 0)
                containers.append(ContainerItem(
                    id=it["id"],
                    name=it["name"],
                    container_type="folder",
                    parent_id=parent_id,
                    path=it.get("parentReference", {}).get("path", "") + "/" + it["name"],
                    drive_id=drive_id,
                    has_children=child_count > 0,
                    can_select=True
                ))

        return containers

    async def register_watch(
        self,
        access_token: str,
        source_id: str,
        webhook_url: str
    ) -> Dict[str, Any]:
        """Creates a Microsoft Graph webhook subscription on the drive."""
        exp_time = (datetime.now(timezone.utc) + timedelta(minutes=4200)).strftime("%Y-%m-%dT%H:%M:%S.0000000Z")

        # Fallback drive_id resolution
        me_drive_res = await execute_graph_api_call("GET", "/me/drive", access_token)
        drive_id = me_drive_res.json().get("id") if me_drive_res.status_code == 200 else "root"

        payload = {
            "changeType": "updated",
            "notificationUrl": webhook_url,
            "resource": f"/drives/{drive_id}/root",
            "expirationDateTime": exp_time,
            "clientState": f"onedrive_{uuid.uuid4().hex[:8]}"
        }

        try:
            res = await execute_graph_api_call("POST", "/subscriptions", access_token, json_data=payload)
            if res.status_code in (200, 201):
                sub = res.json()
                return {
                    "channel_id": sub.get("id"),
                    "resource_id": source_id,
                    "expiration": sub.get("expirationDateTime"),
                    "start_cursor": None
                }
            else:
                print(f"[ONEDRIVE WATCH] Subscription note ({res.status_code}): {res.text}")
        except Exception as e:
            print(f"[ONEDRIVE WATCH] Webhook registration note: {e}")

        return {
            "channel_id": f"sub_{uuid.uuid4().hex[:12]}",
            "resource_id": source_id,
            "expiration": exp_time,
            "start_cursor": None
        }

    async def stop_watch(
        self,
        access_token: str,
        channel_id: str,
        resource_id: str
    ) -> bool:
        if not channel_id or channel_id.startswith("sub_"):
            return True
        try:
            res = await execute_graph_api_call("DELETE", f"/subscriptions/{channel_id}", access_token)
            return res.status_code in (200, 204)
        except Exception as e:
            print(f"[ONEDRIVE STOP WATCH] Note: {e}")
            return False

    async def fetch_items_in_container(
        self,
        access_token: str,
        container_id: str,
        is_recursive: bool = True,
        drive_id: Optional[str] = None
    ) -> List[SyncItemInfo]:
        """Scans all eligible files in the folder (and subfolders if recursive)."""
        if not drive_id:
            me_res = await execute_graph_api_call("GET", "/me/drive", access_token)
            drive_id = me_res.json().get("id") if me_res.status_code == 200 else "root"

        eligible_items: List[SyncItemInfo] = []
        queue = [(container_id, "")]

        while queue:
            curr_id, rel_prefix = queue.pop(0)
            url = f"/drives/{drive_id}/items/{curr_id}/children?$top=200"

            while url:
                res = await execute_graph_api_call("GET", url, access_token)
                if res.status_code != 200:
                    print(f"[ONEDRIVE SCAN] Error fetching children ({res.status_code}): {res.text}")
                    break

                body = res.json()
                for it in body.get("value", []):
                    item_id = it.get("id")
                    name = it.get("name", "")

                    if "folder" in it:
                        if is_recursive:
                            next_prefix = f"{rel_prefix}/{name}" if rel_prefix else name
                            queue.append((item_id, next_prefix))
                    elif "file" in it:
                        ext = name.split(".")[-1].lower() if "." in name else ""
                        if ext in ALLOWED_EXTENSIONS:
                            size = it.get("size", 0)
                            hashes = it.get("file", {}).get("hashes", {})
                            content_hash = (
                                hashes.get("sha256Hash")
                                or hashes.get("quickXorHash")
                                or f"{item_id}_{it.get('lastModifiedDateTime')}_{size}"
                            )

                            mod_time = None
                            mod_str = it.get("lastModifiedDateTime")
                            if mod_str:
                                try:
                                    mod_time = datetime.fromisoformat(mod_str.replace("Z", "+00:00"))
                                except Exception:
                                    pass

                            rel_path = f"{rel_prefix}/{name}" if rel_prefix else name
                            eligible_items.append(SyncItemInfo(
                                item_id=item_id,
                                item_name=name,
                                item_type=ext,
                                size_bytes=size,
                                content_hash=content_hash,
                                parent_container_id=curr_id,
                                relative_path=rel_path,
                                modified_time=mod_time,
                                download_url=it.get("@microsoft.graph.downloadUrl"),
                                metadata={
                                    "drive_id": drive_id,
                                    "web_url": it.get("webUrl")
                                }
                            ))

                url = body.get("@odata.nextLink")

        return eligible_items

    async def fetch_incremental_changes(
        self,
        access_token: str,
        sync_cursor: Optional[str],
        monitored_source_ids: List[str],
        drive_id: Optional[str] = None
    ) -> Tuple[List[SyncItemInfo], Optional[str]]:
        """Queries changes using Microsoft Graph Delta API."""
        if not drive_id:
            me_res = await execute_graph_api_call("GET", "/me/drive", access_token)
            drive_id = me_res.json().get("id") if me_res.status_code == 200 else "root"

        folder_id = monitored_source_ids[0] if monitored_source_ids else "root"
        url = sync_cursor or f"/drives/{drive_id}/items/{folder_id}/delta"

        changed_items: List[SyncItemInfo] = []
        new_cursor = None

        while url:
            res = await execute_graph_api_call("GET", url, access_token)
            if res.status_code != 200:
                print(f"[ONEDRIVE DELTA] Error ({res.status_code}): {res.text}")
                break

            body = res.json()
            for it in body.get("value", []):
                item_id = it.get("id")
                name = it.get("name", "")
                is_deleted = "deleted" in it

                ext = name.split(".")[-1].lower() if "." in name else ""
                if ext in ALLOWED_EXTENSIONS or is_deleted:
                    size = it.get("size", 0)
                    content_hash = f"{item_id}_{it.get('lastModifiedDateTime')}_{size}"
                    changed_items.append(SyncItemInfo(
                        item_id=item_id,
                        item_name=name,
                        item_type=ext,
                        size_bytes=size,
                        content_hash=content_hash,
                        is_deleted=is_deleted,
                        download_url=it.get("@microsoft.graph.downloadUrl"),
                        metadata={"drive_id": drive_id}
                    ))

            if "@odata.deltaLink" in body:
                new_cursor = body["@odata.deltaLink"]
                break
            url = body.get("@odata.nextLink")

        return changed_items, new_cursor

    async def download_item(
        self,
        access_token: str,
        item: SyncItemInfo
    ) -> Tuple[bytes, str, str]:
        """Downloads document bytes from OneDrive / SharePoint."""
        direct_url = item.download_url
        if direct_url:
            async with httpx.AsyncClient(timeout=60.0) as client:
                res = await client.get(direct_url)
                if res.status_code == 200:
                    return res.content, item.item_name, item.item_type

        # Fallback to Graph /content endpoint
        drive_id = (item.metadata or {}).get("drive_id", "root")
        endpoint = f"/drives/{drive_id}/items/{item.item_id}/content"
        res = await execute_graph_api_call("GET", endpoint, access_token, timeout=60.0)
        if res.status_code != 200:
            raise ValueError(f"Failed to download OneDrive item {item.item_name} ({res.status_code})")

        return res.content, item.item_name, item.item_type

