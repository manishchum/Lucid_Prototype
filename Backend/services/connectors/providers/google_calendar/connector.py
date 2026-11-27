# Backend/services/connectors/providers/google_calendar/connector.py
"""
Google Calendar Enterprise Connector Implementation of BaseConnector.
Supports:
- Calendar List browsing (Primary, Team, Coaching Calendars)
- Event ingestion with singleEvents expansion for recurrences
- Cross-connector participant detection for employee matching
- DLP PII redaction and publication-grade PyMuPDF meeting digest generation
- Real-time webhook change push notifications (events.watch)
- Read & Write autonomous booking and free/busy queries
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
from services.connectors.providers.google_calendar.client import (
    GOOGLE_CALENDAR_API_BASE,
    GOOGLE_CALENDAR_SCOPES,
    get_google_calendar_credentials,
    build_synthesized_calendar_event_pdf,
    create_calendar_event,
    patch_calendar_event,
    query_freebusy
)
from services.connectors.providers.google_drive.client import (
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    execute_google_api_call
)
from utils.file_utils import sanitize_filename


class GoogleCalendarConnector(BaseConnector):
    """Enterprise Google Calendar Connector with Read & Write Capabilities."""

    @property
    def provider_name(self) -> str:
        return "google_calendar"

    @property
    def display_name(self) -> str:
        return "Google Calendar"

    def generate_auth_url(self, company_id: str, user_id: str, redirect_uri: Optional[str] = None) -> str:
        client_id, _, default_redirect, _ = get_google_calendar_credentials()
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
            "scope": " ".join(GOOGLE_CALENDAR_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state_str,
            "include_granted_scopes": "true"
        }
        return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
        client_id, client_secret, default_redirect, _ = get_google_calendar_credentials()
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
                raise ValueError(f"Google Calendar token exchange failed ({res.status_code}): {res.text}")
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
        client_id, client_secret, _, _ = get_google_calendar_credentials()
        data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(GOOGLE_TOKEN_URL, data=data)
            if res.status_code != 200:
                raise ValueError(f"Google Calendar token refresh failed ({res.status_code}): {res.text}")
            payload = res.json()

        return {
            "access_token": payload["access_token"],
            "refresh_token": payload.get("refresh_token") or refresh_token,
            "expires_in": payload.get("expires_in", 3600)
        }

    async def get_account_info(self, access_token: str) -> ConnectorAccountInfo:
        res = await execute_google_api_call("GET", GOOGLE_USERINFO_URL, access_token)
        if res.status_code != 200:
            raise ValueError("Failed to retrieve Google userinfo for calendar connector.")
        data = res.json()
        return ConnectorAccountInfo(
            provider=self.provider_name,
            account_identifier=data.get("email", "calendar-user"),
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
        Lists all accessible Google Calendars for the authenticated account.
        Allows users to select Primary Calendar, Team Calendars, or 1:1 Coaching Calendars.
        """
        containers: List[ContainerItem] = []
        url = f"{GOOGLE_CALENDAR_API_BASE}/users/me/calendarList"
        res = await execute_google_api_call("GET", url, access_token)
        if res.status_code != 200:
            print(f"[GOOGLE CALENDAR] Failed to fetch calendar list ({res.status_code}): {res.text}")
            return []

        calendars = res.json().get("items", [])
        for cal in calendars:
            cal_id = cal.get("id")
            summary = cal.get("summary") or cal_id
            is_primary = cal.get("primary", False)
            access_role = cal.get("accessRole", "reader")

            summary_lower = summary.lower()
            is_coaching = any(k in summary_lower for k in ("coaching", "1:1", "1-on-1", "review", "feedback", "mentor"))

            if is_primary:
                display_label = f"📅 {summary} (Primary Calendar)"
            elif is_coaching:
                display_label = f"🎯 {summary} (Coaching)"
            else:
                display_label = f"📆 {summary}"

            containers.append(ContainerItem(
                id=cal_id,
                name=display_label,
                container_type="calendar",
                parent_id=None,
                path=f"/{summary}",
                has_children=False,
                can_select=True,
                metadata={
                    "raw_summary": summary,
                    "primary": is_primary,
                    "access_role": access_role,
                    "time_zone": cal.get("timeZone"),
                    "is_coaching": is_coaching
                }
            ))

        # Sort: Primary first, Coaching second, then alphabetical
        containers.sort(key=lambda c: (
            0 if c.metadata.get("primary") else
            1 if c.metadata.get("is_coaching") else 2,
            c.name.lower()
        ))

        return containers

    async def register_watch(
        self,
        access_token: str,
        source_id: str,
        webhook_url: str
    ) -> Dict[str, Any]:
        """
        Subscribes to Google Calendar push change notifications (events.watch).
        Delivers push pings to webhook_url whenever events are created, modified, or deleted.
        """
        if not webhook_url:
            return {}

        channel_id = str(uuid.uuid4())
        cal_id = urllib.parse.quote(source_id or "primary")
        url = f"{GOOGLE_CALENDAR_API_BASE}/calendars/{cal_id}/events/watch"

        watch_payload = {
            "id": channel_id,
            "type": "web_hook",
            "address": webhook_url
        }

        watch_res = await execute_google_api_call(
            method="POST",
            url=url,
            access_token=access_token,
            json_data=watch_payload
        )

        if watch_res.status_code in (200, 201):
            data = watch_res.json()
            exp_ms = int(data.get("expiration", 0))
            exp_dt = (
                datetime.fromtimestamp(exp_ms / 1000.0, timezone.utc)
                if exp_ms else (datetime.now(timezone.utc) + timedelta(days=7))
            )
            return {
                "channel_id": channel_id,
                "resource_id": data.get("resourceId"),
                "expiration": exp_dt.isoformat() if hasattr(exp_dt, "isoformat") else str(exp_dt),
                "start_cursor": None
            }
        else:
            print(f"[GOOGLE CALENDAR] Watch registration response ({watch_res.status_code}): {watch_res.text}")
            return {}

    async def stop_watch(
        self,
        access_token: str,
        channel_id: str,
        resource_id: str
    ) -> bool:
        """Deregisters Google Calendar push watch channel."""
        if not channel_id or not resource_id:
            return True

        body = {"id": channel_id, "resourceId": resource_id}
        res = await execute_google_api_call(
            method="POST",
            url=f"{GOOGLE_CALENDAR_API_BASE}/channels/stop",
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
        Scans calendar events from past 60 days to next 90 days.
        Expands recurring meetings into discrete instances, extracts attendees & agendas,
        and constructs SyncItemInfo objects for RAG embedding.
        """
        items: List[SyncItemInfo] = []
        cal_id = urllib.parse.quote(container_id or "primary")

        # Range: 60 days in past (coaching history) to 90 days in future (upcoming prep)
        now_dt = datetime.now(timezone.utc)
        time_min = (now_dt - timedelta(days=60)).isoformat()
        time_max = (now_dt + timedelta(days=90)).isoformat()

        url = f"{GOOGLE_CALENDAR_API_BASE}/calendars/{cal_id}/events"
        params = {
            "singleEvents": "true",
            "orderBy": "startTime",
            "timeMin": time_min,
            "timeMax": time_max,
            "maxResults": 250
        }

        res = await execute_google_api_call("GET", url, access_token, params=params)
        if res.status_code != 200:
            print(f"[GOOGLE CALENDAR] Fetch events failed ({res.status_code}): {res.text}")
            return []

        payload = res.json()
        events = payload.get("items", [])

        for ev in events:
            ev_id = ev.get("id")
            if not ev_id:
                continue

            summary = (ev.get("summary") or "Untitled Event").strip()
            status = ev.get("status", "confirmed")

            # Ignore cancelled events in full scan
            if status == "cancelled":
                continue

            # Start time extraction
            start_info = ev.get("start", {})
            start_date_str = (start_info.get("dateTime") or start_info.get("date") or "event")[:10]

            clean_filename = f"{sanitize_filename(summary)} - {start_date_str}.pdf"

            # Parse participant emails for ACL and target employee resolution
            organizer = ev.get("organizer", {})
            organizer_email = organizer.get("email")

            attendees = ev.get("attendees", [])
            attendee_emails = [
                a.get("email").strip().lower()
                for a in attendees
                if a.get("email") and not a.get("resource")
            ]

            all_participants = list(set([e for e in attendee_emails if e]))
            if organizer_email and organizer_email not in all_participants:
                all_participants.append(organizer_email.lower())

            mod_time = None
            if ev.get("updated"):
                try:
                    mod_time = datetime.fromisoformat(ev["updated"].replace("Z", "+00:00"))
                except Exception:
                    pass

            content_hash = hashlib.md5(
                f"{ev_id}_{ev.get('updated', '')}_{status}_{summary}".encode("utf-8")
            ).hexdigest()

            items.append(SyncItemInfo(
                item_id=ev_id,
                item_name=clean_filename,
                item_type="pdf",
                size_bytes=2048,
                content_hash=content_hash,
                parent_container_id=container_id,
                modified_time=mod_time,
                mime_type="application/pdf",
                acl_emails=all_participants,
                owner_email=organizer_email,
                is_restricted_inheritance=False,
                metadata={
                    "event_id": ev_id,
                    "calendar_id": container_id,
                    "summary": summary,
                    "status": status,
                    "detected_participants": all_participants,
                    "hangout_link": ev.get("hangoutLink"),
                    "start": ev.get("start"),
                    "end": ev.get("end"),
                    "event_data": ev
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
        """
        Executes incremental delta sync using Google Calendar syncToken.
        Gracefully handles 410 Gone by falling back to full refresh.
        """
        if not monitored_source_ids:
            return [], None

        cal_id = urllib.parse.quote(monitored_source_ids[0] or "primary")
        url = f"{GOOGLE_CALENDAR_API_BASE}/calendars/{cal_id}/events"

        if sync_cursor:
            params = {"syncToken": sync_cursor}
            res = await execute_google_api_call("GET", url, access_token, params=params)
            if res.status_code == 410:
                # Sync token expired or invalidated; perform full resync
                print("[GOOGLE CALENDAR] syncToken expired (410). Falling back to full sync.")
                items = await self.fetch_items_in_container(access_token, monitored_source_ids[0])
                return items, None
            elif res.status_code != 200:
                print(f"[GOOGLE CALENDAR] Incremental sync error ({res.status_code}): {res.text}")
                return [], sync_cursor

            payload = res.json()
            events = payload.get("items", [])
            next_sync_token = payload.get("nextSyncToken")

            changed_items: List[SyncItemInfo] = []
            for ev in events:
                ev_id = ev.get("id")
                if not ev_id:
                    continue

                status = ev.get("status", "confirmed")
                summary = (ev.get("summary") or "Untitled Event").strip()
                start_info = ev.get("start", {})
                start_date_str = (start_info.get("dateTime") or start_info.get("date") or "event")[:10]
                clean_filename = f"{sanitize_filename(summary)} - {start_date_str}.pdf"

                organizer = ev.get("organizer", {})
                organizer_email = organizer.get("email")

                attendees = ev.get("attendees", [])
                attendee_emails = [
                    a.get("email").strip().lower()
                    for a in attendees
                    if a.get("email") and not a.get("resource")
                ]
                all_participants = list(set([e for e in attendee_emails if e]))
                if organizer_email and organizer_email not in all_participants:
                    all_participants.append(organizer_email.lower())

                mod_time = None
                if ev.get("updated"):
                    try:
                        mod_time = datetime.fromisoformat(ev["updated"].replace("Z", "+00:00"))
                    except Exception:
                        pass

                content_hash = hashlib.md5(
                    f"{ev_id}_{ev.get('updated', '')}_{status}_{summary}".encode("utf-8")
                ).hexdigest()

                changed_items.append(SyncItemInfo(
                    item_id=ev_id,
                    item_name=clean_filename,
                    item_type="pdf",
                    size_bytes=2048,
                    content_hash=content_hash,
                    parent_container_id=monitored_source_ids[0],
                    modified_time=mod_time,
                    mime_type="application/pdf",
                    acl_emails=all_participants,
                    owner_email=organizer_email,
                    is_restricted_inheritance=False,
                    metadata={
                        "event_id": ev_id,
                        "calendar_id": monitored_source_ids[0],
                        "summary": summary,
                        "status": status,
                        "is_deleted": status == "cancelled",
                        "detected_participants": all_participants,
                        "hangout_link": ev.get("hangoutLink"),
                        "event_data": ev
                    }
                ))

            return changed_items, next_sync_token
        else:
            items = await self.fetch_items_in_container(access_token, monitored_source_ids[0])
            return items, str(uuid.uuid4())

    async def download_item(
        self,
        access_token: str,
        item: SyncItemInfo
    ) -> Tuple[bytes, str, str]:
        """
        Synthesizes a Google Calendar event into a DLP-redacted, publication-grade
        A4 PDF digest using PyMuPDF.
        """
        meta = item.metadata or {}
        event_data = meta.get("event_data")

        # If full event data is not cached in metadata, fetch directly from Calendar API
        if not event_data:
            cal_id = urllib.parse.quote(meta.get("calendar_id") or item.parent_container_id or "primary")
            ev_id = meta.get("event_id") or item.item_id
            url = f"{GOOGLE_CALENDAR_API_BASE}/calendars/{cal_id}/events/{ev_id}"
            res = await execute_google_api_call("GET", url, access_token)
            if res.status_code == 200:
                event_data = res.json()
            else:
                event_data = {
                    "summary": item.item_name.replace(".pdf", ""),
                    "status": "confirmed",
                    "description": "Event metadata retrieved without full body."
                }

        pdf_bytes = build_synthesized_calendar_event_pdf(
            event=event_data,
            calendar_name=meta.get("calendar_id")
        )

        return pdf_bytes, item.item_name, "pdf"

    # ========================================================================
    # READ & WRITE CAPABILITIES (AUTONOMOUS SCHEDULING & FREE/BUSY)
    # ========================================================================

    async def schedule_meeting(
        self,
        access_token: str,
        calendar_id: str,
        summary: str,
        start_time: str,
        end_time: str,
        description: Optional[str] = None,
        attendees: Optional[List[str]] = None,
        add_meet_link: bool = True
    ) -> Dict[str, Any]:
        """Exposes autonomous event creation directly through connector."""
        return await create_calendar_event(
            access_token=access_token,
            calendar_id=calendar_id,
            summary=summary,
            start_time=start_time,
            end_time=end_time,
            description=description,
            attendees=attendees,
            add_meet_link=add_meet_link
        )

    async def check_availability(
        self,
        access_token: str,
        time_min: str,
        time_max: str,
        calendar_ids: List[str]
    ) -> Dict[str, Any]:
        """Queries free/busy slots across given calendars."""
        return await query_freebusy(
            access_token=access_token,
            time_min=time_min,
            time_max=time_max,
            calendar_ids=calendar_ids
        )

