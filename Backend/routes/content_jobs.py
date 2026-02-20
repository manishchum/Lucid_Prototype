from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional

from utils.db.content_jobs_db import (
    get_content_job_by_id,
    list_content_jobs,
    get_content_jobs_by_module,
    create_content_job,
    update_content_job,
    delete_content_job,
    get_content_jobs_stats
)

router = APIRouter(prefix="/api/content-jobs", tags=["content-jobs"])


class CreateContentJobRequest(BaseModel):
    module_id: str
    status: Optional[str] = "pending"


class UpdateContentJobRequest(BaseModel):
    status: Optional[str] = None
    module_id: Optional[str] = None


@router.get("/")
async def list_content_jobs_route(
    user_id: str = Header(..., alias="X-User-ID"),
    status: Optional[str] = Query(None, description="Filter by status (pending, in_progress, completed, failed)"),
    module_id: Optional[str] = Query(None, description="Filter by module_id"),
    limit: Optional[int] = Query(None, description="Limit number of results")
):
    """
    List all content jobs with optional filters.
    Permission: Manager+ can see jobs from their company.
    
    Query parameters:
    - status: Filter by job status
    - module_id: Filter by specific module
    - limit: Limit number of results
    """
    result = await list_content_jobs(user_id, status, module_id, limit)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {
        "jobs": result["data"],
        "count": len(result["data"] or [])
    }


@router.get("/stats")
async def get_stats_route(
    user_id: str = Header(..., alias="X-User-ID"),
    company_id: Optional[str] = Query(None, description="Company ID (defaults to user's company)")
):
    """
    Get content jobs statistics (counts by status).
    Permission: Manager+ can see stats for their company.
    """
    result = await get_content_jobs_stats(user_id, company_id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"stats": result["data"]}


@router.get("/{job_id}")
async def get_content_job_route(
    job_id: int,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get a single content job by ID.
    Permission: Manager+ in the same company as the module.
    """
    result = await get_content_job_by_id(user_id, job_id)
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    return {"job": result["data"]}


@router.get("/module/{module_id}")
async def get_module_jobs_route(
    module_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get all content jobs for a specific module.
    Permission: Manager+ in the same company as the module.
    """
    result = await get_content_jobs_by_module(user_id, module_id)
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    return {
        "jobs": result["data"],
        "count": len(result["data"] or []),
        "module_id": module_id
    }


@router.post("/")
async def create_content_job_route(
    request: CreateContentJobRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Create a new content job.
    Permission: Manager+ in the same company as the module.
    
    Request body:
    - module_id: UUID of the training module (required)
    - status: Initial status (default: "pending")
    """
    job_data = request.dict()
    result = await create_content_job(user_id, job_data)
    if result["error"]:
        if "required" in result["error"].lower():
            raise HTTPException(status_code=400, detail=result["error"])
        raise HTTPException(status_code=403, detail=result["error"])
    return {
        "job": result["data"],
        "message": "Content job created successfully"
    }


@router.put("/{job_id}")
async def update_content_job_route(
    job_id: int,
    request: UpdateContentJobRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Update an existing content job.
    Permission: Manager+ in the same company as the module.
    
    Common use case: Update status as job progresses
    Valid status values: pending, in_progress, completed, failed
    """
    updates = {k: v for k, v in request.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await update_content_job(user_id, job_id, updates)
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    return {
        "job": result["data"],
        "message": "Content job updated successfully"
    }


@router.delete("/{job_id}")
async def delete_content_job_route(
    job_id: int,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Delete a content job.
    Permission: Company admin in the same company as the module.
    """
    result = await delete_content_job(user_id, job_id)
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    return {"message": "Content job deleted successfully"}


@router.patch("/{job_id}/status")
async def update_job_status_route(
    job_id: int,
    status: str = Query(..., description="New status (pending, in_progress, completed, failed)"),
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Convenient endpoint to update only the status of a content job.
    Permission: Manager+ in the same company as the module.
    """
    # Validate status
    valid_statuses = ["pending", "in_progress", "completed", "failed"]
    if status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
        )
    
    result = await update_content_job(user_id, job_id, {"status": status})
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    return {
        "job": result["data"],
        "message": f"Status updated to '{status}' successfully"
    }
