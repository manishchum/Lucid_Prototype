import os
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from utils.auth import RequestAuth, get_request_auth_required
from utils.auth_bridge import get_service_supabase_client
from utils.db.voice_document_db import (
    create_voice_document,
    get_voice_document_by_id,
    list_voice_documents,
    set_voice_document_status,
    update_voice_document,
)
from voice_document.exporter import (
    generate_docx,
    generate_xlsx
)
from voice_document.agent import VoiceDocumentAgent


router = APIRouter(prefix="/api/voice-documents", tags=["voice-documents"])

SUPPORTED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg"}
SUPPORTED_OUTPUT_FORMATS = {"docx", "xlsx"}


class UpdateVoiceDocumentRequest(BaseModel):
    title: Optional[str] = None
    transcript: Optional[str] = None
    document_type: Optional[str] = None
    suggested_title: Optional[str] = None
    structured_json: Optional[Dict[str, Any]] = None
    renderable_content: Optional[Dict[str, Any]] = None
    status: Optional[str] = None
    processing_error: Optional[str] = None


class ConfirmVoiceDocumentRequest(BaseModel):
    title: Optional[str] = None
    transcript: Optional[str] = None
    document_type: Optional[str] = None
    suggested_title: Optional[str] = None
    structured_json: Optional[Dict[str, Any]] = None
    renderable_content: Optional[Dict[str, Any]] = None
    generate_file: Optional[bool] = False


class RegenerateVoiceDocumentRequest(BaseModel):
    output_format: Optional[str] = None


def _normalize_output_format(value: str) -> str:
    fmt = (value or "").strip().lower()
    if fmt not in SUPPORTED_OUTPUT_FORMATS:
        raise HTTPException(status_code=400, detail="output_format must be docx or xlsx")
    return fmt


def _ensure_supported_audio_file(file: UploadFile) -> str:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in SUPPORTED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported audio format. Supported formats: MP3, WAV, M4A, OGG",
        )
    return ext


async def _resolve_company_id(auth_ctx: RequestAuth) -> Optional[str]:
    if auth_ctx.company_id:
        return auth_ctx.company_id

    try:
        db = get_service_supabase_client()
        resp = (
            db.table("users")
            .select("company_id")
            .eq("user_id", auth_ctx.user_id)
            .maybe_single()
            .execute()
        )
        if resp.data and resp.data.get("company_id"):
            return str(resp.data["company_id"])
    except Exception:
        return None
    return None


async def _run_agent_for_document(
    auth_ctx: RequestAuth,
    voice_document_id: str,
    output_format: Optional[str] = None,
) -> Dict[str, Any]:
    db = get_service_supabase_client()
    existing = await get_voice_document_by_id(auth_ctx.user_id, voice_document_id)
    if existing.get("error"):
        return existing

    record = existing["data"]
    resolved_output_format = _normalize_output_format(output_format or record.get("output_format") or "docx")
    audio_storage_path = record.get("audio_storage_path")
    if not audio_storage_path:
        return {"data": None, "error": "Audio file path is missing"}

    await set_voice_document_status(auth_ctx.user_id, voice_document_id, "processing", None)

    temp_audio_path = None
    try:
        bucket_name = record.get("audio_bucket") or os.getenv("VOICE_DOCUMENT_BUCKET") or "content library"
        audio_bytes = db.storage.from_(bucket_name).download(audio_storage_path)
        if not audio_bytes:
            raise RuntimeError("Unable to download audio from storage")

        suffix = Path(record.get("audio_file_name") or "audio.wav").suffix or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(audio_bytes)
            temp_audio_path = tmp.name

        agent = VoiceDocumentAgent()
        draft = await agent.process_audio_file(temp_audio_path, resolved_output_format)
        if resolved_output_format == "docx":
            generated_file = generate_docx(
                draft.renderable_content
            )
        else:
            generated_file = generate_xlsx(
                draft.renderable_content
            )

        export_file_name = Path(generated_file).name

        export_storage_path = (
            f"voice-documents/"
            f"{voice_document_id}/exports/"
            f"{export_file_name}"
        )

        

        with open(generated_file, "rb") as f:
            db.storage.from_(bucket_name).upload(
                export_storage_path,
                f.read()
            )

        url_res = db.storage.from_(bucket_name).get_public_url(
            export_storage_path
        )

        if isinstance(url_res, str):
            export_url = url_res
        else:
            export_url = (
                url_res.get("publicUrl")
                or url_res.get("public_url")
            )

        update_payload = {
            "status": "draft_ready",
            "output_format": resolved_output_format,
            "transcript": draft.transcript,
            "document_type": draft.document_type,
            "suggested_title": draft.suggested_title,
            "structured_json": draft.structured_json,
            "renderable_content": draft.renderable_content,
            "model_used": draft.model_used,
            
            "export_file_name": export_file_name,
            "export_storage_path": export_storage_path,
            "export_url": export_url,
            "processing_error": None,
        }

        save_result = await update_voice_document(auth_ctx.user_id, voice_document_id, update_payload)
        if save_result.get("error"):
            return save_result

        return {
            "data": save_result.get("data"),
            "draft": draft.structured_json,
            "renderable_content": draft.renderable_content,
            "export_url": export_url,
            "error": None,
        }
    except Exception as exc:
        await set_voice_document_status(auth_ctx.user_id, voice_document_id, "failed", str(exc))
        return {"data": None, "error": str(exc)}
    finally:
        if temp_audio_path and os.path.exists(temp_audio_path):
            try:
                os.unlink(temp_audio_path)
            except Exception:
                pass


