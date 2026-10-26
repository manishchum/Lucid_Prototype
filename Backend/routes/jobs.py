"""
Route for polling and retrieving AI background job status and results.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Optional

from utils.ai_job_manager import get_ai_job
from utils.auth import RequestAuth, get_request_auth_optional

router = APIRouter(prefix="/jobs", tags=["ai-jobs"])


@router.get("/{job_id}")
async def get_job_status(
    job_id: str,
    auth_ctx: Optional[RequestAuth] = Depends(get_request_auth_optional),
):
    """
    Poll the status and result of a long-running AI job.
    Returns: status ('pending' | 'processing' | 'completed' | 'failed'), progress (0-100), result, and error.
    """
    job = await get_ai_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired")

    return {
        "id": job.get("id"),
        "job_type": job.get("job_type"),
        "status": job.get("status", "pending"),
        "progress": job.get("progress", 0),
        "result": job.get("result"),
        "error": job.get("error"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }
