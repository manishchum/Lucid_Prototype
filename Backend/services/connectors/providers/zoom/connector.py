# Backend/services/connectors/providers/zoom/connector.py
"""
Zoom Enterprise Connector Implementation of BaseConnector.
Ingests Cloud Meeting Audio/Video Transcripts and AI Companion Summaries.
"""

import os
import uuid
import json
import base64
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
from services.connectors.providers.zoom.client import (
    ZOOM_AUTH_URL,
    ZOOM_TOKEN_URL,
    ZOOM_DEFAULT_SCOPES,
    get_zoom_credentials,
    execute_zoom_api_call
)


class ZoomConnector(BaseConnector):
    """Enterprise Zoom Cloud Recordings & Transcripts Connector."""

    @property
    def provider_name(self) -> str:
        return "zoom"

    @property
    def display_name(self) -> str:
        return "Zoom"

    def generate_auth_url(self, company_id: str, user_id: str, redirect_uri: Optional[str] = None) -> str:
        client_id, _, _, default_redirect, _ = get_zoom_credentials()
        redirect = redirect_uri or default_redirect

        state_payload = {
            "company_id": company_id,
            "user_id": user_id,
            "provider": self.provider_name,
            "nonce": str(uuid.uuid4())
        }
        state_str = urllib.parse.quote(json.dumps(state_payload))

        params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect,
            "state": state_str
        }
        return f"{ZOOM_AUTH_URL}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
        client_id, client_secret, _, default_redirect, _ = get_zoom_credentials()
        redirect = redirect_uri or default_redirect

        auth_header = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        headers = {
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(ZOOM_TOKEN_URL, headers=headers, data=data)
            if res.status_code != 200:
                raise ValueError(f"Zoom token exchange failed ({res.status_code}): {res.text}")
            token_payload = res.json()

        access_token = token_payload["access_token"]
        refresh_token = token_payload.get("refresh_token")
        expires_in = token_payload.get("expires_in", 3600)

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
        client_id, client_secret, _, _, _ = get_zoom_credentials()
        auth_header = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        headers = {
            "Authorization": f"Basic {auth_header}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(ZOOM_TOKEN_URL, headers=headers, data=data)
            if res.status_code != 200:
                raise ValueError(f"Zoom token refresh failed ({res.status_code}): {res.text}")
            payload = res.json()

        return {
            "access_token": payload["access_token"],
            "refresh_token": payload.get("refresh_token") or refresh_token,
            "expires_in": payload.get("expires_in", 3600)
        }

    async def get_account_info(self, access_token: str) -> ConnectorAccountInfo:
        res = await execute_zoom_api_call("GET", "/users/me", access_token)
        if res.status_code != 200:
            raise ValueError(f"Failed to fetch Zoom profile ({res.status_code}): {res.text}")
        data = res.json()
        email = data.get("email", "zoom-user")
        name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip() or email
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
        """Lists browseable Zoom containers (All Cloud Recordings and Meeting topics)."""
        containers: List[ContainerItem] = [
            ContainerItem(
                id="all_recordings",
                name="All Cloud Recordings",
                container_type="workspace",
                parent_id=None,
                path="/All Cloud Recordings",
                has_children=False,
                can_select=True
            ),
            ContainerItem(
                id="coaching_meetings",
                name="Coaching & 1-on-1 Sessions",
                container_type="folder",
                parent_id=None,
                path="/Coaching & 1-on-1 Sessions",
                has_children=False,
                can_select=True
            )
        ]

        # Fetch recent scheduled/past meetings to allow per-series monitoring
        try:
            res = await execute_zoom_api_call("GET", "/users/me/meetings?type=scheduled&page_size=30", access_token)
            if res.status_code == 200:
                meetings = res.json().get("meetings", [])
                for m in meetings:
                    topic = m.get("topic") or "Zoom Meeting"
                    m_id = str(m.get("id"))
                    containers.append(ContainerItem(
                        id=f"meeting:{m_id}",
                        name=f"Meeting: {topic}",
                        container_type="folder",
                        parent_id="all_recordings",
                        path=f"/{topic}",
                        has_children=False,
                        can_select=True,
                        metadata={"meeting_id": m_id}
                    ))
        except Exception as e:
            print(f"[ZOOM] Note listing meeting containers: {e}")

        return containers

    async def register_watch(
        self,
        access_token: str,
        source_id: str,
        webhook_url: str
    ) -> Dict[str, Any]:
        exp_time = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
        return {
            "channel_id": f"zoom_rec_{source_id}",
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
        Fetches audio/video transcripts (.vtt) and AI summaries from Zoom cloud recordings.
        """
        items: List[SyncItemInfo] = []
        now = datetime.now(timezone.utc)
        from_date = (now - timedelta(days=90)).strftime("%Y-%m-%d")
        to_date = now.strftime("%Y-%m-%d")

        url = f"/users/me/recordings?from={from_date}&to={to_date}&page_size=50"
        res = await execute_zoom_api_call("GET", url, access_token)
        if res.status_code != 200:
            print(f"[ZOOM] Error fetching recordings ({res.status_code}): {res.text}")
            return items

        body = res.json()
        meetings = body.get("meetings", [])

        for m in meetings:
            m_id = str(m.get("id"))
            topic = m.get("topic") or "Zoom Meeting"
            recording_files = m.get("recording_files", [])

            # Check if filtering for a specific meeting
            if container_id.startswith("meeting:") and container_id != f"meeting:{m_id}":
                continue

            # Find transcript file (.vtt or file_type == 'TRANSCRIPT')
            transcript_file = None
            for f in recording_files:
                ft = (f.get("file_type") or "").upper()
                fe = (f.get("file_extension") or "").upper()
                if ft in ("TRANSCRIPT", "TIMELINE") or fe in ("VTT", "TXT"):
                    transcript_file = f
                    break

            if transcript_file:
                f_id = transcript_file.get("id", m_id)
                size = transcript_file.get("file_size", 1024)
                down_url = transcript_file.get("download_url")
                content_hash = f"{f_id}_{transcript_file.get('recording_end')}_{size}"

                items.append(SyncItemInfo(
                    item_id=f_id,
                    item_name=f"{topic} - Transcript.vtt",
                    item_type="docx",
                    size_bytes=size,
                    content_hash=content_hash,
                    parent_container_id=container_id,
                    download_url=down_url,
                    metadata={"meeting_id": m_id, "topic": topic, "file_id": f_id}
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
        """Downloads Zoom transcript and formats with meeting metadata for vectorization."""
        meta = item.metadata or {}
        topic = meta.get("topic", "Zoom Meeting")
        meeting_id = meta.get("meeting_id")

        transcript_text = ""
        if item.download_url:
            headers = {"Authorization": f"Bearer {access_token}"}
            async with httpx.AsyncClient(timeout=60.0) as client:
                res = await client.get(item.download_url, headers=headers)
                if res.status_code == 200:
                    transcript_text = res.text

        # Optionally fetch Zoom AI Companion Summary
        ai_summary = ""
        if meeting_id:
            try:
                summary_res = await execute_zoom_api_call("GET", f"/meetings/{meeting_id}/meeting_summary", access_token)
                if summary_res.status_code == 200:
                    s_body = summary_res.json()
                    ai_summary = s_body.get("summary_content") or ""
            except Exception:
                pass

        # Synthesize into clean coaching document
        lines = [
            f"# Zoom Meeting Coaching Record: {topic}",
            f"Meeting ID: {meeting_id}",
            f"Indexed: {datetime.now(timezone.utc).isoformat()}",
            "---",
            ""
        ]
        if ai_summary:
            lines.append("## AI Companion Meeting Summary\n" + ai_summary + "\n")

        lines.append("## Full Transcript with Timestamps\n")
        lines.append(transcript_text or "[Transcript audio processed]")

        clean_doc_bytes = "\n".join(lines).encode("utf-8")
        clean_filename = f"{topic.replace(' ', '_')}_Transcript.pdf"
        return clean_doc_bytes, clean_filename, "pdf"

