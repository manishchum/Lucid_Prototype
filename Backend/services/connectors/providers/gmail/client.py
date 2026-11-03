# Backend/services/connectors/providers/gmail/client.py
"""
Resilient Gmail API Client with Sensitive Data Guardrails,
DLP PII Redaction, Thread Synthesis, and PyMuPDF Digest Generation.
"""

import os
import re
import base64
import html
import email.utils
from datetime import datetime, timezone
from typing import Tuple, Dict, Any, List, Optional
import fitz  # PyMuPDF

from services.connectors.providers.google_drive.client import (
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    execute_google_api_call
)

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
]

# Standard curated Coaching & Performance allowed keywords
DEFAULT_ALLOWED_KEYWORDS = [
    "1-on-1",
    "1:1",
    "coaching",
    "feedback",
    "performance",
    "review",
    "kpi",
    "kpis",
    "goals",
    "milestones",
    "check-in"
]

# Standard noise and non-coaching negative keywords
DEFAULT_EXCLUDED_KEYWORDS = [
    "invoice",
    "receipt",
    "billing",
    "statement",
    "payroll",
    "salary slip",
    "compensation",
    "password reset",
    "verification code",
    "otp",
    "ticket",
    "newsletter",
    "unsubscribe"
]

# Generic public webmail domains (do not enforce domain restriction on personal accounts)
GENERIC_DOMAINS = {
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "icloud.com",
    "aol.com",
    "mail.com"
}

# ============================================================================
# 1. DLP & SENSITIVE DATA REDACTION ENGINE
# ============================================================================

DLP_PATTERNS = [
    # Credit Card Numbers (Visa, MasterCard, Amex, Discover)
    (
        re.compile(r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|6(?:011|5[0-9]{2})[0-9]{12}|3[47][0-9]{13})\b"),
        "[REDACTED_CREDIT_CARD]"
    ),
    # US Social Security Numbers
    (
        re.compile(r"\b\d{3}[-\s]\d{2}[-\s]\d{4}\b"),
        "[REDACTED_SSN]"
    ),
    # Indian Permanent Account Number (PAN)
    (
        re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b"),
        "[REDACTED_PAN_ID]"
    ),
    # Indian Aadhaar Numbers
    (
        re.compile(r"\b\d{4}[-\s]\d{4}[-\s]\d{4}\b"),
        "[REDACTED_AADHAAR_ID]"
    ),
    # Bearer tokens & OAuth credentials
    (
        re.compile(r"\bBearer\s+[A-Za-z0-9_\-\.]{20,}\b"),
        "Bearer [REDACTED_TOKEN]"
    ),
    # API Keys (OpenAI, Stripe, Google, GitHub, etc.)
    (
        re.compile(r"\b(?:sk|pk|AIza|ghp|gho|xoxb|xoxp)_[a-zA-Z0-9_\-]{20,}\b"),
        "[REDACTED_API_KEY]"
    ),
    # Passwords or secrets in plaintext
    (
        re.compile(r"(?i)\b(?:password|passwd|pwd|client_secret)\s*[:=]\s*[^\s,;]{4,}"),
        "password: [REDACTED_CREDENTIAL]"
    ),
    # Bank Account / IBAN Numbers
    (
        re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{12,30}\b"),
        "[REDACTED_IBAN]"
    ),
    (
        re.compile(r"(?i)\b(?:bank\s*account|account\s*number|acct\s*#|routing\s*#)\s*[:=]?\s*\d{8,17}\b"),
        "[REDACTED_BANK_ACCOUNT]"
    )
]

CONFIDENTIAL_TAGS = [
    "[confidential]",
    "[private]",
    "[restricted]",
    "[privileged]",
    "[strictly confidential]",
    "[nda]",
    "[do not forward]"
]


def redact_sensitive_data(text: str) -> str:
    """Scans and masks PII, financial info, and credentials from email content."""
    if not text:
        return ""
    result = text
    for pattern, replacement in DLP_PATTERNS:
        result = pattern.sub(replacement, result)
    return result


def is_confidential_email(headers: Dict[str, str], subject: str) -> Tuple[bool, str]:
    """
    Checks if an email is marked confidential via RFC 822 sensitivity headers,
    Gmail Confidential Mode, or confidential subject tags.
    """
    sensitivity = (headers.get("sensitivity") or "").strip().lower()
    if sensitivity in ("company-confidential", "private", "personal"):
        return True, f"Sensitivity header: {sensitivity}"

    if headers.get("x-gmail-confidential") or headers.get("x-confidential"):
        return True, "Gmail Confidential Mode detected"

    subject_lower = subject.lower()
    for tag in CONFIDENTIAL_TAGS:
        if tag in subject_lower:
            return True, f"Subject confidentiality tag: {tag}"

    return False, ""


def extract_email_domain(email_str: str) -> Optional[str]:
    """Extracts domain from email address (e.g. user@workfloww.ai -> workfloww.ai)."""
    if not email_str:
        return None
    _, addr = email.utils.parseaddr(email_str)
    if "@" in addr:
        return addr.split("@")[-1].strip().lower()
    return None


