# Backend/routes/coach_upload.py
"""
API Endpoints for Performance Coach Manual File Uploads & Ingestion.
Supports: PDF, DOCX, DOC, CSV, XLSX, XLS, PPTX, PPT.
"""

import os
import hashlib
import uuid
import shutil
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel

from utils.auth import RequestAuth, get_request_auth_required
from utils.supabase_client import supabase_admin
from utils.db.permissions import check_user_permission
from ingestion.coach_store import create_document_record
from ingestion.coach_pipeline import run_coach_file_ingestion

router = APIRouter(
    prefix="/api/coach",
    tags=["Performance Coach Ingestion"]
)

ALLOWED_EXTENSIONS = {"pdf", "docx", "doc", "csv", "xlsx", "xls", "pptx", "ppt"}
BUCKET_NAME = "coach-documents"
TEMP_DIR = os.path.join(os.getcwd(), "storage", "temp_coach_uploads")


async def _verify_coach_admin_permission(user_id: str) -> None:
    """
    Verifies that the requesting user has at least Admin role level (Admin, SuperAdmin, Developer).
    Normal employees/learners and managers are not permitted.
    """
    has_perm = await check_user_permission(user_id, "admin")
    if not has_perm:
        raise HTTPException(
            status_code=403,
            detail="Access denied: Admin or Developer role required to access Performance Coach Ingestion."
        )


def _run_ingestion_background(
    temp_file_path: str,
    document_id: str,
    company_id: str,
    file_name: str,
    file_type: str,
    target_employee_id: Optional[str] = None
):
    """Background worker task to run file parsing and embedding."""
    try:
        run_coach_file_ingestion(
            file_path=temp_file_path,
            document_id=document_id,
            company_id=company_id,
            file_name=file_name,
            file_type=file_type,
            target_employee_id=target_employee_id
        )
    finally:
        # Clean up local temporary file after ingestion
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e:
                print(f"[COACH UPLOAD] Warning: Failed to clean up temp file {temp_file_path}: {e}")


@router.post("/upload")
async def upload_performance_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    target_employee_id: Optional[str] = Form(None),
    manual_description: Optional[str] = Form(None),
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Upload a document (PDF, DOCX, CSV, Excel, PPTX) for the Performance Coach.
    File is stored in Supabase Storage and parsed asynchronously in the background.
    """
    company_id = auth.company_id
    user_id = auth.user_id

    if not company_id or not user_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id and user_id are required.")

    # Strictly check that the user is Admin, SuperAdmin, or Developer
    await _verify_coach_admin_permission(user_id)

    if target_employee_id:
        target_employee_id = target_employee_id.strip()
        if target_employee_id.lower() in ("none", "null", "undefined", ""):
            target_employee_id = None

    if manual_description:
        manual_description = manual_description.strip() or None

    # Validate file extension
    file_name = file.filename or "unknown_file"
    file_ext = file_name.split(".")[-1].lower() if "." in file_name else ""
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '.{file_ext}'. Allowed formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # Read file content into memory
    content = await file.read()
    file_size = len(content)
    if file_size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # Calculate SHA256 for de-duplication tracking
    file_hash = hashlib.sha256(content).hexdigest()

    # Generate document ID and Supabase Storage path
    doc_id = str(uuid.uuid4())
    safe_filename = f"{doc_id}_{file_name}"
    storage_path = f"{company_id}/{doc_id}/{file_name}"

    # 1. Upload to Supabase Storage bucket
    try:
        storage_res = supabase_admin.storage.from_(BUCKET_NAME).upload(
            path=storage_path,
            file=content,
            file_options={"content-type": file.content_type or "application/octet-stream", "upsert": "true"}
        )
    except Exception as e:
        print(f"[COACH UPLOAD] Supabase Storage upload failed: {e}")
        # Note: If bucket doesn't exist yet, we still allow local file persistence for processing
        storage_path = f"local_storage/{safe_filename}"

    # 2. Register master record in coach_uploaded_documents
    doc_record = create_document_record(
        company_id=company_id,
        uploaded_by=user_id,
        file_name=file_name,
        file_type=file_ext,
        file_size_bytes=file_size,
        storage_path=storage_path,
        file_hash=file_hash,
        target_employee_id=target_employee_id,
        manual_description=manual_description
    )

    # 3. Save to local temporary path for ingestion worker
    os.makedirs(TEMP_DIR, exist_ok=True)
    temp_file_path = os.path.join(TEMP_DIR, safe_filename)
    with open(temp_file_path, "wb") as f:
        f.write(content)

    # 4. Trigger asynchronous background ingestion
    background_tasks.add_task(
        _run_ingestion_background,
        temp_file_path=temp_file_path,
        document_id=doc_record["id"],
        company_id=company_id,
        file_name=file_name,
        file_type=file_ext,
        target_employee_id=target_employee_id
    )

    return {
        "success": True,
        "message": f"File '{file_name}' uploaded successfully and queued for ingestion.",
        "document_id": doc_record["id"],
        "status": "pending",
        "file_name": file_name,
        "file_type": file_ext
    }


@router.get("/documents")
async def list_coach_documents(
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """List all performance coach documents uploaded for the current company."""
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    await _verify_coach_admin_permission(auth.user_id)

    res = (
        supabase_admin.table("coach_uploaded_documents")
        .select("id, file_name, file_type, file_size_bytes, status, description, manual_description, document_period, error_message, parsed_metadata, created_at, target_employee_id, uploaded_by")
        .eq("company_id", company_id)
        .order("created_at", desc=True)
        .execute()
    )

    return {"documents": res.data or []}


@router.get("/documents/{document_id}")
async def get_coach_document(
    document_id: str,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Get status and details of a specific coach document."""
    company_id = auth.company_id
    await _verify_coach_admin_permission(auth.user_id)

    res = (
        supabase_admin.table("coach_uploaded_documents")
        .select("*")
        .eq("id", document_id)
        .eq("company_id", company_id)
        .single()
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=404, detail="Document not found.")

    return res.data


@router.delete("/documents/{document_id}")
async def delete_coach_document(
    document_id: str,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Delete a document and all its associated vector chunks and spreadsheet rows (CASCADE).
    Also removes the original file from Supabase Storage.
    """
    company_id = auth.company_id
    await _verify_coach_admin_permission(auth.user_id)
    
    # 1. Fetch document storage path
    doc_res = (
        supabase_admin.table("coach_uploaded_documents")
        .select("id, storage_path")
        .eq("id", document_id)
        .eq("company_id", company_id)
        .single()
        .execute()
    )
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="Document not found.")

    storage_path = doc_res.data.get("storage_path")

    # 2. Delete database record (cascades to chunks & spreadsheet rows)
    supabase_admin.table("coach_uploaded_documents").delete().eq("id", document_id).execute()

    # 3. Clean up Supabase storage
    if storage_path and not storage_path.startswith("local_storage/"):
        try:
            supabase_admin.storage.from_(BUCKET_NAME).remove([storage_path])
        except Exception as e:
            print(f"[COACH DELETE] Warning: Failed to remove file from storage: {e}")

    return {"success": True, "message": f"Document {document_id} and all related chunks deleted."}
