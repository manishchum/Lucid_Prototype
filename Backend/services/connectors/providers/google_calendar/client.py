# Backend/services/connectors/providers/google_calendar/client.py
"""
Resilient Google Calendar API Client with Sensitive Data Guardrails,
DLP PII Redaction, Meeting Digest Generation, Free/Busy Queries,
and Autonomous Event Scheduling.
"""

import os
import re
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Tuple, Dict, Any, List, Optional
import fitz  # PyMuPDF

from services.connectors.providers.google_drive.client import (
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    execute_google_api_call
)
from services.connectors.providers.gmail.client import redact_sensitive_data

GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"

GOOGLE_CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
]


def get_google_calendar_credentials() -> Tuple[str, str, str, str]:
    """Reads Google Cloud credentials from environment."""
    client_id = (
        os.getenv("GOOGLE_CALENDAR_CLIENT_ID")
        or os.getenv("GOOGLE_DRIVE_CLIENT_ID")
        or ""
    ).strip()
    client_secret = (
        os.getenv("GOOGLE_CALENDAR_CLIENT_SECRET")
        or os.getenv("GOOGLE_DRIVE_CLIENT_SECRET")
        or ""
    ).strip()
    redirect_uri = (
        os.getenv("GOOGLE_CALENDAR_REDIRECT_URI")
        or ""
    ).strip()

    if not redirect_uri:
        api_base = os.getenv("API_BASE_URL", "").rstrip("/")
        if not api_base:
            api_base = os.getenv("FRONTEND_URL", "http://localhost:8000").rstrip("/")
        redirect_uri = f"{api_base}/api/connectors/google_calendar/callback"

    webhook_url = (
        os.getenv("GOOGLE_CALENDAR_WEBHOOK_URL")
        or os.getenv("GOOGLE_DRIVE_WEBHOOK_URL")
        or ""
    ).strip()

    if not client_id or not client_secret:
        raise ValueError("GOOGLE_CALENDAR_CLIENT_ID or GOOGLE_DRIVE_CLIENT_ID missing in environment.")

    return client_id, client_secret, redirect_uri, webhook_url


# ============================================================================
# 1. PYMUPDF CALENDAR EVENT DIGEST GENERATOR
# ============================================================================

