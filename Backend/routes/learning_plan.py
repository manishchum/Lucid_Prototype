"""
FastAPI routes for learning_plan operations.
"""

from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from utils.auth import RequestAuth, get_request_auth_required
from utils.db import learning_plan_db
from utils.redis_client import get_cache, set_cache, redis_client, delete_cache_pattern

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
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
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
    cache_key = (f"learning plans:"
                 f"users={auth_ctx.user_id}:"
                 f"target={user_id}:"
                 f"module={module_id}:"
                 f"status={status}"
                 )
    
    cached = get_cache(cache_key)
    
    if cached:
        print("LEARNING PLAN CACHE HIT", cache_key)
        return cached
    
    result = await learning_plan_db.list_learning_plans(
        auth_ctx.user_id, user_id, module_id, status, baseline_assessment, limit
    )
    
    if result.get("error"):
        raise HTTPException(status_code=403, detail=result["error"])
    
    response_payload = {
       "plans": result["data"],
       "count": len(result["data"]) if result["data"] else 0
    }
    
    set_cache(cache_key, response_payload, ttl=300)
    return response_payload
    


@router.get("/stats")
async def get_learning_plan_stats(
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    user_id: Optional[str] = None
):
    """
    Get statistics about learning plans.
    - Users see their own stats
    - Managers+ can see stats for users in their company
    """
    result = await learning_plan_db.get_learning_plan_stats(auth_ctx.user_id, user_id)
    
    if result.get("error"):
        raise HTTPException(status_code=403, detail=result["error"])
    
    return result["data"]


@router.get("/{learning_plan_id}")
async def get_learning_plan(
    learning_plan_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Get a single learning plan by ID.
    - Users can view their own plan
    - Managers+ can view plans from their company
    """
    result = await learning_plan_db.get_learning_plan_by_id(auth_ctx.user_id, learning_plan_id)
    
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {"plan": result["data"]}


@router.get("/user/{user_id}")
async def get_user_learning_plans(
    user_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Get all learning plans for a specific user.
    - Users can view their own plans
    - Managers+ can view plans for users in their company
    """
    result = await learning_plan_db.get_user_learning_plans(auth_ctx.user_id, user_id)
    
    if result.get("error"):
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "plans": result["data"],
        "count": len(result["data"]) if result["data"] else 0
    }


@router.post("/")
async def create_learning_plan(
    request: CreateLearningPlanRequest,
    x_auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = x_auth_ctx.user_id
    """
    Create a new learning plan.
    Permission: Manager+ role required.
    """
    plan_data = request.dict(exclude_none=True)
    
    result = await learning_plan_db.create_learning_plan(user_id, plan_data)
    
    if result.get("error"):
        status_code = 400 if "required" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    delete_cache_pattern(f"learning plans:{user_id}:*")
    return {
        "success": True,
        "plan": result["data"],
        "message": "Learning plan created successfully"
    }


@router.put("/{learning_plan_id}")
async def update_learning_plan(
    learning_plan_id: str,
    request: UpdateLearningPlanRequest,
    x_auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = x_auth_ctx.user_id
    """
    Update a learning plan.
    - Users can update their own plan (limited fields)
    - Managers+ can update plans in their company
    """
    updates = request.dict(exclude_none=True)
    delete_cache_pattern(f"learning plans:{user_id}:*")
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await learning_plan_db.update_learning_plan(user_id, learning_plan_id, updates)
    
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
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Convenient endpoint to update only the status of a learning plan.
    - Users can update their own plan status
    - Managers+ can update status of plans in their company
    """
    result = await learning_plan_db.update_learning_plan(
        auth_ctx.user_id, 
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
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Delete a learning plan.
    Permission: Manager+ role required.
    """
    result = await learning_plan_db.delete_learning_plan(auth_ctx.user_id, learning_plan_id)
    delete_cache_pattern(f"learning plans:{auth_ctx.user_id}:*")
    if result.get("error"):
        status_code = 404 if "not found" in result["error"].lower() else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return result["data"]
