# Backend/ingestion/coach_pipeline.py
"""
End-to-end ingestion pipeline for Performance Coach manual uploads.
Parses multi-format documents, embeds text chunks, stores spreadsheet records, and links citations.
"""

import os
import traceback
from typing import Dict, Any, Optional

from ingestion.coach_parser import parse_manual_upload
from ingestion.coach_summarizer import generate_document_summary_and_category
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
    target_employee_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes the ingestion pipeline for a given uploaded document.
    """
    scope_desc = f"employee={target_employee_id}" if target_employee_id else "team/company-wide"
    print(f"[COACH INGESTION] Starting ingestion for doc={document_id}, file={file_name} ({file_type}, {scope_desc})")
    
    try:
        # Step 1: Update status to parsing
        update_document_status(document_id, status="parsing")
        
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
            raise ValueError(f"No extractable text or data found in {file_name}")

        # Step 3.5: Auto-generate Document Summary & Category Classification using lightweight model
        target_employee_name = None
        if target_employee_id and employee_roster:
            matched_emp = next((e for e in employee_roster if str(e.get("user_id")) == str(target_employee_id)), None)
            if matched_emp:
                target_employee_name = matched_emp.get("name")

        print(f"[COACH INGESTION] Auto-generating summary and category classification for '{file_name}'...")
        summary_res = generate_document_summary_and_category(
            file_name=file_name,
            file_type=file_type,
            chunks=chunks,
            spreadsheet_rows=spreadsheet_rows,
            parsed_metadata=parsed_metadata,
            target_employee_name=target_employee_name
        )
        doc_summary = summary_res.get("summary")
        category_tag = summary_res.get("category")
        detected_period = summary_res.get("document_period") or parsed_metadata.get("document_period")
        key_topics = summary_res.get("key_topics", [])

        parsed_metadata["category"] = category_tag
        parsed_metadata["key_topics"] = key_topics
        if detected_period:
            parsed_metadata["document_period"] = detected_period

        # Step 4: Update metadata immediately and change status to embedding
        parsed_metadata["chunks_count"] = len(chunks)
        parsed_metadata["spreadsheet_rows_count"] = len(spreadsheet_rows)
        
        update_document_status(
            document_id=document_id,
            status="embedding",
            description=doc_summary,
            document_period=detected_period,
            parsed_metadata=parsed_metadata
        )
        
        text_contents = [c["content"] for c in chunks]
        print(f"[COACH INGESTION] Generating embeddings for {len(text_contents)} chunks with contextual headers...")
        embeddings = embed_chunks(text_contents)
        
        # Step 5: Store Chunks & Proof Citations in Supabase
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
            description=doc_summary,
            document_period=detected_period,
            parsed_metadata=parsed_metadata
        )
        
        print(f"[COACH INGESTION] [OK] Successfully ingested doc={document_id} (Category: {category_tag}, period: {detected_period})")
        return {
            "document_id": document_id,
            "status": "completed",
            "category": category_tag,
            "description": doc_summary,
            "document_period": detected_period,
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
        return {
            "document_id": document_id,
            "status": "failed",
            "error": err_msg
        }
