# Backend/services/connectors/providers/google_meet/client.py
"""
Client for Google Meet API and Google Workspace Meet Recordings.
Includes transcript parsing, speaker dialogue extraction, and PDF digest generation.
"""

import os
import re
from datetime import datetime, timezone
from typing import Tuple, Dict, Any, List, Optional
import fitz  # PyMuPDF

from services.connectors.providers.google_drive.client import (
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    GOOGLE_DRIVE_API_BASE,
    execute_google_api_call
)

GOOGLE_MEET_SCOPES = [
    "https://www.googleapis.com/auth/meetings.space.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
]

SPEAKER_BLOCK_REGEX = re.compile(
    r'^([A-Z][a-zA-Z\s\.\-]+?)\s*(?:\[|\()(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\)):?\s*\n?(.*?)(?=(?:^[A-Z][a-zA-Z\s\.\-]+?\s*(?:\[|\()\d{1,2}:\d{2}|\Z))',
    re.MULTILINE | re.DOTALL
)

VTT_ENTRY_REGEX = re.compile(
    r'(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\s*\n<v\s+([^>]+)>(.*?)</v>',
    re.DOTALL
)


def get_google_meet_credentials() -> Tuple[str, str, str, str]:
    """Reads Google Cloud credentials from environment."""
    client_id = (os.getenv("GOOGLE_MEET_CLIENT_ID") or os.getenv("GOOGLE_DRIVE_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("GOOGLE_MEET_CLIENT_SECRET") or os.getenv("GOOGLE_DRIVE_CLIENT_SECRET") or "").strip()
    redirect_uri = (os.getenv("GOOGLE_MEET_REDIRECT_URI") or os.getenv("GOOGLE_DRIVE_REDIRECT_URI") or "").strip()
    webhook_url = (os.getenv("GOOGLE_MEET_WEBHOOK_URL") or os.getenv("GOOGLE_DRIVE_WEBHOOK_URL") or "").strip()

    if not client_id or not client_secret:
        raise ValueError("GOOGLE_MEET_CLIENT_ID or GOOGLE_DRIVE_CLIENT_ID missing in environment.")

    return client_id, client_secret, redirect_uri, webhook_url


def parse_google_meet_transcript_text(raw_text: str) -> Dict[str, Any]:
    """
    Parses Google Meet transcript text into structured metadata and dialogue turns.
    Handles Google Docs verbatim transcripts and Gemini meeting notes.
    """
    clean_text = raw_text.replace("\r\n", "\n").strip()
    lines = clean_text.split("\n")

    meeting_title = "Google Meet Session"
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    attendees: List[str] = []

    # Extract metadata from header lines
    for line in lines[:15]:
        line_clean = line.strip()
        if line_clean.lower().startswith("meeting name:") or line_clean.lower().startswith("meeting title:"):
            meeting_title = line_clean.split(":", 1)[1].strip()
        elif line_clean.lower().startswith("date:"):
            date_str = line_clean.split(":", 1)[1].strip()
        elif line_clean.lower().startswith("attendees:"):
            raw_att = line_clean.split(":", 1)[1].strip()
            attendees = [a.strip() for a in raw_att.split(",") if a.strip()]

    # Extract dialogue turns
    turns: List[Dict[str, str]] = []
    matches = SPEAKER_BLOCK_REGEX.findall(clean_text)
    seen_speakers = set()

    for spk, ts, text in matches:
        spk_clean = spk.strip()
        ts_clean = ts.strip()
        text_clean = text.strip()
        if spk_clean and text_clean:
            seen_speakers.add(spk_clean)
            turns.append({
                "speaker": spk_clean,
                "timestamp": ts_clean,
                "text": text_clean
            })

    if not attendees and seen_speakers:
        attendees = sorted(list(seen_speakers))

    return {
        "meeting_title": meeting_title,
        "date": date_str,
        "attendees": attendees,
        "turns": turns,
        "is_parsed": len(turns) > 0,
        "raw_text": clean_text
    }


def parse_vtt_captions(raw_vtt: str) -> Dict[str, Any]:
    """Parses .vtt caption files into structured dialogue turns."""
    turns: List[Dict[str, str]] = []
    seen_speakers = set()

    for ts, spk, text in VTT_ENTRY_REGEX.findall(raw_vtt):
        spk_clean = spk.strip()
        text_clean = text.strip()
        ts_clean = ts[:8]
        if spk_clean and text_clean:
            seen_speakers.add(spk_clean)
            turns.append({
                "speaker": spk_clean,
                "timestamp": ts_clean,
                "text": text_clean
            })

    return {
        "meeting_title": "Google Meet Captions",
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "attendees": sorted(list(seen_speakers)),
        "turns": turns,
        "is_parsed": len(turns) > 0,
        "raw_text": raw_vtt
    }


def match_speaker_to_employee(
    speakers: List[str],
    company_employees: List[Dict[str, Any]],
    host_email: Optional[str] = None
) -> Optional[str]:
    """
    Matches meeting speakers to company employees.
    Prioritizes non-host participants for 1-on-1 coaching context resolution.
    """
    if not speakers or not company_employees:
        return None

    # Exclude host / organizer if known
    host_tokens = set()
    if host_email:
        host_user = host_email.split("@")[0].lower()
        host_tokens.add(host_user)
        for part in re.split(r'[\._\-]', host_user):
            if len(part) >= 3:
                host_tokens.add(part)

    # First pass: look for non-host match
    for spk in speakers:
        spk_clean = spk.lower().strip()
        spk_parts = [p for p in re.split(r'[\s\._\-]', spk_clean) if len(p) >= 2]

        for emp in company_employees:
            emp_name = (emp.get("name") or "").lower().strip()
            emp_email = (emp.get("email") or "").lower().strip()
            emp_id = emp.get("user_id")

            if not emp_id or not emp_name:
                continue

            # Check if this employee is the host
            if any(tok in emp_email for tok in host_tokens):
                continue

            # Exact name match
            if spk_clean == emp_name:
                return emp_id

            # First + Last name match
            emp_parts = [p for p in re.split(r'[\s\._\-]', emp_name) if len(p) >= 2]
            if len(spk_parts) >= 2 and len(emp_parts) >= 2:
                if spk_parts[0] == emp_parts[0] and spk_parts[-1] == emp_parts[-1]:
                    return emp_id

    # Fallback second pass: match any employee in roster
    for spk in speakers:
        spk_clean = spk.lower().strip()
        for emp in company_employees:
            emp_name = (emp.get("name") or "").lower().strip()
            if spk_clean == emp_name and emp.get("user_id"):
                return emp.get("user_id")

    return None


def build_synthesized_meet_pdf(
    title: str,
    date_str: str,
    participants: List[str],
    dialogue_turns: List[Dict[str, str]],
    raw_content: Optional[str] = None,
    chat_log: Optional[str] = None
) -> bytes:
    """
    Generates a clean, paginated, publication-grade PDF transcript with:
    - Executive Header (Title, Date, Participants, Platform)
    - Full Timestamped Dialogue Turns: [HH:MM:SS] Speaker: text
    - Appendix: In-Meeting Chat Messages (if present)
    Uses PyMuPDF (fitz) for fast, zero-dependency PDF rendering.
    """
    doc = fitz.open()
    margin = 54
    page_width, page_height = 595, 842  # Standard A4 in points
    line_height = 14
    max_y = page_height - margin

    page = doc.new_page(width=page_width, height=page_height)
    
    # Header block
    page.insert_text((margin, margin + 15), f"Google Meet Session Digest", fontsize=15, fontname="helv", color=(0.1, 0.15, 0.3))
    page.insert_text((margin, margin + 35), f"Title: {title}", fontsize=11, fontname="helv", color=(0.15, 0.15, 0.15))
    page.insert_text((margin, margin + 50), f"Date: {date_str}  |  Platform: Google Meet  |  Generated by Lucid Coach", fontsize=9, fontname="helv", color=(0.4, 0.4, 0.4))

    participants_str = ", ".join(participants) if participants else "Recorded Participants"
    page.insert_text((margin, margin + 65), f"Participants: {participants_str}", fontsize=9, fontname="helv", color=(0.2, 0.4, 0.6))

    # Divider line
    shape = page.new_shape()
    shape.draw_line(fitz.Point(margin, margin + 75), fitz.Point(page_width - margin, margin + 75))
    shape.finish(color=(0.8, 0.8, 0.8), width=1)
    shape.commit()

    y = margin + 95

    # Helper function to print wrapped lines
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
            # Approximation: ~5.3 pt width per char for 9.5pt Helvetica
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

    # Section 1: Dialogue Flow
    _print_wrapped_text("Meeting Transcript & Dialogue Flow", fontsize=11, is_bold=True, color=(0.1, 0.15, 0.3))
    y += 4

    if dialogue_turns:
        for turn in dialogue_turns:
            spk = turn.get("speaker", "Speaker")
            ts = turn.get("timestamp", "00:00")
            speech = turn.get("text", "")

            # Speaker turn header
            _print_wrapped_text(f"[{ts}] {spk}:", fontsize=9.5, is_bold=True, color=(0.15, 0.3, 0.6))
            _print_wrapped_text(speech, fontsize=9.0, is_bold=False, color=(0.1, 0.1, 0.1))
            y += 4
    elif raw_content:
        # Fallback to formatting raw text lines
        for raw_line in raw_content.split("\n"):
            r_clean = raw_line.strip()
            if r_clean:
                _print_wrapped_text(r_clean, fontsize=9.0, is_bold=False)
            else:
                y += line_height // 2

    # Section 2: Appendix - In-Meeting Chat Messages (if present)
    if chat_log and chat_log.strip():
        y += 10
        if y > max_y - 80:
            page = doc.new_page(width=page_width, height=page_height)
            y = margin + 20

        # Appendix Divider
        shape = page.new_shape()
        shape.draw_line(fitz.Point(margin, y), fitz.Point(page_width - margin, y))
        shape.finish(color=(0.85, 0.85, 0.85), width=1)
        shape.commit()
        y += 15

        _print_wrapped_text("Appendix: In-Meeting Chat Messages", fontsize=11, is_bold=True, color=(0.1, 0.15, 0.3))
        y += 4

        for chat_line in chat_log.strip().split("\n"):
            c_line = chat_line.strip()
            if c_line:
                _print_wrapped_text(c_line, fontsize=8.5, is_bold=False, color=(0.3, 0.3, 0.3))

    return doc.tobytes()
