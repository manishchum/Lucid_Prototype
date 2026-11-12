# Backend/ingestion/coach_store.py
"""
Supabase Database Store for Performance Coach manual uploads, vector chunks, and spreadsheet rows.
"""

from typing import List, Dict, Any, Optional
import uuid
import numpy as np
from utils.supabase_client import supabase_admin
from security.rebac import is_missing_schema_error

supabase = supabase_admin


def fetch_company_employees(company_id: str) -> List[Dict[str, Any]]:
    """Fetch employee user_id, name, and email for entity resolution."""
    try:
        res = (
            supabase.table("users")
            .select("user_id, name, email")
            .eq("company_id", company_id)
            .execute()
        )
        return getattr(res, "data", None) or []
    except Exception as e:
        print(f"[COACH STORE] Warning: Could not fetch company employees: {e}")
        return []


def create_document_record(
    company_id: str,
    uploaded_by: str,
    file_name: str,
    file_type: str,
    file_size_bytes: int,
    storage_path: str,
    file_hash: Optional[str] = None,
    target_employee_id: Optional[str] = None,
    manual_description: Optional[str] = None,
    source_integration_id: Optional[str] = None,
    source_container_id: Optional[str] = None,
    author_user_id: Optional[str] = None,
    is_private_manager_note: bool = False,
    sensitivity_tier: str = "internal"
) -> Dict[str, Any]:
    """Register a new uploaded document in pending state."""
    eff_author = author_user_id or uploaded_by
    initial_acl = [f"role:{company_id}:admin_plus"]
    if eff_author:
        initial_acl.append(f"user:{eff_author}")
    if target_employee_id and not is_private_manager_note:
        initial_acl.append(f"scoped_emp:{target_employee_id}")

    row = {
        "company_id": company_id,
        "uploaded_by": uploaded_by,
        "author_user_id": eff_author,
        "file_name": file_name,
        "file_type": file_type.lower().replace(".", ""),
        "file_size_bytes": file_size_bytes,
        "storage_path": storage_path,
        "file_hash": file_hash,
        "target_employee_id": target_employee_id,
        "manual_description": manual_description,
        "source_integration_id": source_integration_id,
        "source_container_id": source_container_id,
        "is_private_manager_note": is_private_manager_note,
        "sensitivity_tier": sensitivity_tier,
        "acl_principals": sorted(set(initial_acl)),
        "deny_principals": [],
        "status": "pending",
        "parsed_metadata": {}
    }
    try:
        res = supabase.table("coach_uploaded_documents").insert(row).execute()
    except Exception as col_err:
        if not is_missing_schema_error(col_err):
            raise
        for new_col in (
            "author_user_id",
            "source_integration_id",
            "source_container_id",
            "is_private_manager_note",
            "sensitivity_tier",
            "acl_principals",
            "deny_principals",
        ):
            row.pop(new_col, None)
        res = supabase.table("coach_uploaded_documents").insert(row).execute()
    data = getattr(res, "data", None) if res else None
    if not data:
        raise RuntimeError("Failed to create coach_uploaded_documents record.")
    return data[0]


def update_document_status(
    document_id: str,
    status: str,
    description: Optional[str] = None,
    document_period: Optional[str] = None,
    parsed_metadata: Optional[Dict[str, Any]] = None,
    error_message: Optional[str] = None,
    sensitivity_tier: Optional[str] = None,
    pii_summary: Optional[Dict[str, Any]] = None
):
    """Update ingestion status of a coach document."""
    payload: Dict[str, Any] = {"status": status}
    if description is not None:
        payload["description"] = description
    if document_period is not None:
        payload["document_period"] = document_period
    if parsed_metadata is not None:
        payload["parsed_metadata"] = parsed_metadata
    if error_message is not None:
        payload["error_message"] = error_message
    if sensitivity_tier is not None:
        payload["sensitivity_tier"] = sensitivity_tier
    if pii_summary is not None:
        payload["pii_summary"] = pii_summary

    try:
        supabase.table("coach_uploaded_documents").update(payload).eq("id", document_id).execute()
    except Exception as col_err:
        if not is_missing_schema_error(col_err):
            raise
        payload.pop("sensitivity_tier", None)
        payload.pop("pii_summary", None)
        if payload:
            supabase.table("coach_uploaded_documents").update(payload).eq("id", document_id).execute()


