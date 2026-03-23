from fastapi import APIRouter, Header, Query
from pydantic import BaseModel
from typing import Optional, Any, Dict

from utils.db.assessments_db import (
    create_assessment,
    get_assessment_by_id,
    get_assessments_by_company,
    get_assessment_by_filters,
    get_baseline_assessment,
    get_module_assessment,
    update_assessment,
    delete_assessment
)

from utils.exceptions import NotFoundError, ValidationError

router = APIRouter(prefix="/api/assessments", tags=["assessments"])


class CreateAssessmentRequest(BaseModel):
    processed_module_id: Optional[str] = None
    type: str  # 'baseline' or 'module'
    questions: Any  # JSONB field - can be dict or list
    company_id: str
    modules_snapshot: Optional[str] = None
    learning_style: Optional[str] = None
    original_module_id: Optional[str] = None


class UpdateAssessmentRequest(BaseModel):
    processed_module_id: Optional[str] = None
    type: Optional[str] = None
    questions: Optional[Any] = None
    modules_snapshot: Optional[str] = None
    learning_style: Optional[str] = None
    original_module_id: Optional[str] = None


@router.post("/")
async def create_assessment_endpoint(
    request: CreateAssessmentRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Create a new assessment.
    Permission: User must have company access.
    """
    assessment_data = request.dict(exclude_none=True)
    result = await create_assessment(user_id, assessment_data)
    
    # Unwrap service layer response
    assessment = result.get("data") or None
    
    return {
        "success": True,
        "data": assessment,
        "error": result.get("error")
    }


@router.get("/{assessment_id}")
async def get_assessment_endpoint(
    assessment_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get a single assessment by ID.
    Permission: User must have company access.
    """
    result = await get_assessment_by_id(user_id, assessment_id)
    
    # Unwrap service layer response
    assessment = result.get("data") or None
    
    return {
        "success": True,
        "data": assessment,
        "error": result.get("error")
    }


@router.get("/company/{company_id}")
async def get_company_assessments_endpoint(
    company_id: str,
    user_id: str = Header(..., alias="X-User-ID"),
    type: Optional[str] = Query(None, description="Filter by assessment type (baseline/module)")
):
    """
    Get all assessments for a company, optionally filtered by type.
    Permission: Manager+ in the company.
    """
    result = await get_assessments_by_company(user_id, company_id, type)
    
    # Unwrap service layer response
    assessments = result.get("data") or []
    
    return {
        "success": True,
        "data": {"assessments": assessments, "count": len(assessments)},
        "error": result.get("error")
    }


@router.get("/filter/search")
async def filter_assessments_endpoint(
    user_id: str = Header(..., alias="X-User-ID"),
    company_id: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    processed_module_id: Optional[str] = Query(None),
    original_module_id: Optional[str] = Query(None),
    learning_style: Optional[str] = Query(None),
    user_id_filter: Optional[str] = Query(None, description="Filter by user_id via processed_modules")
):
    """
    Get assessments matching specific filters.
    Permission: User must have company access.
    """
    result = await get_assessment_by_filters(
        user_id,
        company_id=company_id,
        assessment_type=type,
        processed_module_id=processed_module_id,
        original_module_id=original_module_id,
        learning_style=learning_style,
        user_id=user_id_filter
    )
    
    # Unwrap service layer response
    assessments = result.get("data") or []
    
    return {
        "success": True,
        "data": {"assessments": assessments, "count": len(assessments)},
        "error": result.get("error")
    }


@router.get("/baseline/{company_id}/{original_module_id}")
async def get_baseline_endpoint(
    company_id: str,
    original_module_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get baseline assessment for a company and module.
    Permission: User must have company access.
    """
    result = await get_baseline_assessment(user_id, company_id, original_module_id)
    
    # Unwrap service layer response
    assessment = result.get("data") or None
    
    return {
        "success": True,
        "data": assessment,
        "error": result.get("error")
    }


@router.get("/module/{processed_module_id}")
async def get_module_assessment_endpoint(
    processed_module_id: str,
    learning_style: str = Query(...),
    target_user_id: str = Query(..., alias="target_user_id"),
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get module assessment for a specific processed module and learning style.
    Permission: Self or manager+.
    """
    result = await get_module_assessment(user_id, processed_module_id, learning_style, target_user_id)
    
    # Unwrap service layer response
    assessment = result.get("data") or None
    
    return {
        "success": True,
        "data": assessment,
        "error": result.get("error")
    }


@router.put("/{assessment_id}")
async def update_assessment_endpoint(
    assessment_id: str,
    request: UpdateAssessmentRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Update an assessment.
    Permission: Manager+ in the same company.
    """
    update_data = request.dict(exclude_none=True)
    
    if not update_data:
        raise ValidationError("No update data provided")
    
    result = await update_assessment(user_id, assessment_id, update_data)
    
    # Unwrap service layer response
    assessment = result.get("data") or None
    
    return {
        "success": True,
        "data": assessment,
        "error": result.get("error")
    }


@router.delete("/{assessment_id}")
async def delete_assessment_endpoint(
    assessment_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Delete an assessment.
    Permission: Admin+ in the same company.
    """
    result = await delete_assessment(user_id, assessment_id)
    
    # Unwrap service layer response
    deleted = result.get("data") or None
    
    return {
        "success": True,
        "data": deleted,
        "error": result.get("error")
    }