def build_synthesized_calendar_event_pdf(
    event: Dict[str, Any],
    calendar_name: Optional[str] = None
) -> bytes:
    """
    Generates a publication-grade A4 PDF digest of a Google Calendar event using PyMuPDF.
    Includes:
    - Header Banner (Event Title, Calendar Name, Platform: Google Calendar)
    - Key Metadata (Time, Duration, Time Zone, Status, Video Call Link, Location)
    - Organizer & Attendee List with RSVP statuses
    - DLP-Redacted Agenda / Description
    - Attached Documents
    """
    doc = fitz.open()
    margin = 54
    page_width, page_height = 595, 842  # Standard A4
    line_height = 14
    max_y = page_height - margin

    page = doc.new_page(width=page_width, height=page_height)

    # 1. Extract Event Fields
    summary = event.get("summary") or "Untitled Calendar Event"
    description = redact_sensitive_data(event.get("description") or "No agenda or description provided.")
    location = event.get("location") or "Not specified"
    status = (event.get("status") or "confirmed").upper()

    # Time parsing
    start_info = event.get("start", {})
    end_info = event.get("end", {})
    start_str = start_info.get("dateTime") or start_info.get("date") or "Unknown"
    end_str = end_info.get("dateTime") or end_info.get("date") or "Unknown"
    time_zone = start_info.get("timeZone") or event.get("timeZone") or "UTC"

    # Clean formatted date
    formatted_time = f"{start_str} to {end_str}"
    try:
        if "T" in start_str:
            dt_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            formatted_time = dt_start.strftime("%A, %B %d, %Y at %I:%M %p %Z")
            if "T" in end_str:
                dt_end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                duration_mins = int((dt_end - dt_start).total_seconds() / 60)
                formatted_time += f" ({duration_mins} mins)"
    except Exception:
        pass

    # Conference & links
    hangout_link = event.get("hangoutLink")
    if not hangout_link and event.get("conferenceData"):
        entry_points = event["conferenceData"].get("entryPoints", [])
        for ep in entry_points:
            if ep.get("entryPointType") == "video":
                hangout_link = ep.get("uri")
                break

    # Organizer & Attendees
    organizer = event.get("organizer", {})
    organizer_display = organizer.get("displayName") or organizer.get("email") or "Unknown Organizer"
    if organizer.get("email") and organizer.get("displayName"):
        organizer_display = f"{organizer.get('displayName')} <{organizer.get('email')}>"

    attendees = event.get("attendees", [])
    attachments = event.get("attachments", [])

    # Title Banner
    page.insert_text(
        (margin, margin + 15),
        "Google Calendar Event Digest",
        fontsize=15,
        fontname="hebo",
        color=(0.1, 0.15, 0.3)
    )
    page.insert_text(
        (margin, margin + 35),
        f"Event: {summary}",
        fontsize=12,
        fontname="hebo",
        color=(0.15, 0.15, 0.15)
    )

    meta_sub = f"Calendar: {calendar_name or 'Primary'}  |  Status: {status}  |  TZ: {time_zone}"
    page.insert_text(
        (margin, margin + 50),
        meta_sub,
        fontsize=9,
        fontname="helv",
        color=(0.4, 0.4, 0.4)
    )

    page.insert_text(
        (margin, margin + 65),
        f"When: {formatted_time}",
        fontsize=9.5,
        fontname="hebo",
        color=(0.2, 0.4, 0.6)
    )

    # Divider line
    shape = page.new_shape()
    shape.draw_line(fitz.Point(margin, margin + 75), fitz.Point(page_width - margin, margin + 75))
    shape.finish(color=(0.8, 0.8, 0.8), width=1)
    shape.commit()

    y = margin + 95

    def _print_wrapped_text(text: str, fontsize: float = 9.5, is_bold: bool = False, color: tuple = (0.1, 0.1, 0.1)):
        nonlocal y, page
        font = "hebo" if is_bold else "helv"
        words = text.split()
        if not words:
            y += line_height // 2
            return

        cur_line = ""
        for w in words:
            test_line = f"{cur_line} {w}".strip()
            if len(test_line) * (fontsize * 0.55) > (page_width - 2 * margin):
                if y > max_y:
                    page = doc.new_page(width=page_width, height=page_height)
                    y = margin + 20
                page.insert_text((margin, y), cur_line, fontsize=fontsize, fontname=font, color=color)
                y += line_height
                cur_line = w
            else:
                cur_line = test_line

        if cur_line:
            if y > max_y:
                page = doc.new_page(width=page_width, height=page_height)
                y = margin + 20
            page.insert_text((margin, y), cur_line, fontsize=fontsize, fontname=font, color=color)
            y += line_height

    # Meeting Coordinates
    _print_wrapped_text(f"Organizer: {organizer_display}", fontsize=9.5, is_bold=True, color=(0.15, 0.25, 0.4))
    if hangout_link:
        _print_wrapped_text(f"Video Meeting Link: {hangout_link}", fontsize=9.0, is_bold=False, color=(0.0, 0.4, 0.8))
    if location and location != "Not specified":
        _print_wrapped_text(f"Location: {location}", fontsize=9.0, is_bold=False)

    y += 6

    # Attendees Section
    if attendees:
        _print_wrapped_text(f"Participants & RSVPs ({len(attendees)}):", fontsize=9.5, is_bold=True, color=(0.15, 0.15, 0.15))
        for att in attendees:
            att_name = att.get("displayName") or att.get("email") or "Attendee"
            att_email = att.get("email", "")
            response = att.get("responseStatus", "needsAction")
            resp_icon = {
                "accepted": "✓ Accepted",
                "declined": "✗ Declined",
                "tentative": "? Tentative",
                "needsAction": "○ Pending"
            }.get(response, response)

            line_entry = f"  • {att_name} ({att_email}) — [{resp_icon}]"
            _print_wrapped_text(line_entry, fontsize=8.5, color=(0.25, 0.25, 0.25))

        y += 8

    # Separator
    shape = page.new_shape()
    shape.draw_line(fitz.Point(margin, y), fitz.Point(page_width - margin, y))
    shape.finish(color=(0.9, 0.9, 0.9), width=0.5)
    shape.commit()
    y += 14

    # Agenda / Description Section
    _print_wrapped_text("Meeting Agenda & Description:", fontsize=10, is_bold=True, color=(0.15, 0.3, 0.6))
    y += 2

    for para in description.split("\n"):
        p_clean = para.strip()
        if p_clean:
            _print_wrapped_text(p_clean, fontsize=9.0, is_bold=False)
        else:
            y += line_height // 2

    # Attachments Section
    if attachments:
        y += 10
        _print_wrapped_text("📎 Attached Files & Resources:", fontsize=9.5, is_bold=True, color=(0.3, 0.3, 0.3))
        for att_file in attachments:
            att_title = att_file.get("title") or "Attachment"
            att_url = att_file.get("fileUrl") or ""
            _print_wrapped_text(f"  • {att_title}: {att_url}", fontsize=8.5, color=(0.2, 0.4, 0.7))

    return doc.tobytes()


