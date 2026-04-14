from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, Dict, Any
from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id

from utils.db.employee_assessment_db import (
    get_employee_assessment_by_id,
    get_employee_assessments_by_user,
    get_employee_assessments_by_assessment,
    get_employee_assessments_by_company,
    create_employee_assessment,
    update_employee_assessment,
    delete_employee_assessment,
    get_assessment_statistics
)

from utils.exceptions import NotFoundError, ValidationError

router = APIRouter(prefix="/api/employee-assessments", tags=["employee-assessments"])


class CreateEmployeeAssessmentRequest(BaseModel):
    user_id: str
    assessment_id: str
    answers: Dict[str, Any]
    score: Optional[int] = None
    max_score: Optional[int] = None
    feedback: Optional[str] = None
    question_feedback: Optional[str] = None


class UpdateEmployeeAssessmentRequest(BaseModel):
    answers: Optional[Dict[str, Any]] = None
    score: Optional[int] = None
    max_score: Optional[int] = None
    feedback: Optional[str] = None
    question_feedback: Optional[str] = None


@router.get("/{employee_assessment_id}")
async def get_employee_assessment(
    employee_assessment_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Get a single employee assessment by ID.
    Permission: Self OR manager+ in same company.
    """
    result = await get_employee_assessment_by_id(auth_ctx.user_id, employee_assessment_id)
    
    # Unwrap service layer response
    assessment = result.get("data") or None
    
    return {
        "success": True,
        "data": assessment,
        "error": result.get("error")
    }


@router.get("/user/{target_user_id}")
async def get_user_assessments(
    target_user_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    assessment_id: Optional[str] = Query(None, description="Filter by assessment ID"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of results")
):
    """
    Get all employee assessments for a specific user.
    Permission: Self OR manager+ in same company.
    
    Query Parameters:
        - assessment_id: Optional filter by assessment ID
        - limit: Maximum number of results (default: 100, max: 500)
    """
    result = await get_employee_assessments_by_user(auth_ctx.user_id, target_user_id, assessment_id, limit)
    
    # Unwrap service layer response
    assessments = result.get("data") or []
    
    return {
        "success": True,
        "data": {"assessments": assessments, "count": len(assessments)},
        "error": result.get("error")
    }


@router.get("/assessment/{assessment_id}")
async def get_assessments_by_assessment(
    assessment_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of results")
):
    """
    Get all employee assessments for a specific assessment.
    Permission: Manager+ in the company that owns the assessment.
    
    Query Parameters:
        - limit: Maximum number of results (default: 100, max: 500)
    """
    result = await get_employee_assessments_by_assessment(auth_ctx.user_id, assessment_id, limit)
    
    # Unwrap service layer response
    assessments = result.get("data") or []
    
    return {
        "success": True,
        "data": {"assessments": assessments, "count": len(assessments)},
        "error": result.get("error")
    }


@router.get("/assessment/{assessment_id}/statistics")
async def get_assessment_stats(
    assessment_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Get statistics for an assessment (average score, completion rate, etc.).
    Permission: Manager+ in the company that owns the assessment.
    """
    result = await get_assessment_statistics(auth_ctx.user_id, assessment_id)
    
    # Unwrap service layer response
    stats = result.get("data") or None
    
    return {
        "success": True,
        "data": stats,
        "error": result.get("error")
    }


@router.get("/company/{company_id}")
async def get_company_assessments(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id),
    target_user_id: Optional[str] = Query(None, alias="user_id", description="Filter by user ID"),
    assessment_id: Optional[str] = Query(None, description="Filter by assessment ID"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of results")
):
    """
    Get all employee assessments for a company.
    Permission: Manager+ in the company.

    Query Parameters:
        - user_id: Optional filter by user ID
        - assessment_id: Optional filter by assessment ID
        - limit: Maximum number of results (default: 100, max: 500)
    """
    result = await get_employee_assessments_by_company(
        auth_ctx.user_id, effective_company_id, target_user_id, assessment_id, limit
    )
    
    # Unwrap service layer response
    assessments = result.get("data") or []
    
    return {
        "success": True,
        "data": {"assessments": assessments, "count": len(assessments)},
        "error": result.get("error")
    }


@router.post("/")
async def create_assessment(
    request: CreateEmployeeAssessmentRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Create a new employee assessment.
    Permission: Self (user can only create their own assessment) OR admin+.
    
    Request Body:
        - user_id: User taking the assessment (required)
        - assessment_id: Assessment being taken (required)
        - answers: JSON object containing user's answers (required)
        - score: Numeric score (optional)
        - max_score: Maximum possible score (optional)
        - feedback: Overall feedback text (optional)
        - question_feedback: Question-specific feedback (optional)
    """
    assessment_data = request.dict()
    result = await create_employee_assessment(auth_ctx.user_id, assessment_data)
    
    # Unwrap service layer response
    assessment = result.get("data") or None
    if assessment and isinstance(assessment, list):
        assessment = assessment[0]
    
    return {
        "success": True,
        "data": assessment,
        "error": result.get("error")
    }


@router.patch("/{employee_assessment_id}")
async def update_assessment(
    employee_assessment_id: str,
    request: UpdateEmployeeAssessmentRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Update an employee assessment.
    Permission: Self OR admin+ in same company.
    
    Request Body:
        - answers: Updated answers (optional)
        - score: Updated score (optional)
        - max_score: Updated max score (optional)
        - feedback: Updated feedback (optional)
        - question_feedback: Updated question feedback (optional)
    
    Note: user_id and assessment_id cannot be updated.
    """
    update_data = request.dict(exclude_unset=True)
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    result = await update_employee_assessment(auth_ctx.user_id, employee_assessment_id, update_data)
    
    # Unwrap service layer response
    assessment = result.get("data") or None
    if assessment and isinstance(assessment, list):
        assessment = assessment[0]
    
    return {
        "success": True,
        "data": assessment,
        "error": result.get("error")
    }


@router.delete("/{employee_assessment_id}")
async def delete_assessment(
    employee_assessment_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Delete an employee assessment.
    Permission: Admin+ in same company.
    """
    result = await delete_employee_assessment(auth_ctx.user_id, employee_assessment_id)
    
    return {
        "success": True,
        "data": None,
        "error": None
    }
