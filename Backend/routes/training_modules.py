from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional
from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id

from utils.db.training_modules_db import (
    get_training_modules_by_company,
    get_training_module_by_id,
    create_training_module,
    update_training_module,
    delete_training_module,
    get_training_modules_by_uploader,
    update_module_processing_status,
    update_module_review_stage
)

router = APIRouter(prefix="/api/training-modules", tags=["training_modules"])


class CreateTrainingModuleRequest(BaseModel):
    company_id: str
    title: str
    description: Optional[str] = None
    content_type: Optional[str] = None
    content_url: Optional[str] = None
    threshold_value: Optional[int] = 70
    additional_readings: Optional[dict] = None


class UpdateTrainingModuleRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    content_type: Optional[str] = None
    content_url: Optional[str] = None
    gpt_summary: Optional[str] = None
    transcription: Optional[str] = None
    ai_modules: Optional[str] = None
    ai_topics: Optional[str] = None
    ai_objectives: Optional[str] = None
    threshold_value: Optional[int] = None
    additional_readings: Optional[dict] = None


class UpdateProcessingStatusRequest(BaseModel):
    processing_status: str
    gpt_summary: Optional[str] = None
    transcription: Optional[str] = None
    ai_modules: Optional[str] = None
    ai_topics: Optional[str] = None
    ai_objectives: Optional[str] = None


class UpdateReviewStageRequest(BaseModel):
    review_stage: str
    reviewer_id: Optional[str] = None


@router.get("/company/{company_id}")
async def list_training_modules(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id),
    processing_status: Optional[str] = Query(None),
    review_stage: Optional[str] = Query(None)
):
    """
    List all training modules for a company.
    Permission: Any user in the company can view modules.
    Optional filters: processing_status, review_stage
    """
    result = await get_training_modules_by_company(
        auth_ctx.user_id,
        effective_company_id,
        processing_status=processing_status,
        review_stage=review_stage,
        auth_claims=auth_ctx.claims,
    )
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "modules": result["data"] or [],
        "count": len(result["data"] or [])
    }


@router.get("/uploader/{uploader_id}")
async def list_modules_by_uploader(
    uploader_id: str,
    company_id: str = Query(...),
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    List all training modules uploaded by a specific user.
    Permission: Any user in the company can view.
    """
    result = await get_training_modules_by_uploader(user_id, uploader_id, company_id)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "modules": result["data"] or [],
        "count": len(result["data"] or [])
    }


@router.get("/{module_id}")
async def get_module(
    module_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Get a specific training module by ID.
    Permission: Any user in the company can view.
    """
    result = await get_training_module_by_id(auth_ctx.user_id, module_id, auth_claims=auth_ctx.claims)
    
    if result["error"]:
        status_code = 404 if result["error"] == "Training module not found" else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {"module": result["data"]}


@router.post("/")
async def create_module(
    request: CreateTrainingModuleRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Create a new training module.
    Permission: Manager+ in the same company.
    """
    module_data = request.dict()
    result = await create_training_module(user_id, module_data)
    
    if result["error"]:
        error_message = result["error"]
        if isinstance(error_message, str) and error_message.startswith("RATE_LIMIT_EXCEEDED:"):
            raise HTTPException(status_code=429, detail=error_message.replace("RATE_LIMIT_EXCEEDED:", "").strip())
        raise HTTPException(status_code=403, detail=error_message)
    
    return {
        "message": "Training module created successfully",
        "module": result["data"]
    }


@router.put("/{module_id}")
async def update_module(
    module_id: str,
    request: UpdateTrainingModuleRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update an existing training module.
    Permission: Manager+ in same company OR the uploader themselves.
    """
    updates = request.dict(exclude_unset=True)
    result = await update_training_module(user_id, module_id, updates)
    
    if result["error"]:
        status_code = 404 if result["error"] == "Training module not found" else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {
        "message": "Training module updated successfully",
        "module": result["data"]
    }


@router.patch("/{module_id}/processing-status")
async def update_processing_status(
    module_id: str,
    request: UpdateProcessingStatusRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update the processing status and AI-generated fields of a training module.
    Permission: Manager+ in the same company.
    """
    processing_status = request.processing_status
    additional_updates = request.dict(exclude={'processing_status'}, exclude_unset=True)
    
    result = await update_module_processing_status(
        user_id, 
        module_id, 
        processing_status,
        additional_updates if additional_updates else None
    )
    
    if result["error"]:
        status_code = 404 if result["error"] == "Training module not found" else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {
        "message": "Processing status updated successfully",
        "module": result["data"]
    }


@router.patch("/{module_id}/review-stage")
async def update_review_stage(
    module_id: str,
    request: UpdateReviewStageRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update the review stage of a training module.
    Permission: Manager+ in the same company.
    """
    result = await update_module_review_stage(
        user_id,
        module_id,
        request.review_stage,
        request.reviewer_id
    )
    
    if result["error"]:
        status_code = 404 if result["error"] == "Training module not found" else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {
        "message": "Review stage updated successfully",
        "module": result["data"]
    }


@router.delete("/{module_id}")
async def delete_module(
    module_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Delete a training module.
    Permission: Company admin+ only.
    """
    result = await delete_training_module(user_id, module_id)
    
    if result["error"]:
        status_code = 404 if result["error"] == "Training module not found" else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {
        "message": "Training module deleted successfully"
    }