def build_gmail_search_query(
    domain: Optional[str] = None,
    allowed_keywords: Optional[List[str]] = None,
    excluded_keywords: Optional[List[str]] = None
) -> str:
    """
    Dynamically constructs a high-efficiency Gmail search query (`q` parameter).
    Enforces corporate domain scoping, allowed coaching keywords, and noise exclusion.
    """
    q_parts = []

    # 1. Base noise exclusions (bots, automated mailers, notifications)
    q_parts.append("-from:no-reply -from:noreply -from:donotreply -from:notifications@ -from:security@ -from:mailer-daemon@")

    # 2. Negative keyword exclusions
    excluded = excluded_keywords if excluded_keywords is not None else DEFAULT_EXCLUDED_KEYWORDS
    for neg in excluded:
        clean_neg = neg.strip().lower()
        if clean_neg:
            q_parts.append(f'-"{clean_neg}"')

    # 3. Dynamic corporate domain restriction
    if domain and domain.lower() not in GENERIC_DOMAINS:
        # Require that either sender or recipient belongs to the company domain
        q_parts.append(f"(from:*{domain} OR to:*{domain})")

    # 4. Configurable Allowed Keywords
    allowed = allowed_keywords if allowed_keywords is not None else DEFAULT_ALLOWED_KEYWORDS
    if allowed:
        kw_clauses = []
        for kw in allowed:
            clean_kw = kw.strip()
            if clean_kw:
                if " " in clean_kw or "-" in clean_kw or ":" in clean_kw:
                    kw_clauses.append(f'"{clean_kw}"')
                else:
                    kw_clauses.append(clean_kw)
        if kw_clauses:
            q_parts.append(f"({' OR '.join(kw_clauses)})")

    return " ".join(q_parts)


