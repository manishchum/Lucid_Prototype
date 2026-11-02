"""
FastAPI router for Interactive Video operations.
Exposes endpoints for starting jobs, polling status, and fetching course manifests.
"""
from __future__ import annotations
import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from utils.auth import RequestAuth, get_request_auth_required
from utils.supabase_client import supabase_admin as supabase

from .models import StartJobRequest
from .pipeline import run_pipeline, PIPELINE_STAGES

router = APIRouter(prefix="/api/interactive-video", tags=["interactive-video"])

IN_PROGRESS_STATUSES = [
    "pending",
    "parsing_document",
    "planning_course",
    "rendering_slides",
    "synthesizing_voice",
    "composing_video",
    "publishing_course",
    # Legacy worker statuses for graceful backwards compatibility
    "w1_parsing", "w2_topics", "w3_designing", "w4_storyboarding",
    "w5_slides", "w6_voice", "w7_avatar", "w8_quiz", "w9_publishing"
]


@router.post("/start")
async def start_job(
    request: StartJobRequest,
    background_tasks: BackgroundTasks,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Enqueues/starts an interactive video creation job for the given processed_module_id.
    """
    module_id = request.processed_module_id

    # 1. Verify module exists
    module_resp = supabase.table("processed_modules").select("processed_module_id").eq("processed_module_id", module_id).maybe_single().execute()
    if not module_resp.data:
        raise HTTPException(status_code=404, detail="Processed module not found")

    # 2. Check if a job is already running
    if not request.force_regenerate:
        existing = supabase.table("interactive_video_jobs").select("*")\
            .eq("processed_module_id", module_id)\
            .in_("status", IN_PROGRESS_STATUSES)\
            .limit(1).execute()
        if existing.data:
            return {
                "message": "Job already in progress",
                "job_id": existing.data[0]["id"],
                "status": existing.data[0]["status"]
            }

    # 3. Create a new job record
    job_resp = supabase.table("interactive_video_jobs").insert({
        "processed_module_id": module_id,
        "status": "pending",
        "current_worker": 1
    }).execute()

    if not job_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create job record")

    job_id = job_resp.data[0]["id"]

    # 4. Trigger background orchestrator pipeline
    background_tasks.add_task(run_pipeline, job_id, module_id)

    return {
        "message": "Interactive video generation started",
        "job_id": job_id,
        "status": "pending"
    }


@router.get("/status/{job_id}")
async def get_job_status(
    job_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """Returns the status and current stage progress of a job."""
    job_resp = supabase.table("interactive_video_jobs").select("*").eq("id", job_id).maybe_single().execute()
    if not job_resp.data:
        raise HTTPException(status_code=404, detail="Job not found")

    job = job_resp.data
    stage_name = PIPELINE_STAGES.get(job["current_worker"], "Processing")

    return {
        "job_id": job["id"],
        "processed_module_id": job["processed_module_id"],
        "status": job["status"],
        "current_worker": job["current_worker"],
        "stage_name": stage_name,
        "error": job.get("error"),
        "job_metadata": job.get("job_metadata", {}),
        "created_at": job["created_at"],
        "updated_at": job["updated_at"]
    }


@router.get("/course/{module_id}")
async def get_course_manifest(
    module_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Fetches the interactive video course manifest for a module.
    Works with both original_module_id and processed_module_id.
    """
    # 1. Try directly fetching by processed_module_id
    course_resp = supabase.table("interactive_video_courses").select("*").eq("processed_module_id", module_id).maybe_single().execute()

    # 2. If not found, look up processed_module_id from original_module_id
    if not course_resp.data:
        pm_resp = supabase.table("processed_modules").select("processed_module_id").eq("original_module_id", module_id).limit(1).execute()
        if pm_resp.data:
            actual_id = pm_resp.data[0]["processed_module_id"]
            course_resp = supabase.table("interactive_video_courses").select("*").eq("processed_module_id", actual_id).maybe_single().execute()

    if not course_resp.data:
        job_resp = supabase.table("interactive_video_jobs").select("id, status")\
            .eq("processed_module_id", module_id)\
            .order("created_at", desc=True)\
            .limit(1).execute()

        job_status = job_resp.data[0] if job_resp.data else None

        return JSONResponse(
            status_code=404,
            content={
                "error": "Interactive course not found",
                "in_progress_job": job_status
            }
        )

    return course_resp.data["manifest"]
