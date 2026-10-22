# Backend/ingestion/coach_store.py
"""
Supabase Database Store for Performance Coach manual uploads, vector chunks, and spreadsheet rows.
"""

from typing import List, Dict, Any, Optional
import uuid
import numpy as np
from utils.supabase_client import supabase_admin

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
        return res.data or []
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
    manual_description: Optional[str] = None
) -> Dict[str, Any]:
    """Register a new uploaded document in pending state."""
    row = {
        "company_id": company_id,
        "uploaded_by": uploaded_by,
        "file_name": file_name,
        "file_type": file_type.lower().replace(".", ""),
        "file_size_bytes": file_size_bytes,
        "storage_path": storage_path,
        "file_hash": file_hash,
        "target_employee_id": target_employee_id,
        "manual_description": manual_description,
        "status": "pending",
        "parsed_metadata": {}
    }
    res = supabase.table("coach_uploaded_documents").insert(row).execute()
    if not res.data:
        raise RuntimeError("Failed to create coach_uploaded_documents record.")
    return res.data[0]


def update_document_status(
    document_id: str,
    status: str,
    description: Optional[str] = None,
    document_period: Optional[str] = None,
    parsed_metadata: Optional[Dict[str, Any]] = None,
    error_message: Optional[str] = None
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
        
    supabase.table("coach_uploaded_documents").update(payload).eq("id", document_id).execute()


def insert_coach_chunks(
    document_id: str,
    company_id: str,
    chunks: List[Dict[str, Any]],
    embeddings: np.ndarray,
    batch_size: int = 50
) -> int:
    """
    Inserts vector chunks with citations into coach_document_chunks table in batches.
    """
    total_chunks = len(chunks)
    if total_chunks == 0:
        return 0

    rows = []
    for idx, (chunk_item, emb) in enumerate(zip(chunks, embeddings)):
        rows.append({
            "document_id": document_id,
            "company_id": company_id,
            "target_employee_id": chunk_item.get("target_employee_id"),
            "chunk_index": idx,
            "chunk_type": chunk_item.get("chunk_type", "text"),
            "content": chunk_item.get("content", ""),
            "embedding": emb.tolist(),
            "citation": chunk_item.get("citation", {})
        })

    # Batch insert to avoid exceeding payload limits
    inserted_count = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        res = supabase.table("coach_document_chunks").insert(batch).execute()
        if res.data:
            inserted_count += len(res.data)

    return inserted_count


def insert_spreadsheet_rows(
    document_id: str,
    company_id: str,
    spreadsheet_rows: List[Dict[str, Any]],
    batch_size: int = 100
) -> int:
    """
    Inserts raw structured spreadsheet rows into coach_spreadsheet_rows for exact math/filtering.
    """
    if not spreadsheet_rows:
        return 0

    rows_to_insert = []
    for row in spreadsheet_rows:
        rows_to_insert.append({
            "document_id": document_id,
            "company_id": company_id,
            "sheet_name": row.get("sheet_name", "Sheet1"),
            "row_index": row.get("row_index", 0),
            "target_employee_id": row.get("target_employee_id"),
            "employee_name": row.get("employee_name"),
            "row_data": row.get("row_data", {})
        })

    inserted_count = 0
    for i in range(0, len(rows_to_insert), batch_size):
        batch = rows_to_insert[i:i + batch_size]
        res = supabase.table("coach_spreadsheet_rows").insert(batch).execute()
        if res.data:
            inserted_count += len(res.data)

    return inserted_count