def insert_coach_chunks(
    document_id: str,
    company_id: str,
    chunks: List[Dict[str, Any]],
    embeddings: np.ndarray,
    batch_size: int = 150,
    default_acl_principals: Optional[List[str]] = None,
    default_deny_principals: Optional[List[str]] = None
) -> int:
    """
    Inserts vector chunks with citations and pre-retrieval ACL metadata into coach_document_chunks.
    """
    total_chunks = len(chunks)
    if total_chunks == 0:
        return 0

    acl_base = default_acl_principals or [f"role:{company_id}:admin_plus"]
    deny_base = default_deny_principals or []

    rows = []
    for idx, (chunk_item, emb) in enumerate(zip(chunks, embeddings)):
        chunk_acl = list(acl_base)
        if chunk_item.get("target_employee_id"):
            t_emp = str(chunk_item["target_employee_id"])
            if f"scoped_emp:{t_emp}" not in chunk_acl:
                chunk_acl.append(f"scoped_emp:{t_emp}")
        rows.append({
            "document_id": document_id,
            "company_id": company_id,
            "target_employee_id": chunk_item.get("target_employee_id"),
            "chunk_index": idx,
            "chunk_type": chunk_item.get("chunk_type", "text"),
            "content": chunk_item.get("content", ""),
            "embedding": emb.tolist(),
            "citation": chunk_item.get("citation", {}),
            "sensitivity_tier": chunk_item.get("sensitivity_tier", "internal"),
            "acl_principals": sorted(set(chunk_acl)),
            "deny_principals": deny_base,
        })

    # Batch insert to avoid exceeding payload limits
    inserted_count = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        try:
            res = supabase.table("coach_document_chunks").insert(batch).execute()
        except Exception as col_err:
            if not is_missing_schema_error(col_err):
                raise
            legacy_batch = [
                {k: v for k, v in item.items() if k not in ("sensitivity_tier", "acl_principals", "deny_principals")}
                for item in batch
            ]
            res = supabase.table("coach_document_chunks").insert(legacy_batch).execute()
        data = getattr(res, "data", None) if res else None
        if data:
            inserted_count += len(data)

    return inserted_count


def insert_spreadsheet_rows(
    document_id: str,
    company_id: str,
    spreadsheet_rows: List[Dict[str, Any]],
    batch_size: int = 500,
    default_acl_principals: Optional[List[str]] = None,
    default_deny_principals: Optional[List[str]] = None
) -> int:
    """
    Inserts raw structured spreadsheet rows into coach_spreadsheet_rows for exact math/filtering.
    """
    if not spreadsheet_rows:
        return 0

    acl_base = default_acl_principals or [f"role:{company_id}:admin_plus"]
    deny_base = default_deny_principals or []

    rows_to_insert = []
    for row in spreadsheet_rows:
        t_emp = row.get("target_employee_id")
        if t_emp:
            row_acl = sorted({
                p for p in acl_base
                if not p.startswith("scoped_emp:") and not p.startswith("team:") and not p.startswith("company:")
            } | {f"scoped_emp:{t_emp}"})
        else:
            row_acl = sorted(set(acl_base))

        rows_to_insert.append({
            "document_id": document_id,
            "company_id": company_id,
            "sheet_name": row.get("sheet_name", "Sheet1"),
            "row_index": row.get("row_index", 0),
            "target_employee_id": t_emp,
            "employee_name": row.get("employee_name"),
            "row_data": row.get("row_data", {}),
            "sensitivity_tier": row.get("sensitivity_tier", "internal"),
            "acl_principals": row_acl,
            "deny_principals": deny_base,
        })

    inserted_count = 0
    for i in range(0, len(rows_to_insert), batch_size):
        batch = rows_to_insert[i:i + batch_size]
        try:
            res = supabase.table("coach_spreadsheet_rows").insert(batch).execute()
        except Exception as col_err:
            if not is_missing_schema_error(col_err):
                raise
            legacy_batch = [
                {k: v for k, v in item.items() if k not in ("sensitivity_tier", "acl_principals", "deny_principals")}
                for item in batch
            ]
            res = supabase.table("coach_spreadsheet_rows").insert(legacy_batch).execute()
        data = getattr(res, "data", None) if res else None
        if data:
            inserted_count += len(data)

    return inserted_count
