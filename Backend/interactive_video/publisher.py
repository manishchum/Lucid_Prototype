"""
Course Publisher (Day 8: publisher.py)
Uploads rendered MP4 video assets to Supabase Storage bucket `module-visuals`,
generates public URLs, and (when enabled) saves the course manifest and links it
to the processed module in Supabase.

NOTE: Includes an explicit `enable_db_write` parameter (defaults to False for tests
to strictly follow the rule: NEVER EXECUTE WRITE/DELETE QUERY IN DB DURING TESTING).
"""
from __future__ import annotations
import os
import logging
import datetime
from typing import Optional
from fastapi.concurrency import run_in_threadpool
from utils.supabase_client import supabase_admin

from interactive_video.models import CourseManifest

logger = logging.getLogger("interactive_video.publisher")

BUCKET = "module-visuals"


def ensure_bucket_exists_sync() -> bool:
    """Ensures that the module-visuals storage bucket exists."""
    try:
        buckets = supabase_admin.storage.list_buckets()
        def get_bname(b):
            return getattr(b, "name", None) or (b.get("name") if isinstance(b, dict) else None)
        if buckets and any(get_bname(b) == BUCKET for b in buckets):
            return True
        supabase_admin.storage.create_bucket(BUCKET, options={"public": True, "file_size_limit": "250MB"})
        return True
    except Exception as exc:
        logger.warning(f"[Publisher] Bucket verification note: {exc}")
        return False


def upload_file_sync(local_path: str, upload_path: str, content_type: str = "video/mp4") -> str:
    """Uploads a local file to Supabase Storage and returns its public URL."""
    if not os.path.exists(local_path):
        raise FileNotFoundError(f"Cannot upload non-existent file: {local_path}")

    with open(local_path, "rb") as f:
        file_bytes = f.read()

    upload_path = upload_path.replace("\\", "/").lstrip("/")

    supabase_admin.storage.from_(BUCKET).upload(
        path=upload_path,
        file=file_bytes,
        file_options={"content-type": content_type, "upsert": "true"}
    )

    url_obj = supabase_admin.storage.from_(BUCKET).get_public_url(upload_path)
    if isinstance(url_obj, dict):
        url = url_obj.get("publicURL") or url_obj.get("publicUrl") or url_obj.get("signedURL") or ""
    else:
        url = str(url_obj)

    logger.info(f"[Publisher] Uploaded {local_path} -> {url}")
    return url


async def publish_course(
    manifest: CourseManifest,
    enable_db_write: bool = False,
) -> CourseManifest:
    """
    Uploads all segment MP4s and final course MP4s to Supabase Storage.
    Updates URLs on manifest and segments.
    
    If enable_db_write is True (production only), saves manifest in
    `interactive_video_courses` and updates `processed_modules`.
    """
    await run_in_threadpool(ensure_bucket_exists_sync)

    module_id = manifest.processed_module_id
    course_id = manifest.course_id

    # 1. Upload segment videos
    for i, seg in enumerate(manifest.segments):
        seg_id = seg.id or f"seg_{i + 1}"

        # Upload EN segment video
        if seg.video_en_path and os.path.exists(seg.video_en_path):
            remote_path = f"{module_id}/interactive/segments/{course_id}_{seg_id}_en.mp4"
            url_en = await run_in_threadpool(upload_file_sync, seg.video_en_path, remote_path)
            seg.video_url_en = url_en

        # Upload HI segment video
        if seg.video_hi_path and os.path.exists(seg.video_hi_path):
            remote_path = f"{module_id}/interactive/segments/{course_id}_{seg_id}_hi.mp4"
            url_hi = await run_in_threadpool(upload_file_sync, seg.video_hi_path, remote_path)
            seg.video_url_hi = url_hi

    # 2. Upload concatenated course videos (final_en.mp4, final_hinglish.mp4)
    if manifest.final_video_en_path and os.path.exists(manifest.final_video_en_path):
        remote_path = f"{module_id}/interactive/final_en.mp4"
        url_final_en = await run_in_threadpool(upload_file_sync, manifest.final_video_en_path, remote_path)
        manifest.video_url = url_final_en

    if manifest.final_video_hi_path and os.path.exists(manifest.final_video_hi_path):
        remote_path = f"{module_id}/interactive/final_hinglish.mp4"
        url_final_hi = await run_in_threadpool(upload_file_sync, manifest.final_video_hi_path, remote_path)
        manifest.video_url_hinglish = url_final_hi

    manifest.created_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    # 3. Save to database if explicitly permitted (production workflow)
    if enable_db_write:
        logger.info(f"[Publisher] Saving course manifest to database for module {module_id}...")
        course_resp = supabase_admin.table("interactive_video_courses").upsert({
            "processed_module_id": module_id,
            "manifest": manifest.model_dump(),
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }, on_conflict="processed_module_id").execute()

        interactive_video_id = None
        if course_resp.data:
            interactive_video_id = course_resp.data[0].get("id")

        # Update existing columns on processed_modules:
        # - video_url: English video public URL
        # - video_url_hinglish: Hinglish video public URL
        # - video_generated_at: UTC timestamp
        # - video_status: "completed"
        # - interactive_video_id: foreign key to interactive_video_courses
        now_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()
        update_payload = {
            "video_url": manifest.video_url,
            "video_url_hinglish": manifest.video_url_hinglish,
            "video_generated_at": now_utc,
            "video_status": "completed",
        }
        if interactive_video_id:
            update_payload["interactive_video_id"] = interactive_video_id

        supabase_admin.table("processed_modules").update(update_payload).eq("processed_module_id", module_id).execute()
        logger.info(f"[Publisher] Database updated successfully for module {module_id} (existing columns only).")
    else:
        logger.info("[Publisher] enable_db_write is False; skipped database mutations.")

    return manifest