@router.post("/upload")
async def upload_voice_document(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    file: UploadFile = File(...),
    output_format: str = Form(...),
    title: Optional[str] = Form(None),
    auto_process: bool = Form(True),
):
    """
    Upload an audio file, persist it, and optionally run the voice-document agent.
    """
    _ensure_supported_audio_file(file)
    resolved_output_format = _normalize_output_format(output_format)

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    company_id = await _resolve_company_id(auth_ctx)
    if not company_id:
        raise HTTPException(status_code=400, detail="Unable to resolve company for user")

    voice_document_id = str(uuid4())
    file_name = file.filename or f"{voice_document_id}.audio"
    safe_file_name = Path(file_name).name.replace(" ", "_")
    bucket_name = os.getenv("VOICE_DOCUMENT_BUCKET") or "content library"
    storage_path = f"voice-documents/{voice_document_id}/{safe_file_name}"

    db = get_service_supabase_client()
    upload_res = db.storage.from_(bucket_name).upload(
        storage_path,
        file_bytes,
        {"content-type": file.content_type or "application/octet-stream"},
    )
    if hasattr(upload_res, "error") and upload_res.error:
        raise HTTPException(status_code=500, detail=f"Audio upload failed: {upload_res.error}")

    url_res = db.storage.from_(bucket_name).get_public_url(storage_path)
    if isinstance(url_res, str):
        audio_url = url_res
    elif isinstance(url_res, dict):
        audio_url = url_res.get("publicUrl") or url_res.get("public_url")
    else:
        audio_url = None

    record_payload = {
        "voice_document_id": voice_document_id,
        "user_id": auth_ctx.user_id,
        "company_id": company_id,
        "title": title or Path(safe_file_name).stem,
        "audio_bucket": bucket_name,
        "audio_storage_path": storage_path,
        "audio_url": audio_url,
        "audio_file_name": safe_file_name,
        "audio_mime_type": file.content_type or "application/octet-stream",
        "output_format": resolved_output_format,
        "status": "uploaded",
    }

    create_result = await create_voice_document(auth_ctx.user_id, record_payload)
    if create_result.get("error"):
        raise HTTPException(status_code=500, detail=create_result["error"])

    if auto_process:
        process_result = await _run_agent_for_document(auth_ctx, voice_document_id, resolved_output_format)
        if process_result.get("error"):
            raise HTTPException(status_code=500, detail=process_result["error"])
        return {
            "success": True,
            "document": process_result.get("data"),
            "draft": process_result.get("draft"),
            "renderable_content": process_result.get("renderable_content"),
        }

    return {
        "success": True,
        "document": create_result["data"],
        "message": "Audio uploaded successfully. Call /process to generate the draft.",
    }


@router.post("/{voice_document_id}/process")
async def process_voice_document(
    voice_document_id: str,
    request: RegenerateVoiceDocumentRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await _run_agent_for_document(auth_ctx, voice_document_id, request.output_format)
    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    return {
        "success": True,
        "document": result.get("data"),
        "draft": result.get("draft"),
        "renderable_content": result.get("renderable_content"),
    }


@router.get("/")
async def list_documents(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    user_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
):
    result = await list_voice_documents(auth_ctx.user_id, user_id=user_id, status=status, limit=limit)
    if result.get("error"):
        raise HTTPException(status_code=403, detail=result["error"])
    docs = result.get("data") or []
    return {"documents": docs, "count": len(docs)}


@router.get("/{voice_document_id}")
async def get_document(
    voice_document_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await get_voice_document_by_id(auth_ctx.user_id, voice_document_id)
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    return {"document": result["data"]}


@router.patch("/{voice_document_id}")
async def update_document(
    voice_document_id: str,
    request: UpdateVoiceDocumentRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    updates = request.dict(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = await update_voice_document(auth_ctx.user_id, voice_document_id, updates)
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])

    return {"success": True, "document": result["data"]}


@router.post("/{voice_document_id}/confirm")
async def confirm_document(
    voice_document_id: str,
    request: ConfirmVoiceDocumentRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    updates = request.dict(exclude_none=True)
    updates.pop("generate_file", None)

    if updates:
        result = await update_voice_document(auth_ctx.user_id, voice_document_id, updates)
        if result.get("error"):
            status_code = 404 if "not found" in result["error"].lower() else 403
            raise HTTPException(status_code=status_code, detail=result["error"])

    result = await update_voice_document(
        auth_ctx.user_id,
        voice_document_id,
        {
            "status": "approved",
            "approved_at": "now()",
        },
    )
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])

    return {"success": True, "document": result["data"], "message": "Draft confirmed and saved."}


@router.post("/{voice_document_id}/cancel")
async def cancel_document(
    voice_document_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await update_voice_document(auth_ctx.user_id, voice_document_id, {"status": "cancelled"})
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    return {"success": True, "document": result["data"]}


@router.post("/{voice_document_id}/regenerate")
async def regenerate_document(
    voice_document_id: str,
    request: RegenerateVoiceDocumentRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await _run_agent_for_document(auth_ctx, voice_document_id, request.output_format)
    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])
    return {
        "success": True,
        "document": result.get("data"),
        "draft": result.get("draft"),
        "renderable_content": result.get("renderable_content"),
    }
