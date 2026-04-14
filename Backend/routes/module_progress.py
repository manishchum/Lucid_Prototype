from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional
from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id

from utils.db.module_progress_db import (
    get_progress_by_id,
    get_progress_by_user,
    get_progress_by_processed_module,
    get_progress_by_user_and_module,
    get_progress_by_company,
    create_or_update_progress,
    update_progress,
    delete_progress,
    get_completion_stats
)

router = APIRouter(prefix="/api/module-progress", tags=["module-progress"])


class CreateOrUpdateProgressRequest(BaseModel):
    user_id: str
    processed_module_id: str
    quiz_score: Optional[int] = None
    max_score: Optional[int] = None
    quiz_feedback: Optional[str] = None
    audio_listen_duration: Optional[int] = None
    completed_at: Optional[str] = None
    pass_status: Optional[bool] = None
    viewOnly: Optional[bool] = False
    module_id: Optional[str] = None  # Original module ID for threshold lookup


class UpdateProgressRequest(BaseModel):
    quiz_score: Optional[int] = None
    quiz_feedback: Optional[str] = None
    audio_listen_duration: Optional[int] = None
    completed_at: Optional[str] = None
    pass_status: Optional[bool] = None
    viewed_at: Optional[str] = None


@router.get("/{progress_id}")
async def get_progress_record(
    progress_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get a single module progress record by ID.
    Permission: Self OR manager+ in same company.
    """
    result = await get_progress_by_id(user_id, progress_id)
    
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {"progress": result["data"]}


@router.get("/user/{target_user_id}")
async def get_user_progress(
    target_user_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    completed_only: bool = Query(False)
):
    """
    Get all module progress records for a specific user.
    Permission: Self OR manager+ in same company.
    """
    result = await get_progress_by_user(
        auth_ctx.user_id,
        target_user_id,
        completed_only,
        auth_claims=auth_ctx.claims,
    )
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "progress": result["data"],
        "count": len(result["data"] or [])
    }


@router.get("/module/{processed_module_id}")
async def get_module_progress(
    processed_module_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get all progress records for a specific processed module.
    Permission: Manager+ in the company that owns the module.
    """
    result = await get_progress_by_processed_module(user_id, processed_module_id)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "progress": result["data"],
        "count": len(result["data"] or [])
    }


@router.get("/user/{target_user_id}/module/{processed_module_id}")
async def get_user_module_progress(
    target_user_id: str,
    processed_module_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get progress record for a specific user and processed module.
    Permission: Self OR manager+ in same company.
    """
    result = await get_progress_by_user_and_module(user_id, target_user_id, processed_module_id)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {"progress": result["data"]}


@router.get("/company/{company_id}")
async def get_company_progress(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id),
    target_user_id: Optional[str] = Query(None),
    completed_only: bool = Query(False)
):
    user_id = auth_ctx.user_id
    """
    Get all module progress records for a company.
    Optionally filter by user.
    Permission: Manager+ in the company.
    """
    result = await get_progress_by_company(user_id, effective_company_id, target_user_id, completed_only)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "progress": result["data"],
        "count": len(result["data"] or [])
    }


@router.get("/company/{company_id}/stats")
async def get_company_completion_stats(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    user_id = auth_ctx.user_id
    """
    Get completion statistics for a company.
    Permission: Manager+ in the company.
    """
    result = await get_completion_stats(user_id, effective_company_id)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {"stats": result["data"]}


@router.post("")
async def create_or_update_progress_record(
    request: CreateOrUpdateProgressRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Create or update a module progress record (upsert).
    
    This endpoint handles both creating new progress records and updating existing ones.
    If viewOnly=true and record exists, it won't update - just returns existing.
    
    Permission: Self (for own progress) OR manager+ in same company.
    
    The endpoint automatically:
    - Sets started_at on first creation
    - Calculates pass_status based on quiz_score, max_score, and module threshold
    - Sets completed_at when quiz is submitted
    """
    progress_data = request.dict()
    result = await create_or_update_progress(user_id, progress_data)
    
    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])
    
    action = result.get("action", "updated")
    message_map = {
        "created": "Module progress created successfully",
        "updated": "Module progress updated successfully",
        "view": "Module view logged (already started)",
        "no_change": "No changes to apply"
    }
    
    return {
        "message": message_map.get(action, "Module progress recorded successfully"),
        "progress": result["data"],
        "action": action
    }


@router.put("/{progress_id}")
async def update_progress_record(
    progress_id: str,
    request: UpdateProgressRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update an existing module progress record.
    Permission: Self (for own progress) OR manager+ in same company.
    """
    update_data = request.dict(exclude_none=True)
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    result = await update_progress(user_id, progress_id, update_data)
    
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {
        "message": "Module progress updated successfully",
        "progress": result["data"]
    }


@router.delete("/{progress_id}")
async def delete_progress_record(
    progress_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Delete a module progress record.
    Permission: Manager+ in same company (for data cleanup).
    """
    result = await delete_progress(user_id, progress_id)
    
    if result["error"]:
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {
        "message": "Module progress deleted successfully",
        "progress": result["data"]
    }
