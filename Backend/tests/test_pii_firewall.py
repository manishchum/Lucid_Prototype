# Backend/tests/test_pii_firewall.py
"""
Unit Tests for Dual-Layer PII Redaction & Classification Firewall.
Covers:
- Layer 1 pre-embedding scrubbing (Luhn cards vs non-Luhn IDs, SSN, PAN, Aadhaar, IBAN, secrets/keys)
- Automated sensitivity tier classification ('internal', 'manager_restricted', 'hr_confidential')
- Layer 2 query-time SQL column filtering & JSONB row masking by role level
- Layer 2 RAG chunk masking & Final Output Firewall
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from security.pii_firewall import (
    scrub_hard_pii,
    scrub_ingestion_payload,
    classify_column_sensitivity,
    filter_columns_for_role,
    mask_spreadsheet_rows_for_role,
    mask_rag_chunks_for_role,
    sanitize_final_response,
)


def test_layer1_scrubs_hard_pii_and_respects_luhn():
    # Luhn-valid Visa test number 4111111111111111 vs invalid 16-digit tracking code 1234567890123450
    sample = (
        "Card: 4111-1111-1111-1111, Tracking: 1234567890123450, "
        "SSN: 123-45-6789, PAN: ABCDE1234F, Aadhaar: 2345 6789 0123, "
        "AWS: AKIAIOSFODNN7EXAMPLE, secret_key='supersecretvalue99'."
    )
    cleaned, counts = scrub_hard_pii(sample)

    assert "4111-1111-1111-1111" not in cleaned
    assert "[REDACTED_CARD]" in cleaned
    # Non-Luhn 16-digit order/tracking ID should NOT be falsely stripped as credit card
    assert "1234567890123450" in cleaned

    assert "123-45-6789" not in cleaned and "[REDACTED_SSN]" in cleaned
    assert "ABCDE1234F" not in cleaned and "[REDACTED_PAN]" in cleaned
    assert "2345 6789 0123" not in cleaned and "[REDACTED_AADHAAR]" in cleaned
    assert "AKIAIOSFODNN7EXAMPLE" not in cleaned and "[REDACTED_AWS_KEY]" in cleaned
    assert "supersecretvalue99" not in cleaned and "[REDACTED_SECRET]" in cleaned
    assert counts.get("CREDIT_CARD") == 1
    assert counts.get("US_SSN") == 1


def test_layer1_batch_scrubbing_and_sensitivity_classification():
    chunks = [
        {"content": "Weekly KPI summary: closed 18 deals.", "citation": {}},
        {"content": "Compensation review: base pay & equity bonus discussion, SSN 123-45-6789.", "citation": {}},
    ]
    rows = [
        {"employee_name": "Alice", "row_data": {"Cases": 50, "Salary": "120000", "Phone": "415-555-0199"}}
    ]
    s_chunks, s_rows, summary = scrub_ingestion_payload(chunks, rows, file_name="Q3_Comp_Review.xlsx")

    assert "[REDACTED_SSN]" in s_chunks[1]["content"]
    assert s_chunks[0]["sensitivity_tier"] in ("internal", "manager_restricted")
    assert s_chunks[1]["sensitivity_tier"] == "hr_confidential"
    assert s_rows[0]["sensitivity_tier"] == "hr_confidential"
    assert summary["document_sensitivity_tier"] == "hr_confidential"
    assert summary["column_tiers"]["Salary"] == "hr_confidential"
    assert summary["column_tiers"]["Phone"] == "manager_restricted"


def test_layer2_column_filtering_and_row_masking_by_role():
    cols = ["Employee Name", "Cases", "Phone", "Salary"]

    # Level 1 Employee cannot discover Salary or Phone columns in schema prompt
    assert filter_columns_for_role(cols, role_level=1) == ["Employee Name", "Cases"]
    # Level 2 Manager sees Phone & Cases, but not HR confidential Salary
    assert filter_columns_for_role(cols, role_level=2) == ["Employee Name", "Cases", "Phone"]
    # Level 3 Admin sees all columns
    assert filter_columns_for_role(cols, role_level=3) == cols

    rows = [
        {
            "employee_name": "Alice",
            "target_employee_id": "emp-alice",
            "row_data": {"Cases": 45, "Phone": "415-555-1234", "Salary": "140000"},
        },
        {
            "employee_name": "Bob",
            "target_employee_id": "emp-bob",
            "row_data": {"Cases": 30, "Phone": "415-555-5678", "Salary": "125000"},
        },
    ]

    # Alice (Level 1) querying: her own Phone is allowed, Bob's Phone is masked, and all Salary is masked
    masked_emp = mask_spreadsheet_rows_for_role(rows, caller_user_id="emp-alice", role_level=1)
    assert masked_emp[0]["row_data"]["Cases"] == 45
    assert masked_emp[0]["row_data"]["Phone"] == "415-555-1234"
    assert masked_emp[0]["row_data"]["Salary"] == "[MASKED_RESTRICTED]"
    assert masked_emp[1]["row_data"]["Phone"] == "[MASKED_RESTRICTED]"
    assert masked_emp[1]["row_data"]["Salary"] == "[MASKED_RESTRICTED]"

    # Manager (Level 2): Phone unmasked, Salary masked
    masked_mgr = mask_spreadsheet_rows_for_role(rows, caller_user_id="mgr-1", role_level=2)
    assert masked_mgr[1]["row_data"]["Phone"] == "415-555-5678"
    assert masked_mgr[1]["row_data"]["Salary"] == "[MASKED_RESTRICTED]"


def test_layer2_rag_chunk_masking_and_final_response_firewall():
    chunks = [
        {
            "content": "Reach out to self alice@lucid.work or bob@lucid.work at +1 415-555-0199. Key AKIAIOSFODNN7EXAMPLE.",
            "target_employee_id": "emp-bob",
        }
    ]
    masked = mask_rag_chunks_for_role(
        chunks,
        caller_user_id="emp-alice",
        caller_email="alice@lucid.work",
        role_level=1,
    )
    txt = masked[0]["content"]
    assert "alice@lucid.work" in txt
    assert "bob@lucid.work" not in txt and "[MASKED_EMAIL]" in txt
    assert "[MASKED_PHONE]" in txt
    assert "[REDACTED_AWS_KEY]" in txt

    final_out = sanitize_final_response("Call +1 650-555-9999 with SSN 123-45-6789", role_level=1)
    assert "[MASKED_PHONE]" in final_out
    assert "[REDACTED_SSN]" in final_out

