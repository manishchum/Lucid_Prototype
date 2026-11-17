# Backend/services/connectors/providers/slack/connector.py
"""
Slack Enterprise Connector Implementation of BaseConnector.
Supports Workspaces, Channels, Thread Digests, and File Ingestion.
"""

import os
import uuid
import json
import hashlib
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
from services.connectors.providers.slack.client import (
    SLACK_AUTH_URL,
    SLACK_TOKEN_URL,
    SLACK_DEFAULT_SCOPES,
    get_slack_credentials,
    execute_slack_api_call
)

ALLOWED_EXTENSIONS = {"pdf", "docx", "doc", "csv", "xlsx", "xls", "pptx", "ppt"}


class SlackConnector(BaseConnector):
    """Enterprise Slack Connector."""

    @property
    def provider_name(self) -> str:
        return "slack"

    @property
    def display_name(self) -> str:
        return "Slack"

    def generate_auth_url(self, company_id: str, user_id: str, redirect_uri: Optional[str] = None) -> str:
        client_id, _, _, default_redirect, _ = get_slack_credentials()
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
            "scope": ",".join(SLACK_DEFAULT_SCOPES),
            "redirect_uri": redirect,
            "state": state_str
        }
        return f"{SLACK_AUTH_URL}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
        client_id, client_secret, _, default_redirect, _ = get_slack_credentials()
        redirect = redirect_uri or default_redirect

        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(SLACK_TOKEN_URL, data=data)
            if res.status_code != 200:
                raise ValueError(f"Slack OAuth exchange failed ({res.status_code}): {res.text}")
            payload = res.json()

        if not payload.get("ok"):
            raise ValueError(f"Slack OAuth error: {payload.get('error')}")

        access_token = payload.get("access_token")
        team_name = (payload.get("team") or {}).get("name", "Slack Workspace")
        team_id = (payload.get("team") or {}).get("id", "team")
        account_identifier = f"{team_name} ({team_id})"

        return {
            "access_token": access_token,
            "refresh_token": payload.get("refresh_token") or access_token,  # Slack bot tokens don't expire unless token rotation is enabled
            "expires_in": payload.get("expires_in", 31536000),  # 1 year
            "account_identifier": account_identifier,
            "extra": {
                "team_id": team_id,
                "team_name": team_name,
                "bot_user_id": payload.get("bot_user_id"),
                "authed_user": payload.get("authed_user")
            }
        }

    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refreshes Slack OAuth token if token rotation is enabled."""
        client_id, client_secret, _, _, _ = get_slack_credentials()
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(SLACK_TOKEN_URL, data=data)
            if res.status_code != 200:
                # If rotation is not enabled on the Slack App, the existing token remains valid
                return {"access_token": refresh_token, "refresh_token": refresh_token, "expires_in": 31536000}
            payload = res.json()

        if not payload.get("ok"):
            return {"access_token": refresh_token, "refresh_token": refresh_token, "expires_in": 31536000}

        return {
            "access_token": payload["access_token"],
            "refresh_token": payload.get("refresh_token") or refresh_token,
            "expires_in": payload.get("expires_in", 31536000)
        }

    async def get_account_info(self, access_token: str) -> ConnectorAccountInfo:
        res = await execute_slack_api_call("POST", "auth.test", access_token)
        if res.status_code != 200:
            raise ValueError("Failed to query Slack auth test.")
        data = res.json()
        team_name = data.get("team", "Slack Workspace")
        user_name = data.get("user", "Bot")
        return ConnectorAccountInfo(
            provider=self.provider_name,
            account_identifier=f"{team_name} ({data.get('team_id')})",
            account_name=f"{user_name} @ {team_name}",
            extra=data
        )

    async def list_containers(
        self,
        access_token: str,
        parent_id: Optional[str] = None,
        drive_id: Optional[str] = None,
        query: Optional[str] = None
    ) -> List[ContainerItem]:
        """Lists browseable public and private Slack channels in the workspace."""
        containers: List[ContainerItem] = []
        params = {
            "types": "public_channel,private_channel",
            "exclude_archived": "true",
            "limit": 100
        }

        res = await execute_slack_api_call("GET", "conversations.list", access_token, params=params)
        if res.status_code == 200:
            body = res.json()
            channels = body.get("channels", [])
            for c in channels:
                name = c.get("name", "channel")
                c_id = c.get("id")
                is_private = c.get("is_private", False)
                prefix = "🔒 " if is_private else "#"
                containers.append(ContainerItem(
                    id=c_id,
                    name=f"{prefix}{name}",
                    container_type="channel",
                    parent_id=None,
                    path=f"/{name}",
                    has_children=False,
                    can_select=True,
                    metadata={"topic": c.get("topic", {}).get("value"), "num_members": c.get("num_members")}
                ))

        return containers

    async def register_watch(
        self,
        access_token: str,
        source_id: str,
        webhook_url: str
    ) -> Dict[str, Any]:
        """
        Slack events are pushed globally via App Event Subscriptions.
        We record the monitored channel ID in the integration config.
        """
        exp_time = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
        return {
            "channel_id": f"slack_chan_{source_id}",
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
        return True

    async def fetch_items_in_container(
        self,
        access_token: str,
        container_id: str,
        is_recursive: bool = True,
        drive_id: Optional[str] = None
    ) -> List[SyncItemInfo]:
        """
        Fetches items from Slack channel:
        1. Channel conversation digest (recent messages and threads)
        2. Files shared in the channel (PDFs, spreadsheets, word docs)
        """
        items: List[SyncItemInfo] = []

        # 1. Fetch channel messages
        msg_res = await execute_slack_api_call(
            "GET",
            "conversations.history",
            access_token,
            params={"channel": container_id, "limit": 100}
        )

        if msg_res.status_code == 200:
            body = msg_res.json()
            messages = body.get("messages", [])
            if messages:
                today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                digest_id = f"slack_digest_{container_id}_{today_str}"
                content_payload = json.dumps([{"user": m.get("user"), "text": m.get("text"), "ts": m.get("ts")} for m in messages])
                content_hash = hashlib.sha256(content_payload.encode()).hexdigest()

                items.append(SyncItemInfo(
                    item_id=digest_id,
                    item_name=f"Slack_Channel_{container_id}_{today_str}.docx",
                    item_type="docx",
                    size_bytes=len(content_payload),
                    content_hash=content_hash,
                    parent_container_id=container_id,
                    metadata={"messages": messages, "channel_id": container_id}
                ))

        # 2. Fetch files shared in the channel
        files_res = await execute_slack_api_call(
            "GET",
            "files.list",
            access_token,
            params={"channel": container_id, "count": 50}
        )
        if files_res.status_code == 200:
            fbody = files_res.json()
            for f in fbody.get("files", []):
                fname = f.get("name", "")
                f_ext = fname.split(".")[-1].lower() if "." in fname else f.get("filetype", "")
                if f_ext in ALLOWED_EXTENSIONS:
                    f_id = f.get("id")
                    size = f.get("size", 0)
                    url_download = f.get("url_private_download") or f.get("url_private")
                    content_hash = f"{f_id}_{f.get('timestamp')}_{size}"

                    items.append(SyncItemInfo(
                        item_id=f_id,
                        item_name=fname,
                        item_type=f_ext,
                        size_bytes=size,
                        content_hash=content_hash,
                        parent_container_id=container_id,
                        download_url=url_download,
                        metadata={"slack_file_id": f_id}
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
        """Downloads document or formats discussion digest into a readable file."""
        meta = item.metadata or {}
        messages = meta.get("messages")

        # 1. Format channel discussion as structured markdown document
        if messages:
            channel_id = meta.get("channel_id", "channel")
            lines = [
                f"# Slack Channel Discussion Digest: {channel_id}",
                f"Generated on {datetime.now(timezone.utc).isoformat()}",
                "---",
                ""
            ]
            for m in messages:
                user = m.get("user", "User")
                text = m.get("text", "")
                ts = m.get("ts", "")
                try:
                    dt = datetime.fromtimestamp(float(ts), timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    dt = ts
                lines.append(f"**[{dt}] {user}:**\n{text}\n")

            full_text = "\n".join(lines)
            return full_text.encode("utf-8"), item.item_name.replace(".docx", ".pdf"), "pdf"

        # 2. Download binary file with Slack Authorization header
        if item.download_url:
            headers = {"Authorization": f"Bearer {access_token}"}
            async with httpx.AsyncClient(timeout=60.0) as client:
                res = await client.get(item.download_url, headers=headers)
                if res.status_code == 200:
                    return res.content, item.item_name, item.item_type

        raise ValueError(f"Could not download Slack item: {item.item_name}")

