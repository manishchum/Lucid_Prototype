"""
FastAPI routes for learning_plan operations.
"""

from typing import Optional
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from utils.db import learning_plan_db


router = APIRouter(prefix="/api/learning-plans", tags=["learning_plans"])


class CreateLearningPlanRequest(BaseModel):
    user_id: str
    module_id: str
    due_date: Optional[str] = None
    priority: Optional[int] = 1
    status: Optional[str] = "ASSIGNED"
    plan_json: Optional[dict] = None
    reasoning: Optional[dict] = None
    assessment_hash: Optional[str] = None
    processed_module_ids: Optional[list] = None
    baseline_assessment: Optional[bool] = True


class UpdateLearningPlanRequest(BaseModel):
    due_date: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    plan_json: Optional[dict] = None
    reasoning: Optional[dict] = None
    processed_module_ids: Optional[list] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    overall_status: Optional[bool] = None
    baseline_assessment: Optional[bool] = None


class UpdateStatusRequest(BaseModel):
    status: str


@router.get("/")
async def list_learning_plans(
    x_user_id: str = Header(..., alias="X-User-ID"),
    user_id: Optional[str] = None,
    module_id: Optional[str] = None,
    status: Optional[str] = None,
    baseline_assessment: Optional[bool] = None,
    limit: Optional[int] = None
):
    """
    List learning plans with optional filters.
    - Regular users see only their own plans
    - Managers+ see plans from their company
    """
    result = await learning_plan_db.list_learning_plans(
        x_user_id, user_id, module_id, status, baseline_assessment, limit
    )
    
    if result.get("error"):
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "plans": result["data"],
        "count": len(result["data"]) if result["data"] else 0
    }


@router.get("/stats")
async def get_learning_plan_stats(
    x_user_id: str = Header(..., alias="X-User-ID"),
    user_id: Optional[str] = None
):
    """
    Get statistics about learning plans.
    - Users see their own stats
    - Managers+ can see stats for users in their company
    """
    result = await learning_plan_db.get_learning_plan_stats(x_user_id, user_id)
    
    if result.get("error"):
        raise HTTPException(status_code=403, detail=result["error"])
    
    return result["data"]


@router.get("/{learning_plan_id}")
async def get_learning_plan(
    learning_plan_id: str,
    x_user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get a single learning plan by ID.
    - Users can view their own plan
    - Managers+ can view plans from their company
    """
    result = await learning_plan_db.get_learning_plan_by_id(x_user_id, learning_plan_id)
    
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {"plan": result["data"]}


@router.get("/user/{user_id}")
async def get_user_learning_plans(
    user_id: str,
    x_user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get all learning plans for a specific user.
    - Users can view their own plans
    - Managers+ can view plans for users in their company
    """
    result = await learning_plan_db.get_user_learning_plans(x_user_id, user_id)
    
    if result.get("error"):
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "plans": result["data"],
        "count": len(result["data"]) if result["data"] else 0
    }


@router.post("/")
async def create_learning_plan(
    request: CreateLearningPlanRequest,
    x_user_id: str = Header(..., alias="X-User-ID")
):
    """
    Create a new learning plan.
    Permission: Manager+ role required.
    """
    plan_data = request.dict(exclude_none=True)
    
    result = await learning_plan_db.create_learning_plan(x_user_id, plan_data)
    
    if result.get("error"):
        status_code = 400 if "required" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {
        "success": True,
        "plan": result["data"],
        "message": "Learning plan created successfully"
    }


@router.put("/{learning_plan_id}")
async def update_learning_plan(
    learning_plan_id: str,
    request: UpdateLearningPlanRequest,
    x_user_id: str = Header(..., alias="X-User-ID")
):
    """
    Update a learning plan.
    - Users can update their own plan (limited fields)
    - Managers+ can update plans in their company
    """
    updates = request.dict(exclude_none=True)
    
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await learning_plan_db.update_learning_plan(x_user_id, learning_plan_id, updates)
    
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {
        "success": True,
        "plan": result["data"],
        "message": "Learning plan updated successfully"
    }


@router.patch("/{learning_plan_id}/status")
async def update_learning_plan_status(
    learning_plan_id: str,
    request: UpdateStatusRequest,
    x_user_id: str = Header(..., alias="X-User-ID")
):
    """
    Convenient endpoint to update only the status of a learning plan.
    - Users can update their own plan status
    - Managers+ can update status of plans in their company
    """
    result = await learning_plan_db.update_learning_plan(
        x_user_id, 
        learning_plan_id, 
        {"status": request.status}
    )
    
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {
        "success": True,
        "plan": result["data"],
        "message": f"Status updated to {request.status}"
    }


@router.delete("/{learning_plan_id}")
async def delete_learning_plan(
    learning_plan_id: str,
    x_user_id: str = Header(..., alias="X-User-ID")
):
    """
    Delete a learning plan.
    Permission: Manager+ role required.
    """
    result = await learning_plan_db.delete_learning_plan(x_user_id, learning_plan_id)
    
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return result["data"]
