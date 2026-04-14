from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional

from utils.db.learning_style_db import (
    get_learning_style_by_user_id,
    get_learning_styles_by_company,
    create_learning_style,
    update_learning_style,
    upsert_learning_style,
    delete_learning_style
)

router = APIRouter(prefix="/api/learning-styles", tags=["learning-styles"])


class CreateLearningStyleRequest(BaseModel):
    user_id: str
    answers: dict
    learning_style: Optional[str] = ""
    gpt_analysis: Optional[str] = None


class UpdateLearningStyleRequest(BaseModel):
    answers: Optional[dict] = None
    learning_style: Optional[str] = None
    gpt_analysis: Optional[str] = None


class UpsertLearningStyleRequest(BaseModel):
    user_id: str
    answers: dict
    learning_style: Optional[str] = ""
    gpt_analysis: Optional[str] = None


@router.get("/user/{target_user_id}")
async def get_user_learning_style(
    target_user_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get learning style for a specific user.
    Permission: Self OR manager+ in same company.
    """
    result = await get_learning_style_by_user_id(user_id, target_user_id)
    
    if result["error"]:
        status_code = 404 if result["error"] == "User not found" else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {"learning_style": result["data"]}


@router.get("/company/{company_id}")
async def list_company_learning_styles(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id)
):
    user_id = auth_ctx.user_id
    """
    Get all learning styles for users in a company.
    Permission: Manager+ in the same company.
    """
    result = await get_learning_styles_by_company(user_id, effective_company_id)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "learning_styles": result["data"] or [],
        "count": len(result["data"] or [])
    }


@router.post("/")
async def create_learning_style_record(
    request: CreateLearningStyleRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Create a new learning style record.
    Permission: Self (creating own record) OR company_admin+ in same company.
    """
    learning_style_data = {
        "user_id": request.user_id,
        "answers": request.answers,
        "learning_style": request.learning_style,
        "gpt_analysis": request.gpt_analysis
    }
    
    result = await create_learning_style(user_id, learning_style_data)
    
    if result["error"]:
        status_code = 400 if "already exists" in result["error"] else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {"learning_style": result["data"]}


@router.put("/user/{target_user_id}")
async def update_user_learning_style(
    target_user_id: str,
    request: UpdateLearningStyleRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update an existing learning style record.
    Permission: Self OR company_admin+ in same company.
    """
    updates = {}
    if request.answers is not None:
        updates["answers"] = request.answers
    if request.learning_style is not None:
        updates["learning_style"] = request.learning_style
    if request.gpt_analysis is not None:
        updates["gpt_analysis"] = request.gpt_analysis
    
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await update_learning_style(user_id, target_user_id, updates)
    
    if result["error"]:
        status_code = 404 if result["error"] == "Learning style not found" else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {"learning_style": result["data"]}


@router.post("/upsert")
async def upsert_learning_style_record(
    request: UpsertLearningStyleRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Create or update a learning style record (upsert).
    Permission: Self OR company_admin+ in same company.
    """
    learning_style_data = {
        "user_id": request.user_id,
        "answers": request.answers,
        "learning_style": request.learning_style,
        "gpt_analysis": request.gpt_analysis
    }
    
    result = await upsert_learning_style(user_id, learning_style_data)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {"learning_style": result["data"]}


@router.delete("/user/{target_user_id}")
async def delete_user_learning_style(
    target_user_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Delete a learning style record.
    Permission: Company_admin+ in same company.
    """
    result = await delete_learning_style(user_id, target_user_id)
    
    if result["error"]:
        status_code = 404 if result["error"] == "User not found" else 403
        raise HTTPException(status_code=status_code, detail=result["error"])
    
    return {"message": "Learning style deleted successfully", "data": result["data"]}
