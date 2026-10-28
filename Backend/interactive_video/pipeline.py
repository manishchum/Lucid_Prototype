"""
Interactive Video Generation Pipeline.
Orchestrates the modern, consolidated, avatar-free video generation workflow:
Stage 1: Document Parsing (document_parser.py)
Stage 2: Course Planning & Scripting (planner.py)
Stage 3: Slide Rendering & Branding (slide_renderer.py)
Stage 4: Multi-Language Voice Synthesis (voice_generator.py)
Stage 5: Video Composition & Concatenation (composer.py)
Stage 6: Publishing & Storage (publisher.py)
"""
from __future__ import annotations
import os
import shutil
import tempfile
import traceback
import datetime
import logging
from typing import Optional
from utils.supabase_client import supabase_admin as supabase

from interactive_video.document_parser import parse_document_context
from interactive_video.planner import generate_course_manifest
from interactive_video.slide_renderer import render_course_slides_async
from interactive_video.voice_generator import synthesize_course_audio
from interactive_video.composer import compose_course_videos
from interactive_video.publisher import publish_course

logger = logging.getLogger("interactive_video.pipeline")

PIPELINE_STAGES = {
    1: "Document Parsing",
    2: "Course Planning",
    3: "Slide Rendering",
    4: "Voice Synthesis",
    5: "Video Composition",
    6: "Course Publishing"
}


def update_job_status(job_id: str, status: str, current_stage: int, error: Optional[str] = None):
    """Updates job progress and status in Supabase table interactive_video_jobs."""
    try:
        supabase.table("interactive_video_jobs").update({
            "status": status,
            "current_worker": current_stage,
            "error": error,
            "updated_at": datetime.datetime.utcnow().isoformat()
        }).eq("id", job_id).execute()
    except Exception as exc:
        logger.warning(f"[Pipeline] Failed to update status for job {job_id}: {exc}")


async def run_pipeline(job_id: str, processed_module_id: str) -> bool:
    """
    Executes the complete interactive video generation pipeline in a managed
    temporary workspace, reporting granular stage updates.
    """
    logger.info(f"[Pipeline] Starting interactive video pipeline for job {job_id} (Module: {processed_module_id})...")
    tmp_dir = tempfile.mkdtemp(prefix=f"interactive_vid_{job_id}_")
    slides_dir = os.path.join(tmp_dir, "slides")
    audio_dir = os.path.join(tmp_dir, "audio")
    video_dir = os.path.join(tmp_dir, "video")

    success = True
    try:
        # Stage 1: Document Parsing & Metadata Ingestion
        update_job_status(job_id, "parsing_document", 1)
        doc_context = await parse_document_context(processed_module_id)

        # Stage 2: Course Planning & AI Scripting (Single-Shot Gateway)
        update_job_status(job_id, "planning_course", 2)
        manifest = await generate_course_manifest(doc_context)

        # Stage 3: Slide Rendering with Company Logo Watermark & Glassmorphism
        update_job_status(job_id, "rendering_slides", 3)
        manifest = await render_course_slides_async(manifest, doc_context, output_dir=slides_dir, enable_usage_logging=True)

        # Stage 4: High-Definition Chirp Voice Synthesis (EN & Hinglish)
        update_job_status(job_id, "synthesizing_voice", 4)
        manifest = await synthesize_course_audio(manifest, doc_context, output_dir=audio_dir, enable_usage_logging=True)

        # Stage 5: Video Composition & Concatenation (Ken Burns zoompan, slide overlay, FFmpeg)
        update_job_status(job_id, "composing_video", 5)
        manifest = await compose_course_videos(manifest, output_dir=video_dir)

        # Stage 6: Supabase Storage Upload & Course Publishing
        update_job_status(job_id, "publishing_course", 6)
        manifest = await publish_course(manifest, enable_db_write=True)

        # Mark job as completed
        update_job_status(job_id, "completed", 6)
        supabase.table("interactive_video_jobs").update({
            "job_metadata": {
                "course_id": manifest.course_id,
                "total_segments": len(manifest.segments),
                "video_url_en": manifest.video_url,
                "video_url_hi": manifest.video_url_hinglish,
                "duration_minutes": manifest.estimated_duration_minutes,
            }
        }).eq("id", job_id).execute()

        logger.info(f"[Pipeline] Job {job_id} completed successfully!")

    except Exception as exc:
        success = False
        tb = traceback.format_exc()
        logger.error(f"[Pipeline] Job {job_id} failed with error:\n{tb}")
        update_job_status(job_id, "failed", 0, str(exc))

    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            logger.info(f"[Pipeline] Cleaned up temporary workspace {tmp_dir}")
        except Exception as cleanup_err:
            logger.warning(f"[Pipeline] Failed to clean up temp dir {tmp_dir}: {cleanup_err}")

    return success
