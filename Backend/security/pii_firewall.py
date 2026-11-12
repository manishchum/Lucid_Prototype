# Backend/security/pii_firewall.py
"""
Dual-Layer PII Redaction & Data Classification Firewall.

Layer 1 (Ingestion / Pre-Embedding):
  - Scrubs hard secrets & regulated PII (SSN, Credit Cards with Luhn check,
    PAN, Aadhaar, IBAN, API keys/JWTs, passwords) BEFORE text enters
    LLM summarizers, pgvector embeddings, or coach_spreadsheet_rows.
  - Classifies document & row sensitivity_tier:
      'public' | 'internal' | 'manager_restricted' | 'hr_confidential'

Layer 2 (Query-Time / SQL / Synthesis):
  - Filters restricted spreadsheet columns out of LLM SQL schema prompts.
  - Masks sensitive JSONB row fields & chunk snippets dynamically by caller role:
      - Admin/CEO/Developer (level >= 3): full access within authorized scope
      - Manager (level == 2): operational team metrics; HR-confidential masked
      - Employee (level == 1): self PII allowed where appropriate; peer/manager PII masked
  - Scans final synthesized LLM output to prevent indirect PII/secret leakage.
"""

import re
from typing import Dict, Any, List, Tuple, Optional, Set


# ============================================================================
# SENSITIVITY TIERS & ORDERING
# ============================================================================
SENSITIVITY_ORDER = {
    "public": 0,
    "internal": 1,
    "manager_restricted": 2,
    "hr_confidential": 3,
}

ROLE_ALLOWED_TIERS = {
    6: ["public", "internal", "manager_restricted", "hr_confidential"],  # DEVELOPER
    4: ["public", "internal", "manager_restricted", "hr_confidential"],  # SUPER_ADMIN / CEO
    3: ["public", "internal", "manager_restricted", "hr_confidential"],  # ADMIN / company_admin
    2: ["public", "internal", "manager_restricted"],                     # MANAGER
    1: ["public", "internal"],                                           # EMPLOYEE / USER
}


def allowed_tiers_for_role_level(role_level: int) -> List[str]:
    if role_level >= 3:
        return ROLE_ALLOWED_TIERS[3]
    if role_level == 2:
        return ROLE_ALLOWED_TIERS[2]
    return ROLE_ALLOWED_TIERS[1]


# ============================================================================
# LAYER 1: HARD PII & SECRET PATTERNS (SCRUBBED BEFORE STORAGE / EMBEDDING)
# ============================================================================
def _luhn_check(digits: str) -> bool:
    if not digits.isdigit() or not (13 <= len(digits) <= 19):
        return False
    total = 0
    reverse_digits = digits[::-1]
    for idx, ch in enumerate(reverse_digits):
        n = int(ch)
        if idx % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


