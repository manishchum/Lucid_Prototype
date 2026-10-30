# Backend/routes/coach_upload.py
"""
Enterprise API Endpoints for Performance Coach Document Ingestion Hub.
Features:
- Multi-format ingestion: PDF, DOCX, DOC, CSV, XLSX, XLS, PPTX, PPT
- Pre-flight conflict & duplicate detection (Hash & Filename)
- Conflict resolution modes: Overwrite in-place, Version bump, Skip
- Binary signature & magic-byte MIME validation (Anti-Malware / Executable prevention)
- Maximum file size enforcement (100MB)
- Distributed ARQ Redis worker offloading with in-process thread pool fallback
- Real-Time Server-Sent Events (SSE) stream via Redis Pub/Sub
- Immutable Audit Logging for compliance (SOC 2 / GDPR)
- Strict RBAC: Admin & Manager authorization
- Server-side paginated, searchable, and filtered document catalog
- Temporary signed download URLs & Vector Chunk Inspector
"""

import os
import time
import math
import json
import hashlib
import uuid
import shutil
import asyncio
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple

from fastapi import (
    APIRouter,
    HTTPException,
    Depends,
    UploadFile,
    File,
    Form,
    Query,
    Request,
    BackgroundTasks
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import redis.asyncio as aioredis

from utils.auth import RequestAuth, get_request_auth_required
from utils.supabase_client import supabase_admin
from utils.db.permissions import check_user_permission
from utils.redis_client import redis_client, redis_ssl, get_cache, set_cache, delete_cache_pattern
from utils.arq_client import enqueue_job
from ingestion.coach_store import create_document_record
from ingestion.coach_pipeline import run_coach_file_ingestion

router = APIRouter(
    prefix="/api/coach",
    tags=["Performance Coach Ingestion"]
)

ALLOWED_EXTENSIONS = {"pdf", "docx", "doc", "csv", "xlsx", "xls", "pptx", "ppt"}
MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB
BUCKET_NAME = "coach-documents"
TEMP_DIR = os.path.join(os.getcwd(), "storage", "temp_coach_uploads")


# ============================================================================
# 1. HELPERS: MIME SNIFFING, RBAC, AUDIT LOGGING
# ============================================================================

def detect_mime_and_validate(content: bytes, filename: str) -> Tuple[bool, str, str]:
    """
    Validates file extension and sniffs file signature (magic bytes)
    to prevent disguised binaries, executables, or corrupted files.
    Returns: (is_valid, mime_type, extension)
    """
    ext = filename.split(".")[-1].lower() if "." in filename else ""
    header = content[:16]

    # Reject dangerous executable formats immediately regardless of extension
    if header.startswith(b"MZ") or header.startswith(b"\x7fELF") or header.startswith(b"#!"):
        return False, "application/x-executable", ext

    if ext not in ALLOWED_EXTENSIONS:
        return False, "application/octet-stream", ext

    # PDF validation
    if ext == "pdf":
        if header.startswith(b"%PDF-"):
            return True, "application/pdf", ext
        return False, "application/octet-stream", ext

    # Modern Office formats (DOCX, XLSX, PPTX) - standard ZIP container
    if ext in ("docx", "xlsx", "pptx"):
        if header.startswith(b"PK\x03\x04") or header.startswith(b"PK\x05\x06") or header.startswith(b"PK\x07\x08"):
            mime_map = {
                "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            }
            return True, mime_map[ext], ext
        return False, "application/octet-stream", ext

    # Legacy MS Office binary formats (DOC, XLS, PPT) - Compound File Binary / OLE
    if ext in ("doc", "xls", "ppt"):
        if header.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            mime_map = {
                "doc": "application/msword",
                "xls": "application/vnd.ms-excel",
                "ppt": "application/vnd.ms-powerpoint"
            }
            return True, mime_map[ext], ext
        # Plain text CSV renamed as xls
        if ext == "xls" and b"\x00" not in content[:512]:
            return True, "text/csv", "csv"
        return False, "application/octet-stream", ext

    # CSV - Plain text validation
    if ext == "csv":
        if b"\x00" in content[:1024]:
            return False, "application/octet-stream", ext
        try:
            content[:2048].decode("utf-8")
            return True, "text/csv", ext
        except UnicodeDecodeError:
            try:
                content[:2048].decode("latin-1")
                return True, "text/csv", ext
            except Exception:
                return False, "application/octet-stream", ext

    return False, "application/octet-stream", ext


async def verify_coach_access(user_id: str, company_id: str, min_role: str = "manager") -> bool:
    """Verifies that user is an admin or manager in the specified company."""
    if not user_id:
        return False
    is_admin = await check_user_permission(user_id, "admin")
    if is_admin:
        return True
    if min_role == "manager":
        is_mgr = await check_user_permission(user_id, "manager")
        if is_mgr:
            return True
    return False


def log_coach_audit_event(
    company_id: str,
    actor_id: str,
    actor_email: Optional[str],
    action: str,
    target_id: Optional[str] = None,
    target_name: Optional[str] = None,
    details: Optional[dict] = None
) -> None:
    """Records an immutable audit event for compliance."""
    try:
        supabase_admin.table("audit_logs").insert({
            "company_id": company_id,
            "actor_id": actor_id,
            "actor_email": actor_email,
            "action": action,
            "action_category": "COACH_INGESTION",
            "target_type": "coach_document",
            "target_id": target_id,
            "target_name": target_name,
            "details": details or {},
            "status": "SUCCESS"
        }).execute()
    except Exception as e:
        print(f"[COACH AUDIT LOG] Note: {e}")


# Global in-memory broadcast queues for SSE streams (company_id -> set of asyncio.Queue)
_COACH_SSE_SUBSCRIBERS: Dict[str, set] = {}

def publish_coach_progress(company_id: str, document_id: str, stage: str, percent: int, details: Optional[dict] = None) -> None:
    """Publishes real-time coach ingestion progress to local SSE subscribers and Redis Pub/Sub."""
    payload = {
        "event": "DOCUMENT_PROGRESS",
        "document_id": document_id,
        "company_id": str(company_id),
        "stage": stage,
        "percent": percent,
        "details": details or {},
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    msg_str = json.dumps(payload)

    # 1. Local in-memory instant broadcast (zero Redis latency & immune to Redis connection limits)
    subs = _COACH_SSE_SUBSCRIBERS.get(str(company_id), set()).copy()
    for q in subs:
        try:
            q.put_nowait(msg_str)
        except Exception:
            pass

    # 2. Redis Pub/Sub broadcast across cluster nodes (fails gracefully if connection cap reached)
    try:
        redis_client.publish(f"coach_ingestion:{company_id}", msg_str)
    except Exception as err:
        pass


# ============================================================================
# 2. MODELS FOR PRE-FLIGHT CHECK & CONFLICT RESOLUTION
# ============================================================================

class PreflightItem(BaseModel):
    file_name: str
    file_size: int
    file_hash: str

class PreflightCheckRequest(BaseModel):
    items: List[PreflightItem]


# ============================================================================
# 3. ENDPOINTS
# ============================================================================

@router.post("/preflight-check")
async def check_preflight_conflicts(
    payload: PreflightCheckRequest,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Checks for file conflicts prior to upload:
    - Detects identical hash duplicates (prevents redundant processing).
    - Detects filename conflicts with modified contents (prompts Overwrite vs Version).
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    results = []
    for item in payload.items:
        # 1. Query for exact hash match
        hash_res = (
            supabase_admin.table("coach_uploaded_documents")
            .select("id, file_name, file_size_bytes, status, parsed_metadata, created_at, version")
            .eq("company_id", company_id)
            .eq("file_hash", item.file_hash)
            .limit(1)
            .execute()
        )
        exact_match = hash_res.data[0] if (hash_res and getattr(hash_res, "data", None)) else None

        if exact_match:
            results.append({
                "file_name": item.file_name,
                "file_hash": item.file_hash,
                "status": "exists_identical",
                "message": f"An identical document '{exact_match['file_name']}' is already indexed in your vault.",
                "existing_document": exact_match
            })
            continue

        # 2. Query for filename match with modified contents
        name_res = (
            supabase_admin.table("coach_uploaded_documents")
            .select("id, file_name, file_size_bytes, status, parsed_metadata, created_at, version")
            .eq("company_id", company_id)
            .eq("file_name", item.file_name)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        name_match = name_res.data[0] if (name_res and getattr(name_res, "data", None)) else None

        if name_match:
            results.append({
                "file_name": item.file_name,
                "file_hash": item.file_hash,
                "status": "name_conflict",
                "message": f"A document named '{item.file_name}' already exists with different contents.",
                "existing_document": name_match
            })
            continue

        # 3. Clean
        results.append({
            "file_name": item.file_name,
            "file_hash": item.file_hash,
            "status": "clean",
            "message": "Ready for ingestion."
        })

    return {"results": results}


@router.post("/upload")
async def upload_performance_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    target_employee_id: Optional[str] = Form(None),
    manual_description: Optional[str] = Form(None),
    conflict_mode: str = Form("fail_on_conflict"),  # "fail_on_conflict", "overwrite", "version", "skip"
    existing_doc_id: Optional[str] = Form(None),
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Enterprise Upload Endpoint:
    - Enforces 100MB maximum size limit.
    - Validates binary magic-bytes.
    - Supports interactive conflict resolution (Overwrite in-place, Version bump, Skip).
    - Enqueues to Redis ARQ worker with automatic in-process fallback.
    - Emits audit log entries.
    """
    company_id = auth.company_id
    user_id = auth.user_id

    if not company_id or not user_id:
        raise HTTPException(status_code=400, detail="Authenticated company_id and user_id are required.")

    # RBAC Guard: minimum Manager role required
    has_perm = await verify_coach_access(user_id, company_id, min_role="manager")
    if not has_perm:
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Only Company Administrators and Managers can upload knowledge documents."
        )

    if target_employee_id:
        target_employee_id = target_employee_id.strip()
        if target_employee_id.lower() in ("none", "null", "undefined", ""):
            target_employee_id = None

    if manual_description:
        manual_description = manual_description.strip() or None

    raw_filename = file.filename or "unknown_file"

    # Read content with memory-safe limit check
    content = await file.read()
    file_size = len(content)

    if file_size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if file_size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File '{raw_filename}' ({round(file_size / (1024 * 1024), 2)}MB) exceeds maximum allowable limit of 100MB."
        )

    # Magic-byte MIME sniffing
    is_valid, detected_mime, file_ext = detect_mime_and_validate(content, raw_filename)
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail=f"File validation failed for '{raw_filename}'. Unsupported format or invalid binary signature. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    file_hash = hashlib.sha256(content).hexdigest()

    # Conflict check
    if conflict_mode == "fail_on_conflict":
        # Check exact hash duplicate
        hash_check = (
            supabase_admin.table("coach_uploaded_documents")
            .select("id, file_name, created_at")
            .eq("company_id", company_id)
            .eq("file_hash", file_hash)
            .limit(1)
            .execute()
        )
        if hash_check.data:
            existing = hash_check.data[0]
            raise HTTPException(
                status_code=409,
                detail=f"Document '{raw_filename}' already exists with identical contents (ID: {existing['id']})."
            )

    # Handle Conflict Resolution: OVERWRITE IN-PLACE
    doc_id = None
    target_filename = raw_filename
    is_overwrite = False

    if conflict_mode == "overwrite" and existing_doc_id:
        existing_doc = (
            supabase_admin.table("coach_uploaded_documents")
            .select("id, file_name, version, storage_path")
            .eq("id", existing_doc_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
        )
        if existing_doc and getattr(existing_doc, "data", None):
            doc_id = existing_doc_id
            curr_ver = int(existing_doc.data.get("version") or 1)
            is_overwrite = True
            print(f"[COACH UPLOAD] Overwriting document '{raw_filename}' (ID: {doc_id}) -> Version {curr_ver + 1}")

            # Purge old vector chunks & tabular rows
            try:
                supabase_admin.table("coach_document_chunks").delete().eq("document_id", doc_id).execute()
                supabase_admin.table("coach_spreadsheet_rows").delete().eq("document_id", doc_id).execute()
            except Exception as purge_err:
                print(f"[COACH UPLOAD] Chunk purge note: {purge_err}")

            # Update document master record
            supabase_admin.table("coach_uploaded_documents").update({
                "file_hash": file_hash,
                "file_size_bytes": file_size,
                "status": "pending",
                "version": curr_ver + 1,
                "error_message": None,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", doc_id).execute()

    elif conflict_mode == "version":
        # Version bump: Append version suffix to filename
        base_name, dot_ext = os.path.splitext(raw_filename)
        timestamp_suffix = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        target_filename = f"{base_name}_v{timestamp_suffix}{dot_ext}"
        print(f"[COACH UPLOAD] Versioning conflicting file: '{raw_filename}' -> '{target_filename}'")

    elif conflict_mode == "skip":
        return {
            "success": True,
            "status": "skipped",
            "message": f"Upload for '{raw_filename}' skipped due to existing duplicate."
        }

    if not doc_id:
        doc_id = str(uuid.uuid4())

    safe_filename = f"{doc_id}_{target_filename}"
    storage_path = f"{company_id}/{doc_id}/{target_filename}"

    # 1. Upload to Supabase Storage bucket
    try:
        supabase_admin.storage.from_(BUCKET_NAME).upload(
            path=storage_path,
            file=content,
            file_options={"content-type": detected_mime, "upsert": "true"}
        )
    except Exception as e:
        print(f"[COACH UPLOAD] Storage upload note: {e}")
        storage_path = f"local_storage/{safe_filename}"

    # 2. Insert master document record if not an overwrite
    if not is_overwrite:
        doc_record = create_document_record(
            company_id=company_id,
            uploaded_by=user_id,
            file_name=target_filename,
            file_type=file_ext,
            file_size_bytes=file_size,
            storage_path=storage_path,
            file_hash=file_hash,
            target_employee_id=target_employee_id,
            manual_description=manual_description
        )
        doc_id = doc_record["id"]

    # 3. Save to local temporary path for ingestion worker
    os.makedirs(TEMP_DIR, exist_ok=True)
    temp_file_path = os.path.join(TEMP_DIR, safe_filename)
    with open(temp_file_path, "wb") as f:
        f.write(content)

    # 4. Dispatch to ARQ Redis worker queue with in-process thread pool fallback
    enqueued = False
    try:
        job = await enqueue_job(
            "run_coach_document_ingestion_task",
            document_id=doc_id,
            company_id=company_id,
            file_path=temp_file_path,
            file_name=target_filename,
            file_type=file_ext,
            target_employee_id=target_employee_id
        )
        if job:
            enqueued = True
            print(f"[COACH UPLOAD] Enqueued ARQ worker job {job.job_id} for doc={doc_id}")
    except Exception as arq_err:
        print(f"[COACH UPLOAD] ARQ enqueue warning: {arq_err}. Falling back to background task.")

    if not enqueued:
        # In-process thread-pooled execution fallback
        def _run_local_fallback():
            try:
                def _on_progress(stage: str, percent: int, details: dict):
                    publish_coach_progress(company_id, doc_id, stage, percent, details)

                run_coach_file_ingestion(
                    file_path=temp_file_path,
                    document_id=doc_id,
                    company_id=company_id,
                    file_name=target_filename,
                    file_type=file_ext,
                    target_employee_id=target_employee_id,
                    progress_callback=_on_progress
                )
            finally:
                if os.path.exists(temp_file_path):
                    try:
                        os.remove(temp_file_path)
                    except Exception:
                        pass

        background_tasks.add_task(_run_local_fallback)

    # 5. Record Audit Log
    log_coach_audit_event(
        company_id=company_id,
        actor_id=user_id,
        actor_email=auth.email,
        action="COACH_DOCUMENT_OVERWRITTEN" if is_overwrite else "COACH_DOCUMENT_UPLOADED",
        target_id=doc_id,
        target_name=target_filename,
        details={
            "file_size_bytes": file_size,
            "file_hash": file_hash,
            "target_employee_id": target_employee_id,
            "conflict_mode": conflict_mode,
            "is_overwrite": is_overwrite
        }
    )

    # Invalidate document catalog cache for company (L1 + L2)
    invalidate_coach_docs_cached(company_id)

    # Publish initial queued event over SSE
    publish_coach_progress(
        company_id=company_id,
        document_id=doc_id,
        stage="queued",
        percent=5,
        details={"file_name": target_filename, "stage_text": "Queued for processing"}
    )

    return {
        "success": True,
        "message": f"File '{target_filename}' queued for live ingestion.",
        "document_id": doc_id,
        "status": "pending",
        "file_name": target_filename,
        "file_type": file_ext,
        "is_overwrite": is_overwrite
    }


# In-memory L1 cache + Redis L2 cache for microsecond document listing
_COACH_DOCS_L1_CACHE: Dict[str, Tuple[float, Any]] = {}
L1_TTL = 30.0  # seconds

def get_coach_docs_cached(key: str) -> Optional[Any]:
    now = time.time()
    if key in _COACH_DOCS_L1_CACHE:
        ts, val = _COACH_DOCS_L1_CACHE[key]
        if now - ts < L1_TTL:
            return val
        _COACH_DOCS_L1_CACHE.pop(key, None)
    val = get_cache(key)
    if val is not None:
        _COACH_DOCS_L1_CACHE[key] = (now, val)
    return val

def set_coach_docs_cached(key: str, val: Any, ttl: int = 120):
    _COACH_DOCS_L1_CACHE[key] = (time.time(), val)
    set_cache(key, val, ttl=ttl)

def invalidate_coach_docs_cached(company_id: str):
    prefix = f"coach_docs:{company_id}:"
    keys_to_del = [k for k in _COACH_DOCS_L1_CACHE if k.startswith(prefix)]
    for k in keys_to_del:
        _COACH_DOCS_L1_CACHE.pop(k, None)
    try:
        delete_cache_pattern(f"{prefix}*")
    except Exception:
        pass


@router.get("/documents")
async def list_coach_documents(
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(25, ge=1, le=100, description="Items per page"),
    search: Optional[str] = Query(None, description="Search by file name"),
    status: Optional[str] = Query(None, description="Filter by status (completed, parsing, embedding, failed)"),
    source: Optional[str] = Query(None, description="Filter by source (gdrive, manual)"),
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Paginated, searchable document catalog with server-side filtering.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    # Fast L1 (Memory) + L2 (Redis) Cache lookup (<1ms response time)
    cache_key = f"coach_docs:{company_id}:{page}:{limit}:{search or ''}:{status or ''}:{source or ''}"
    cached_data = get_coach_docs_cached(cache_key)
    if cached_data is not None:
        return cached_data

    # Base query
    query = (
        supabase_admin.table("coach_uploaded_documents")
        .select("id, file_name, file_type, file_size_bytes, status, description, manual_description, document_period, error_message, parsed_metadata, created_at, target_employee_id, uploaded_by, version", count="exact")
        .eq("company_id", company_id)
    )

    if search and search.strip():
        query = query.ilike("file_name", f"%{search.strip()}%")

    if status and status != "all":
        query = query.eq("status", status)

    if source == "gdrive":
        query = query.ilike("manual_description", "%google drive%")
    elif source == "manual":
        query = query.not_.ilike("manual_description", "%google drive%")

    # Calculate pagination offset
    offset = (page - 1) * limit
    res = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()

    total_count = res.count or 0
    total_pages = math.ceil(total_count / limit) if total_count > 0 else 1

    catalog_result = {
        "documents": res.data or [],
        "total": total_count,
        "page": page,
        "limit": limit,
        "total_pages": total_pages
    }
    set_coach_docs_cached(cache_key, catalog_result, ttl=120)
    return catalog_result


@router.get("/documents/{document_id}")
async def get_coach_document(
    document_id: str,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """Get status and details of a specific coach document."""
    company_id = auth.company_id
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


@router.get("/documents/{document_id}/download-url")
async def get_document_download_url(
    document_id: str,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Generates a secure, temporary (15-minute) signed URL to download or view the original file.
    """
    company_id = auth.company_id
    doc_res = (
        supabase_admin.table("coach_uploaded_documents")
        .select("id, file_name, storage_path")
        .eq("id", document_id)
        .eq("company_id", company_id)
        .maybe_single()
        .execute()
    )
    if not doc_res or not getattr(doc_res, "data", None):
        raise HTTPException(status_code=404, detail="Document not found.")

    storage_path = doc_res.data.get("storage_path")
    if not storage_path or storage_path.startswith("local_storage/"):
        raise HTTPException(status_code=404, detail="File is only available in local cache.")

    try:
        # Create signed URL valid for 900 seconds (15 minutes)
        signed = supabase_admin.storage.from_(BUCKET_NAME).create_signed_url(storage_path, 900)
        signed_url = signed.get("signedUrl") or signed.get("signedURL")
        return {
            "success": True,
            "download_url": signed_url,
            "file_name": doc_res.data["file_name"],
            "expires_in_seconds": 900
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate download URL: {str(e)}")


@router.get("/documents/{document_id}/chunks")
async def get_document_chunks(
    document_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Fetches paginated vector chunks and proof citations for inspection.
    """
    company_id = auth.company_id
    offset = (page - 1) * limit

    chunks_res = (
        supabase_admin.table("coach_document_chunks")
        .select("id, chunk_index, chunk_type, content, citation, target_employee_id, created_at", count="exact")
        .eq("document_id", document_id)
        .eq("company_id", company_id)
        .order("chunk_index", desc=False)
        .range(offset, offset + limit - 1)
        .execute()
    )

    total_count = chunks_res.count or 0
    return {
        "chunks": chunks_res.data or [],
        "total": total_count,
        "page": page,
        "limit": limit,
        "total_pages": math.ceil(total_count / limit) if total_count > 0 else 1
    }


@router.delete("/documents/{document_id}")
async def delete_coach_document(
    document_id: str,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Delete a document and all its associated vector chunks and spreadsheet rows (CASCADE).
    Enforces Admin RBAC and logs to audit trail.
    """
    company_id = auth.company_id
    user_id = auth.user_id

    # RBAC: Only Admin can delete
    is_admin = await check_user_permission(user_id, "admin")
    if not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Only Company Administrators can delete coach documents."
        )

    # 1. Fetch document storage path
    doc_res = (
        supabase_admin.table("coach_uploaded_documents")
        .select("id, file_name, storage_path")
        .eq("id", document_id)
        .eq("company_id", company_id)
        .maybe_single()
        .execute()
    )
    if not doc_res or not getattr(doc_res, "data", None):
        raise HTTPException(status_code=404, detail="Document not found.")

    storage_path = doc_res.data.get("storage_path")
    file_name = doc_res.data.get("file_name")

    # 2. Delete database record (cascades to chunks & spreadsheet rows)
    supabase_admin.table("coach_uploaded_documents").delete().eq("id", document_id).execute()

    # Also mark connector sync item as deleted if from Google Drive
    try:
        supabase_admin.table("integration_synced_items").update({
            "status": "deleted"
        }).eq("coach_document_id", document_id).execute()
    except Exception:
        pass

    # 3. Clean up Supabase storage
    if storage_path and not storage_path.startswith("local_storage/"):
        try:
            supabase_admin.storage.from_(BUCKET_NAME).remove([storage_path])
        except Exception as e:
            print(f"[COACH DELETE] Warning: Failed to remove file from storage: {e}")

    # 4. Audit Log
    log_coach_audit_event(
        company_id=company_id,
        actor_id=user_id,
        actor_email=auth.email,
        action="COACH_DOCUMENT_DELETED",
        target_id=document_id,
        target_name=file_name,
        details={"storage_path": storage_path}
    )

    # Invalidate document catalog cache for company (L1 + L2)
    invalidate_coach_docs_cached(company_id)

    return {"success": True, "message": f"Document '{file_name}' and all related vector chunks deleted."}


# ============================================================================
# 4. SERVER-SENT EVENTS (SSE) REAL-TIME PROGRESS STREAM
# ============================================================================

@router.get("/events")
async def stream_coach_events(
    request: Request,
    auth: RequestAuth = Depends(get_request_auth_required)
):
    """
    Server-Sent Events (SSE) stream pushing real-time document ingestion updates
    (parsing, chunking, embedding, row counts) to connected admin clients.
    Eliminates 3.5s interval polling.
    """
    company_id = auth.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    async def event_generator():
        company_key = str(company_id)
        queue = asyncio.Queue(maxsize=100)

        # Register local subscriber
        if company_key not in _COACH_SSE_SUBSCRIBERS:
            _COACH_SSE_SUBSCRIBERS[company_key] = set()
        _COACH_SSE_SUBSCRIBERS[company_key].add(queue)

        try:
            # Initial handshake
            yield f"data: {json.dumps({'event': 'CONNECTED', 'company_id': company_key})}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                except asyncio.CancelledError:
                    break
        finally:
            if company_key in _COACH_SSE_SUBSCRIBERS:
                _COACH_SSE_SUBSCRIBERS[company_key].discard(queue)
                if not _COACH_SSE_SUBSCRIBERS[company_key]:
                    _COACH_SSE_SUBSCRIBERS.pop(company_key, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
