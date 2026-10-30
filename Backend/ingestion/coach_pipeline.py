# Backend/ingestion/coach_pipeline.py
"""
End-to-end ingestion pipeline for Performance Coach manual uploads.
Parses multi-format documents, embeds text chunks, stores spreadsheet records, and links citations.
Supports real-time progress callbacks for SSE / WebSocket broadcasting.
"""

import os
import traceback
from typing import Dict, Any, Optional, Callable

from ingestion.coach_parser import parse_manual_upload
from ingestion.coach_store import (
    fetch_company_employees,
    update_document_status,
    insert_coach_chunks,
    insert_spreadsheet_rows
)
from ingestion.embedder import embed_chunks


def run_coach_file_ingestion(
    file_path: str,
    document_id: str,
    company_id: str,
    file_name: str,
    file_type: str,
    target_employee_id: Optional[str] = None,
    progress_callback: Optional[Callable[[str, int, Dict[str, Any]], None]] = None
) -> Dict[str, Any]:
    """
    Executes the ingestion pipeline for a given uploaded document.
    Emits granular progress stages via progress_callback(stage, percent, details).
    """
    scope_desc = f"employee={target_employee_id}" if target_employee_id else "team/company-wide"
    print(f"[COACH INGESTION] Starting ingestion for doc={document_id}, file={file_name} ({file_type}, {scope_desc})")
    
    def _report_progress(stage: str, percent: int, details: Optional[Dict[str, Any]] = None):
        if progress_callback:
            try:
                progress_callback(stage, percent, details or {})
            except Exception as cb_err:
                print(f"[COACH INGESTION] Progress callback note: {cb_err}")

    try:
        # Step 1: Update status to parsing
        update_document_status(document_id, status="parsing")
        _report_progress("parsing", 20, {
            "stage_text": "Extracting text, pages, and tabular sheets",
            "file_name": file_name
        })
        
        # Step 2: Fetch company roster to automatically link employees
        employee_roster = fetch_company_employees(company_id)
        print(f"[COACH INGESTION] Loaded {len(employee_roster)} employees for entity matching")
        
        # Step 3: Parse document into chunks and structured rows
        chunks, spreadsheet_rows, parsed_metadata = parse_manual_upload(
            file_path=file_path,
            file_name=file_name,
            file_type=file_type,
            employee_roster=employee_roster,
            target_employee_id=target_employee_id
        )
        print(f"[COACH INGESTION] Parsed {len(chunks)} chunks and {len(spreadsheet_rows)} spreadsheet rows")
        
        if not chunks and not spreadsheet_rows:
            raise ValueError(f"No extractable text or data found in '{file_name}'. Ensure document contains readable text.")

        # Step 4: Update metadata immediately and change status to embedding
        parsed_metadata["chunks_count"] = len(chunks)
        parsed_metadata["spreadsheet_rows_count"] = len(spreadsheet_rows)
        update_document_status(
            document_id=document_id,
            status="embedding",
            parsed_metadata=parsed_metadata
        )
        _report_progress("embedding", 55, {
            "stage_text": f"Generating vector embeddings for {len(chunks)} chunks",
            "chunks_count": len(chunks),
            "spreadsheet_rows_count": len(spreadsheet_rows)
        })
        
        text_contents = [c["content"] for c in chunks]
        print(f"[COACH INGESTION] Generating embeddings for {len(text_contents)} chunks...")
        embeddings = embed_chunks(text_contents)
        
        # Step 5: Store Chunks & Proof Citations in Supabase
        _report_progress("storing", 80, {
            "stage_text": "Storing chunks and proof citations in database",
            "chunks_count": len(chunks)
        })
        chunks_inserted = insert_coach_chunks(
            document_id=document_id,
            company_id=company_id,
            chunks=chunks,
            embeddings=embeddings
        )
        print(f"[COACH INGESTION] Inserted {chunks_inserted} vector chunks")
        
        # Step 6: Store Structured Tabular Rows (if Excel/CSV)
        rows_inserted = 0
        if spreadsheet_rows:
            rows_inserted = insert_spreadsheet_rows(
                document_id=document_id,
                company_id=company_id,
                spreadsheet_rows=spreadsheet_rows
            )
            print(f"[COACH INGESTION] Inserted {rows_inserted} structured spreadsheet records")
            
        # Step 7: Mark Completed
        parsed_metadata["chunks_count"] = chunks_inserted
        parsed_metadata["spreadsheet_rows_count"] = rows_inserted
        
        update_document_status(
            document_id=document_id,
            status="completed",
            parsed_metadata=parsed_metadata
        )
        
        _report_progress("completed", 100, {
            "stage_text": "Ingestion completed and ready for AI Coach",
            "chunks_count": chunks_inserted,
            "spreadsheet_rows_count": rows_inserted
        })

        print(f"[COACH INGESTION] [OK] Successfully ingested doc={document_id}")
        return {
            "document_id": document_id,
            "status": "completed",
            "chunks_count": chunks_inserted,
            "spreadsheet_rows_count": rows_inserted
        }

    except Exception as e:
        err_msg = str(e)
        print(f"[COACH INGESTION ERROR] Failed to ingest {file_name}: {err_msg}")
        traceback.print_exc()
        update_document_status(
            document_id=document_id,
            status="failed",
            error_message=err_msg
        )
        _report_progress("failed", 0, {
            "stage_text": f"Ingestion failed: {err_msg}",
            "error": err_msg
        })
        return {
            "document_id": document_id,
            "status": "failed",
            "error": err_msg
        }