def get_gmail_credentials() -> Tuple[str, str, str, str]:
    """Reads Gmail OAuth credentials from environment."""
    client_id = (os.getenv("GMAIL_CLIENT_ID") or os.getenv("GOOGLE_DRIVE_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("GMAIL_CLIENT_SECRET") or os.getenv("GOOGLE_DRIVE_CLIENT_SECRET") or "").strip()
    redirect_uri = (os.getenv("GMAIL_REDIRECT_URI") or os.getenv("GOOGLE_DRIVE_REDIRECT_URI") or "").strip()
    webhook_url = (os.getenv("GMAIL_WEBHOOK_URL") or os.getenv("GOOGLE_DRIVE_WEBHOOK_URL") or "").strip()

    if not client_id or not client_secret:
        raise ValueError("GMAIL_CLIENT_ID or GOOGLE_DRIVE_CLIENT_ID missing in environment.")

    return client_id, client_secret, redirect_uri, webhook_url


# ============================================================================
# 2. MIME BODY EXTRACTION & CLEANING
# ============================================================================

def _clean_html_to_text(raw_html: str) -> str:
    """Strips script, style, and HTML tags, returning normalized readable text."""
    # Remove script and style elements
    text = re.sub(r"<(script|style).*?</\1>", "", raw_html, flags=re.DOTALL | re.IGNORECASE)
    # Convert <br>, <p>, <div> to newlines
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</?(?:p|div|tr|li)[^>]*>", "\n", text)
    # Strip remaining HTML tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Unescape HTML entities (&amp;, &lt;, etc.)
    text = html.unescape(text)
    # Normalize whitespaces
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_email_body_from_payload(payload: Dict[str, Any]) -> str:
    """
    Recursively traverses Gmail MIME payload parts to extract clean text body.
    Prioritizes text/plain; falls back to sanitized text/html.
    """
    plain_texts: List[str] = []
    html_texts: List[str] = []

    def _walk_parts(part: Dict[str, Any]):
        mime = part.get("mimeType", "").lower()
        body_data = (part.get("body") or {}).get("data")

        if body_data and mime == "text/plain":
            try:
                decoded = base64.urlsafe_b64decode(body_data.encode("utf-8")).decode("utf-8", errors="replace")
                plain_texts.append(decoded)
            except Exception:
                pass
        elif body_data and mime == "text/html":
            try:
                decoded = base64.urlsafe_b64decode(body_data.encode("utf-8")).decode("utf-8", errors="replace")
                html_texts.append(decoded)
            except Exception:
                pass

        for sub_part in part.get("parts") or []:
            _walk_parts(sub_part)

    _walk_parts(payload)

    if plain_texts:
        raw_content = "\n\n".join(plain_texts)
    elif html_texts:
        raw_content = _clean_html_to_text("\n\n".join(html_texts))
    else:
        # Fallback to direct body if present
        body_data = (payload.get("body") or {}).get("data")
        if body_data:
            try:
                raw_content = base64.urlsafe_b64decode(body_data.encode("utf-8")).decode("utf-8", errors="replace")
            except Exception:
                raw_content = ""
        else:
            raw_content = ""

    # Strip noisy disclaimer boilerplate and tracking footers
    cleaned_lines = []
    for line in raw_content.split("\n"):
        line_clean = line.strip()
        # Drop unsubscribe links and email tracker noise
        if re.search(r"(?i)^(?:click here to unsubscribe|to unsubscribe from this list|view in browser)", line_clean):
            continue
        cleaned_lines.append(line)

    return "\n".join(cleaned_lines).strip()


# ============================================================================
# 3. PYMUPDF THREAD DIGEST GENERATOR
# ============================================================================

def build_synthesized_email_thread_pdf(
    subject: str,
    date_str: str,
    participants: List[str],
    messages: List[Dict[str, Any]]
) -> bytes:
    """
    Generates a publication-grade A4 PDF digest of an email thread using PyMuPDF.
    Includes:
    - Thread Header (Subject, Date, Senders/Recipients, Platform: Gmail)
    - Chronological Message Entries with DLP-redacted body text
    - Listed attachments
    """
    doc = fitz.open()
    margin = 54
    page_width, page_height = 595, 842  # Standard A4
    line_height = 14
    max_y = page_height - margin

    page = doc.new_page(width=page_width, height=page_height)

    # Title Banner
    page.insert_text((margin, margin + 15), "Gmail Thread Coaching Digest", fontsize=15, fontname="hebo", color=(0.1, 0.15, 0.3))
    page.insert_text((margin, margin + 35), f"Subject: {subject}", fontsize=11, fontname="hebo", color=(0.15, 0.15, 0.15))
    page.insert_text((margin, margin + 50), f"Date: {date_str}  |  Platform: Gmail  |  Messages: {len(messages)}", fontsize=9, fontname="helv", color=(0.4, 0.4, 0.4))

    participants_str = ", ".join(participants[:5]) if participants else "Internal Team"
    if len(participants) > 5:
        participants_str += f" (+{len(participants) - 5} more)"
    page.insert_text((margin, margin + 65), f"Participants: {participants_str}", fontsize=9, fontname="helv", color=(0.2, 0.4, 0.6))

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

    # Render each message in thread chronologically
    for idx, msg in enumerate(messages, 1):
        sender = msg.get("from", "Unknown Sender")
        msg_date = msg.get("date", "")
        body_text = redact_sensitive_data(msg.get("body", ""))
        attachments = msg.get("attachments", [])

        # Sub-header for message
        if y > max_y - 60:
            page = doc.new_page(width=page_width, height=page_height)
            y = margin + 20

        _print_wrapped_text(f"Message #{idx}  |  From: {sender}  |  {msg_date}", fontsize=10, is_bold=True, color=(0.15, 0.3, 0.6))
        y += 2

        # Message body
        for para in body_text.split("\n"):
            p_clean = para.strip()
            if p_clean:
                _print_wrapped_text(p_clean, fontsize=9.0, is_bold=False)
            else:
                y += line_height // 2

        # Listed attachments
        if attachments:
            y += 4
            _print_wrapped_text(f"📎 Attached Files: {', '.join(attachments)}", fontsize=8.5, is_bold=True, color=(0.4, 0.4, 0.4))

        y += 10
        # Light separator line between messages
        if idx < len(messages):
            if y > max_y - 20:
                page = doc.new_page(width=page_width, height=page_height)
                y = margin + 20
            sep_shape = page.new_shape()
            sep_shape.draw_line(fitz.Point(margin, y), fitz.Point(page_width - margin, y))
            sep_shape.finish(color=(0.9, 0.9, 0.9), width=0.5)
            sep_shape.commit()
            y += 12

    return doc.tobytes()


# ============================================================================
# 4. PARTICIPANT-TO-EMPLOYEE RESOLUTION
# ============================================================================

def match_email_participants_to_employee(
    participants: List[str],
    company_employees: List[Dict[str, Any]],
    host_email: Optional[str] = None
) -> Optional[str]:
    """
    Matches thread participants against company employee roster in Supabase.
    Excludes the host (the user who connected their account) to identify the coachee.
    """
    if not participants or not company_employees:
        return None

    host_clean = host_email.lower().strip() if host_email else ""

    # Collect parsed addresses from participants
    participant_emails = set()
    participant_names = set()

    for p in participants:
        name, addr = email.utils.parseaddr(p)
        if addr:
            participant_emails.add(addr.lower().strip())
        if name:
            participant_names.add(name.lower().strip())
        else:
            # Fallback raw string if no address bracket
            participant_emails.add(p.lower().strip())

    # Exclude host
    participant_emails.discard(host_clean)

    # First pass: direct email match on non-host
    for emp in company_employees:
        emp_email = (emp.get("email") or "").lower().strip()
        emp_id = emp.get("user_id")
        if emp_id and emp_email and emp_email in participant_emails:
            return emp_id

    # Second pass: name match on non-host
    for emp in company_employees:
        emp_name = (emp.get("name") or "").lower().strip()
        emp_id = emp.get("user_id")
        if emp_id and emp_name and emp_name in participant_names:
            return emp_id

    return None