# ============================================================================
# 2. AUTONOMOUS SCHEDULING & FREE/BUSY API HELPERS (READ & WRITE)
# ============================================================================

async def create_calendar_event(
    access_token: str,
    calendar_id: str,
    summary: str,
    start_time: str,
    end_time: str,
    description: Optional[str] = None,
    attendees: Optional[List[str]] = None,
    add_meet_link: bool = True
) -> Dict[str, Any]:
    """
    Creates a new Google Calendar event with optional Google Meet video conference.
    Used by AI Coach to autonomously schedule 1-on-1s and coaching sessions.
    """
    url = f"{GOOGLE_CALENDAR_API_BASE}/calendars/{calendar_id}/events"
    params = {}
    if add_meet_link:
        params["conferenceDataVersion"] = "1"

    body: Dict[str, Any] = {
        "summary": summary,
        "description": description or "",
        "start": {
            "dateTime": start_time,
        },
        "end": {
            "dateTime": end_time,
        }
    }

    if attendees:
        body["attendees"] = [{"email": a.strip()} for a in attendees if a.strip()]

    if add_meet_link:
        body["conferenceData"] = {
            "createRequest": {
                "requestId": hashlib.md5(f"{summary}_{start_time}".encode()).hexdigest()[:16],
                "conferenceSolutionKey": {"type": "hangoutsMeet"}
            }
        }

    res = await execute_google_api_call(
        method="POST",
        url=url,
        access_token=access_token,
        params=params,
        json_data=body
    )
    if res.status_code not in (200, 201):
        raise ValueError(f"Failed to create Google Calendar event ({res.status_code}): {res.text}")

    return res.json()


async def patch_calendar_event(
    access_token: str,
    calendar_id: str,
    event_id: str,
    patch_data: Dict[str, Any]
) -> Dict[str, Any]:
    """Updates/reschedules an existing Google Calendar event."""
    url = f"{GOOGLE_CALENDAR_API_BASE}/calendars/{calendar_id}/events/{event_id}"
    res = await execute_google_api_call(
        method="PATCH",
        url=url,
        access_token=access_token,
        json_data=patch_data
    )
    if res.status_code != 200:
        raise ValueError(f"Failed to patch Google Calendar event ({res.status_code}): {res.text}")
    return res.json()


async def query_freebusy(
    access_token: str,
    time_min: str,
    time_max: str,
    calendar_ids: List[str]
) -> Dict[str, Any]:
    """Queries free/busy schedule slots for target calendars."""
    url = f"{GOOGLE_CALENDAR_API_BASE}/freeBusy"
    body = {
        "timeMin": time_min,
        "timeMax": time_max,
        "items": [{"id": cid} for cid in calendar_ids]
    }
    res = await execute_google_api_call(
        method="POST",
        url=url,
        access_token=access_token,
        json_data=body
    )
    if res.status_code != 200:
        raise ValueError(f"Failed to query Google Calendar free/busy ({res.status_code}): {res.text}")
    return res.json()