# Hard secrets / regulated identifiers that should NEVER be embedded in vectors
_HARD_PII_PATTERNS: List[Tuple[str, re.Pattern, str]] = [
    ("API_KEY_OPENAI", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b"), "[REDACTED_API_KEY]"),
    ("API_KEY_GOOGLE", re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b"), "[REDACTED_API_KEY]"),
    ("AWS_ACCESS_KEY", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED_AWS_KEY]"),
    ("JWT_TOKEN", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"), "[REDACTED_TOKEN]"),
    ("US_SSN", re.compile(r"\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b"), "[REDACTED_SSN]"),
    ("IN_PAN", re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b"), "[REDACTED_PAN]"),
    ("IN_AADHAAR", re.compile(r"\b[2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}\b"), "[REDACTED_AADHAAR]"),
    ("IBAN", re.compile(r"\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b"), "[REDACTED_IBAN]"),
    ("SECRET_ASSIGNMENT", re.compile(r"(?i)\b(password|passcode|secret_key|private_key|client_secret)\s*[:=]\s*['\"]?([^\s'\",;]{6,})['\"]?"), "[REDACTED_SECRET]"),
]

_CARD_CANDIDATE_RE = re.compile(r"\b(?:\d[ -]*?){13,19}\b")

# Soft / workplace PII patterns (masked dynamically at query-time by role)
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\d)")

# Compensation / HR / Disciplinary keywords for automatic sensitivity classification
_HR_CONFIDENTIAL_KEYWORDS = {
    "salary", "ctc", "compensation", "base pay", "bonus", "equity", "stock option",
    "termination", "pip ", "performance improvement plan", "severance", "disciplinary",
    "medical leave", "background check", "ssn", "aadhaar", "pan card", "bank account",
    "routing number", "ifsc", "payroll", "tax id"
}

_MANAGER_RESTRICTED_KEYWORDS = {
    "1:1", "one-on-one", "calibration", "promotion nomination", "succession plan",
    "attrition risk", "flight risk", "manager note", "rating band", "appraisal score"
}

# Column names in spreadsheets requiring elevated clearance
_HR_CONFIDENTIAL_COLUMNS = {
    "salary", "ctc", "annual_salary", "monthly_salary", "base_pay", "compensation",
    "bonus", "variable_pay", "bank_account", "account_number", "ifsc", "routing_number",
    "ssn", "pan", "aadhaar", "tax_id", "dob", "date_of_birth", "home_address", "address"
}

_MANAGER_RESTRICTED_COLUMNS = {
    "phone", "mobile", "contact_number", "personal_email", "rating", "appraisal_rating",
    "calibration_score", "flight_risk", "pip_status", "manager_notes", "disciplinary_action"
}


def _normalize_col(col_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (col_name or "").strip().lower()).strip("_")


def classify_column_sensitivity(column_name: str) -> str:
    norm = _normalize_col(column_name)
    if not norm:
        return "internal"
    for kw in _HR_CONFIDENTIAL_COLUMNS:
        if kw in norm:
            return "hr_confidential"
    for kw in _MANAGER_RESTRICTED_COLUMNS:
        if kw in norm:
            return "manager_restricted"
    return "internal"


def scrub_hard_pii(text: str) -> Tuple[str, Dict[str, int]]:
    """
    Layer 1: Deterministically scrubs hard regulated PII and secrets from text.
    Returns (scrubbed_text, redaction_counts).
    """
    if not text or not isinstance(text, str):
        return text or "", {}

    counts: Dict[str, int] = {}
    cleaned = text

    # 1. Credit cards (Luhn-validated to avoid mangling sales/case numbers)
    def _replace_card(match: re.Match) -> str:
        raw = match.group(0)
        digits = re.sub(r"[^0-9]", "", raw)
        # Skip short strings or pure continuous IDs unless Luhn-valid and formatted or 15-16 digits
        if 15 <= len(digits) <= 16 and _luhn_check(digits):
            counts["CREDIT_CARD"] = counts.get("CREDIT_CARD", 0) + 1
            return "[REDACTED_CARD]"
        return raw

    cleaned = _CARD_CANDIDATE_RE.sub(_replace_card, cleaned)

    # 2. Hard PII & secret regexes
    for label, pattern, placeholder in _HARD_PII_PATTERNS:
        matches = pattern.findall(cleaned)
        if matches:
            counts[label] = counts.get(label, 0) + len(matches)
            cleaned = pattern.sub(placeholder, cleaned)

    return cleaned, counts


def classify_text_sensitivity(text: str, file_name: str = "") -> str:
    """Infers document/chunk sensitivity tier from content & filename."""
    haystack = f"{file_name}\n{text}".lower()
    if any(k in haystack for k in _HR_CONFIDENTIAL_KEYWORDS):
        return "hr_confidential"
    if any(k in haystack for k in _MANAGER_RESTRICTED_KEYWORDS):
        return "manager_restricted"
    return "internal"


def scrub_ingestion_payload(
    chunks: List[Dict[str, Any]],
    spreadsheet_rows: List[Dict[str, Any]],
    file_name: str = ""
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    """
    Layer 1 Pre-Embedding & Pre-Storage Firewall.
    Scrubs hard PII from chunks & spreadsheet rows and determines sensitivity_tier.
    """
    total_counts: Dict[str, int] = {}
    doc_max_tier = "internal"

    def _merge_counts(c: Dict[str, int]):
        for k, v in c.items():
            total_counts[k] = total_counts.get(k, 0) + v

    def _bump_tier(current: str, candidate: str) -> str:
        return candidate if SENSITIVITY_ORDER.get(candidate, 1) > SENSITIVITY_ORDER.get(current, 1) else current

    # 1. Scrub chunks
    scrubbed_chunks: List[Dict[str, Any]] = []
    for ch in chunks:
        ch_copy = dict(ch)
        raw_content = ch_copy.get("content", "")
        clean_content, counts = scrub_hard_pii(raw_content)
        _merge_counts(counts)
        ch_copy["content"] = clean_content

        chunk_tier = classify_text_sensitivity(clean_content, file_name=file_name)
        if counts:
            # If hard regulated PII was found and scrubbed, elevate at least to manager_restricted
            chunk_tier = _bump_tier(chunk_tier, "manager_restricted")
        ch_copy["sensitivity_tier"] = chunk_tier
        doc_max_tier = _bump_tier(doc_max_tier, chunk_tier)
        scrubbed_chunks.append(ch_copy)

    # 2. Scrub spreadsheet rows & classify column sensitivity
    scrubbed_rows: List[Dict[str, Any]] = []
    detected_col_tiers: Dict[str, str] = {}
    for row in spreadsheet_rows:
        row_copy = dict(row)
        raw_data = row_copy.get("row_data") or {}
        clean_data: Dict[str, Any] = {}
        row_tier = "internal"
        for col_k, col_v in raw_data.items():
            col_tier = classify_column_sensitivity(str(col_k))
            detected_col_tiers[str(col_k)] = col_tier
            row_tier = _bump_tier(row_tier, col_tier)

            if isinstance(col_v, str):
                clean_v, counts = scrub_hard_pii(col_v)
                _merge_counts(counts)
                clean_data[col_k] = clean_v
            else:
                clean_data[col_k] = col_v

        row_copy["row_data"] = clean_data
        row_copy["sensitivity_tier"] = row_tier
        doc_max_tier = _bump_tier(doc_max_tier, row_tier)
        scrubbed_rows.append(row_copy)

    pii_summary = {
        "layer1_redactions": total_counts,
        "document_sensitivity_tier": doc_max_tier,
        "column_tiers": detected_col_tiers,
    }
    return scrubbed_chunks, scrubbed_rows, pii_summary


# ============================================================================
# LAYER 2: QUERY-TIME ROLE-AWARE MASKING & OUTPUT FIREWALL
# ============================================================================
def filter_columns_for_role(columns: List[str], role_level: int) -> List[str]:
    """
    Removes columns from SQL schema introspection & sample rows if the caller's
    role_level is below the column's required clearance.
    """
    allowed = set(allowed_tiers_for_role_level(role_level))
    return [c for c in columns if classify_column_sensitivity(c) in allowed]


def mask_spreadsheet_rows_for_role(
    rows: List[Dict[str, Any]],
    caller_user_id: str,
    role_level: int
) -> List[Dict[str, Any]]:
    """
    Dynamically masks restricted fields in SQL results based on caller role_level
    and whether the row belongs to the caller themselves.
    """
    if role_level >= 3:
        return rows  # Admin+ sees authorized rows unmasked (hard PII already scrubbed at Layer 1)

    allowed_tiers = set(allowed_tiers_for_role_level(role_level))
    masked_rows: List[Dict[str, Any]] = []

    for row in rows:
        r = dict(row)
        target_emp = str(r.get("target_employee_id") or "")
        is_self = bool(target_emp and caller_user_id and target_emp == str(caller_user_id))

        # Check top-level keys (from SELECT row_data->>'Salary' AS salary, etc.)
        cleaned_row: Dict[str, Any] = {}
        for k, v in r.items():
            if k == "row_data" and isinstance(v, dict):
                cleaned_rd: Dict[str, Any] = {}
                for rk, rv in v.items():
                    tier = classify_column_sensitivity(str(rk))
                    if tier in allowed_tiers or (is_self and tier != "hr_confidential"):
                        cleaned_rd[rk] = rv
                    else:
                        cleaned_rd[rk] = "[MASKED_RESTRICTED]"
                cleaned_row["row_data"] = cleaned_rd
            else:
                tier = classify_column_sensitivity(str(k))
                if tier in allowed_tiers or (is_self and tier != "hr_confidential"):
                    cleaned_row[k] = v
                else:
                    cleaned_row[k] = "[MASKED_RESTRICTED]"
        masked_rows.append(cleaned_row)

    return masked_rows


def mask_rag_chunks_for_role(
    chunks: List[Dict[str, Any]],
    caller_user_id: str,
    caller_email: Optional[str],
    role_level: int
) -> List[Dict[str, Any]]:
    """
    Layer 2 Context Masking for RAG chunks before sending to LLM synthesis.
    Masks peer/manager phone numbers & personal emails for role_level < 2 (employees).
    """
    if role_level >= 3:
        return chunks

    caller_email_lower = (caller_email or "").strip().lower()
    masked_chunks: List[Dict[str, Any]] = []

    for ch in chunks:
        c = dict(ch)
        content = c.get("content", "")
        # Run Layer 1 defense-in-depth on legacy un-scrubbed chunks
        content, _ = scrub_hard_pii(content)

        target_emp = str(c.get("target_employee_id") or "")
        is_self_doc = bool(target_emp and caller_user_id and target_emp == str(caller_user_id))

        # For employees querying non-self docs (e.g., team-shared docs), mask phone numbers and other people's emails
        if role_level < 2 and not is_self_doc:
            content = _PHONE_RE.sub("[MASKED_PHONE]", content)

            def _mask_other_email(m: re.Match) -> str:
                found = m.group(0)
                if caller_email_lower and found.lower() == caller_email_lower:
                    return found
                return "[MASKED_EMAIL]"

            content = _EMAIL_RE.sub(_mask_other_email, content)

        c["content"] = content
        masked_chunks.append(c)

    return masked_chunks


def sanitize_final_response(text: str, role_level: int) -> str:
    """
    Final Output Firewall before SSE/JSON delivery.
    Ensures zero hard PII / secrets or unauthorized phone leaks appear in LLM output.
    """
    if not text:
        return text
    cleaned, _ = scrub_hard_pii(text)
    if role_level < 2:
        cleaned = _PHONE_RE.sub("[MASKED_PHONE]", cleaned)
    return cleaned

