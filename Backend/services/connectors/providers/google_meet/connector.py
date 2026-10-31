# Backend/services/connectors/providers/google_meet/connector.py
"""
Google Meet Enterprise Connector Implementation of BaseConnector.
Automatically indexes Google Meet Transcripts, Gemini Meeting Notes,
speaker dialogue turns, and in-meeting chat logs into unified PDF digests.
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
    execute_google_api_call,
    parse_google_meet_transcript_text,
    parse_vtt_captions,
    match_speaker_to_employee,
    build_synthesized_meet_pdf
)
from ingestion.coach_store import fetch_company_employees


IGNORED_VIDEO_EXTENSIONS = {".mp4", ".m4a", ".webm", ".avi", ".mov", ".mkv", ".flv"}


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
        Discovers the 'Meet Recordings' system folder in Google Drive.
        Falls back to auto-search root if the user has not yet recorded their first meeting.
        """
        containers: List[ContainerItem] = []

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

        # Fallback container if Meet Recordings folder has not yet been generated by Google Meet
        if not containers and not parent_id:
            containers.append(ContainerItem(
                id="root",
                name="Meet Recordings (Auto-Search in Drive)",
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
        """
        Registers real-time push notifications using Google Drive changes.watch.
        Google delivers push notifications to webhook_url whenever new meeting artifacts land.
        """
        if not webhook_url:
            return {}

        channel_id = str(uuid.uuid4())

        # 1. Fetch initial startPageToken
        res_token = await execute_google_api_call(
            method="GET",
            url=f"{GOOGLE_DRIVE_API_BASE}/changes/startPageToken",
            access_token=access_token,
            params={"supportsAllDrives": "true"}
        )
        if res_token.status_code != 200:
            print(f"[GOOGLE MEET] Note: could not fetch startPageToken: {res_token.text}")
            return {}

        start_page_token = res_token.json().get("startPageToken")

        # 2. Register changes watch channel
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
            exp_dt = datetime.fromtimestamp(exp_ms / 1000.0, timezone.utc) if exp_ms else (datetime.now(timezone.utc) + timedelta(days=7))
            return {
                "channel_id": channel_id,
                "resource_id": data.get("resourceId"),
                "expiration": exp_dt.isoformat() if hasattr(exp_dt, "isoformat") else str(exp_dt),
                "start_cursor": start_page_token
            }
        else:
            print(f"[GOOGLE MEET] Watch registration response ({watch_res.status_code}): {watch_res.text}")
            return {}

    async def stop_watch(
        self,
        access_token: str,
        channel_id: str,
        resource_id: str
    ) -> bool:
        """Deregisters Google Drive push watch channel."""
        if not channel_id or not resource_id:
            return True

        body = {"id": channel_id, "resourceId": resource_id}
        res = await execute_google_api_call(
            method="POST",
            url=f"{GOOGLE_DRIVE_API_BASE}/channels/stop",
            access_token=access_token,
            json_data=body
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
        Scans Google Meet transcripts, notes (.gdoc), and caption logs (.vtt).
        Intelligently pairs in-meeting chat logs ((Chat).txt) to the parent transcript,
        and excludes raw multi-gigabyte .mp4 video files to prevent storage bloat.
        """
        items: List[SyncItemInfo] = []

        # Target Google Docs, VTT captions, and chat logs; exclude raw video files
        q = "trashed = false and (mimeType = 'application/vnd.google-apps.document' or name contains '.vtt' or name contains 'Transcript' or name contains 'Chat')"
        if container_id and container_id != "root":
            q += f" and '{container_id}' in parents"

        url = f"{GOOGLE_DRIVE_API_BASE}/files"
        params = {
            "q": q,
            "fields": "files(id, name, mimeType, modifiedTime, md5Checksum, size, parents)",
            "pageSize": 100,
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true"
        }

        res = await execute_google_api_call("GET", url, access_token, params=params)
        if res.status_code != 200:
            print(f"[GOOGLE MEET] Scan failed ({res.status_code}): {res.text}")
            return []

        all_files = res.json().get("files", [])

        # Step 1: Map chat logs by meeting base name (e.g. "Weekly 1-on-1 (2026-10-31)")
        chat_map: Dict[str, str] = {}
        for f in all_files:
            fname = f.get("name", "")
            # Check for chat log pattern
            if "chat" in fname.lower() and fname.endswith(".txt"):
                # Normalize key by stripping " - Chat.txt" or "(Chat).txt"
                clean_base = (
                    fname.replace(" - Chat.txt", "")
                    .replace(" (Chat).txt", "")
                    .replace("(Chat).txt", "")
                    .replace(" Chat.txt", "")
                    .replace(".txt", "")
                    .strip()
                    .lower()
                )
                chat_map[clean_base] = f["id"]

        # Step 2: Build SyncItemInfo for transcripts and notes
        for f in all_files:
            f_id = f["id"]
            name = f["name"]
            mime = f.get("mimeType", "")
            size = int(f.get("size", 1024))
            ext = os.path.splitext(name)[1].lower()

            # Strictly skip raw video/audio files
            if ext in IGNORED_VIDEO_EXTENSIONS:
                continue

            # Skip standalone chat file from primary sync list (it gets appended to the transcript)
            if "chat" in name.lower() and ext == ".txt":
                continue

            content_hash = f.get("md5Checksum") or f"{f_id}_{f.get('modifiedTime')}"
            mod_time = None
            if f.get("modifiedTime"):
                try:
                    mod_time = datetime.fromisoformat(f["modifiedTime"].replace("Z", "+00:00"))
                except Exception:
                    pass

            is_doc = "google-apps.document" in mime or "document" in mime
            clean_display_name = name if name.endswith(".pdf") else f"{name}.pdf"

            # Check if this transcript has a matching in-meeting chat log
            name_base = (
                name.replace(" - Transcript", "")
                .replace(" (Transcript)", "")
                .replace(" Transcript", "")
                .strip()
                .lower()
            )
            chat_file_id = chat_map.get(name_base)

            items.append(SyncItemInfo(
                item_id=f_id,
                item_name=clean_display_name,
                item_type="pdf",
                size_bytes=size,
                content_hash=content_hash,
                parent_container_id=container_id,
                modified_time=mod_time,
                mime_type=mime,
                metadata={
                    "google_file_id": f_id,
                    "is_workspace_doc": is_doc,
                    "original_name": name,
                    "chat_file_id": chat_file_id
                }
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
        """
        Exports Google Meet transcripts and Gemini notes to text/PDF.
        Parses verbatim speaker attribution, resolves participant employee identity,
        and appends in-meeting chat logs as an appendix into a unified PDF digest.
        """
        meta = item.metadata or {}
        file_id = meta.get("google_file_id") or item.item_id
        is_workspace_doc = meta.get("is_workspace_doc", True)
        chat_file_id = meta.get("chat_file_id")
        original_name = meta.get("original_name") or item.item_name

        chat_text: Optional[str] = None

        # 1. Download in-meeting chat log if available
        if chat_file_id:
            try:
                chat_res = await execute_google_api_call(
                    "GET",
                    f"{GOOGLE_DRIVE_API_BASE}/files/{chat_file_id}?alt=media",
                    access_token,
                    timeout=30.0
                )
                if chat_res.status_code == 200:
                    chat_text = chat_res.text
            except Exception as chat_err:
                print(f"[GOOGLE MEET] Note: could not download chat appendix: {chat_err}")

        # 2. Extract transcript content
        if is_workspace_doc:
            # Export Google Doc as structured plain text for parsing
            export_text_url = f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}/export?mimeType=text/plain"
            text_res = await execute_google_api_call("GET", export_text_url, access_token, timeout=60.0)

            if text_res.status_code == 200:
                raw_text = text_res.text
                parsed_data = parse_google_meet_transcript_text(raw_text)

                meeting_title = parsed_data.get("meeting_title") or original_name.replace(".pdf", "")
                date_str = parsed_data.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
                participants = parsed_data.get("attendees") or []
                dialogue_turns = parsed_data.get("turns") or []

                # Synthesize publication-grade PDF digest with speaker tags and chat appendix
                pdf_bytes = build_synthesized_meet_pdf(
                    title=meeting_title,
                    date_str=date_str,
                    participants=participants,
                    dialogue_turns=dialogue_turns,
                    raw_content=raw_text if not dialogue_turns else None,
                    chat_log=chat_text
                )

                # Store detected participants in item metadata for coach_store employee matching
                if participants:
                    meta["detected_participants"] = participants

                clean_filename = f"{meeting_title}.pdf" if not meeting_title.endswith(".pdf") else meeting_title
                return pdf_bytes, clean_filename, "pdf"

            # Fallback direct PDF export if text export fails
            export_pdf_url = f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}/export?mimeType=application/pdf"
            pdf_res = await execute_google_api_call("GET", export_pdf_url, access_token, timeout=60.0)
            if pdf_res.status_code == 200:
                return pdf_res.content, item.item_name, "pdf"

            raise ValueError(f"Failed to export Google Meet document {item.item_name} ({text_res.status_code})")

        # 3. Handle raw .vtt caption files
        url = f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}?alt=media"
        res = await execute_google_api_call("GET", url, access_token, timeout=60.0)
        if res.status_code != 200:
            raise ValueError(f"Failed to download Google Meet caption file {item.item_name} ({res.status_code})")

        vtt_data = parse_vtt_captions(res.text)
        pdf_bytes = build_synthesized_meet_pdf(
            title=original_name.replace(".vtt", ""),
            date_str=vtt_data.get("date", ""),
            participants=vtt_data.get("attendees", []),
            dialogue_turns=vtt_data.get("turns", []),
            chat_log=chat_text
        )

        clean_filename = original_name.replace(".vtt", ".pdf")
        return pdf_bytes, clean_filename, "pdf"
