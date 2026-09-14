import os
import re
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from utils.auth import RequestAuth, get_request_auth_required
from utils.supabase_client import supabase_admin

router = APIRouter(
    tags=["Uploads"]
)

# ── File Size Limits (per category) ───────────────────────────────────
# User specifications: Image (5 MB), Audio (25 MB), Video (50 MB)
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024     # 5 MB
MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024    # 25 MB
MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024    # 50 MB

# ── Allowed MIME Types & Category Configuration ───────────────────────
MIME_CONFIG = {
    # Images (Max 5 MB)
    "image/jpeg": {"category": "Image", "max_size": MAX_IMAGE_SIZE_BYTES, "default_ext": ".jpg"},
    "image/jpg": {"category": "Image", "max_size": MAX_IMAGE_SIZE_BYTES, "default_ext": ".jpg"},
    "image/png": {"category": "Image", "max_size": MAX_IMAGE_SIZE_BYTES, "default_ext": ".png"},
    "image/webp": {"category": "Image", "max_size": MAX_IMAGE_SIZE_BYTES, "default_ext": ".webp"},
    "image/gif": {"category": "Image", "max_size": MAX_IMAGE_SIZE_BYTES, "default_ext": ".gif"},
    "image/heic": {"category": "Image", "max_size": MAX_IMAGE_SIZE_BYTES, "default_ext": ".heic"},
    "image/heif": {"category": "Image", "max_size": MAX_IMAGE_SIZE_BYTES, "default_ext": ".heif"},

    # Audio (Max 25 MB)
    "audio/webm": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".webm"},
    "audio/mp4": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".m4a"},
    "audio/m4a": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".m4a"},
    "audio/x-m4a": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".m4a"},
    "audio/mpeg": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".mp3"},
    "audio/mp3": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".mp3"},
    "audio/wav": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".wav"},
    "audio/wave": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".wav"},
    "audio/x-wav": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".wav"},
    "audio/ogg": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".ogg"},
    "audio/aac": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".aac"},
    "audio/3gpp": {"category": "Audio", "max_size": MAX_AUDIO_SIZE_BYTES, "default_ext": ".3gp"},

    # Video (Max 50 MB)
    "video/mp4": {"category": "Video", "max_size": MAX_VIDEO_SIZE_BYTES, "default_ext": ".mp4"},
    "video/quicktime": {"category": "Video", "max_size": MAX_VIDEO_SIZE_BYTES, "default_ext": ".mov"},
    "video/webm": {"category": "Video", "max_size": MAX_VIDEO_SIZE_BYTES, "default_ext": ".webm"},
    "video/3gpp": {"category": "Video", "max_size": MAX_VIDEO_SIZE_BYTES, "default_ext": ".3gp"},
    "video/x-matroska": {"category": "Video", "max_size": MAX_VIDEO_SIZE_BYTES, "default_ext": ".mkv"},
    "video/mpeg": {"category": "Video", "max_size": MAX_VIDEO_SIZE_BYTES, "default_ext": ".mpeg"},
}


def _format_bytes(size_in_bytes: int) -> str:
    """Format bytes to human readable format (e.g. 5 MB, 1.2 MB)."""
    if size_in_bytes >= 1024 * 1024:
        mb = size_in_bytes / (1024 * 1024)
        return f"{mb:.1f} MB".replace(".0 MB", " MB")
    elif size_in_bytes >= 1024:
        kb = size_in_bytes / 1024
        return f"{kb:.1f} KB".replace(".0 KB", " KB")
    return f"{size_in_bytes} Bytes"


def _sanitize_extension(file_name: str, default_ext: str) -> str:
    """Extract and sanitize file extension to prevent path traversal."""
    if "." in file_name:
        ext = file_name.rsplit(".", 1)[-1].strip().lower()
        ext = re.sub(r"[^a-z0-9]", "", ext)
        if ext and len(ext) <= 10:
            return f".{ext}"
    return default_ext


def _validate_and_generate_url(
    file_name: str,
    content_type: str,
    file_size: Optional[int],
    user_id: str,
) -> dict:
    cleaned_mime = (content_type or "").strip().lower().split(";")[0]

    if cleaned_mime not in MIME_CONFIG:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type '{content_type}'. "
                "Allowed formats are images (JPEG, PNG, WebP, GIF, HEIC), "
                "audio (WebM, M4A, MP3, WAV, AAC), and video (MP4, QuickTime, WebM)."
            ),
        )

    config = MIME_CONFIG[cleaned_mime]
    category = config["category"]
    max_size = config["max_size"]

    # Validate file size if provided
    if file_size is not None and file_size > 0:
        if file_size > max_size:
            formatted_actual = _format_bytes(file_size)
            formatted_max = _format_bytes(max_size)
            raise HTTPException(
                status_code=400,
                detail=f"{category} size ({formatted_actual}) exceeds the maximum allowed limit of {formatted_max}.",
            )

    bucket_name = (
        os.getenv("TASK_SUBMISSIONS_BUCKET")
        or os.getenv("SUPABASE_TASK_SUBMISSIONS_BUCKET")
        or "task-submissions"
    )

    clean_ext = _sanitize_extension(file_name or f"file{config['default_ext']}", config["default_ext"])
    unique_file_name = f"{uuid.uuid4()}{clean_ext}"
    file_path = f"{user_id}/{unique_file_name}"

    try:
        res = supabase_admin.storage.from_(bucket_name).create_signed_upload_url(file_path)
        if not res:
            raise Exception("Storage service did not return signed upload URL")

        signed_url = (
            res.get("signedUrl")
            or res.get("signed_url")
            or (res if isinstance(res, str) else None)
        )
        if not signed_url:
            raise Exception("Signed URL not found in storage response")

        public_url = supabase_admin.storage.from_(bucket_name).get_public_url(file_path)

        return {
            "upload_url": signed_url,
            "file_url": public_url,
            "path": file_path,
            "category": category,
            "mime_type": cleaned_mime,
            "max_size_bytes": max_size,
            "max_size_human": _format_bytes(max_size),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate upload URL: {str(e)}")


class PresignedUploadRequest(BaseModel):
    file_name: str = Field(..., description="Original name of the file")
    content_type: str = Field(..., description="MIME type of the file (e.g. image/jpeg)")
    file_size: Optional[int] = Field(None, description="Size of the file in bytes")


@router.get("/generate-upload-url")
async def generate_upload_url_get(
    file_name: str = Query(..., description="Original name of the file"),
    content_type: str = Query(..., description="MIME type (e.g. image/jpeg, audio/m4a, video/mp4)"),
    file_size: Optional[int] = Query(None, description="File size in bytes"),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Generate a pre-signed URL to upload media files directly to Supabase storage.
    Validates MIME type, enforces file size limits (Image 5MB, Audio 25MB, Video 50MB),
    and prevents uploading unauthorized file formats.
    """
    return _validate_and_generate_url(
        file_name=file_name,
        content_type=content_type,
        file_size=file_size,
        user_id=str(auth_ctx.user_id),
    )


@router.post("/generate-upload-url")
@router.post("/uploads/presigned-url")
async def generate_upload_url_post(
    payload: PresignedUploadRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    POST variant for generating pre-signed upload URLs with JSON payload.
    """
    return _validate_and_generate_url(
        file_name=payload.file_name,
        content_type=payload.content_type,
        file_size=payload.file_size,
        user_id=str(auth_ctx.user_id),
    )

