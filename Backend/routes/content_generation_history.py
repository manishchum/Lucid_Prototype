from utils.auth import RequestAuth, get_request_auth_required
from fastapi import APIRouter, Header, Query, Depends
from pydantic import BaseModel
from typing import Optional

from utils.db.content_generation_history_db import (
    get_content_generation_history_by_id,
    list_content_generation_history_by_original_module,
    list_content_generation_history_by_processed_module,
    list_all_content_generation_history,
    create_content_generation_history,
    update_content_generation_history,
    delete_content_generation_history,
    update_content_generation_status
)

from utils.exceptions import NotFoundError, ValidationError

router = APIRouter(prefix="/api/content-generation-history", tags=["content-generation-history"])


class CreateContentGenerationHistoryRequest(BaseModel):
    original_module_id: str
    processed_module_id: Optional[str] = None
    content: Optional[str] = None
    status: Optional[str] = 'pending'


class UpdateContentGenerationHistoryRequest(BaseModel):
    content: Optional[str] = None
    status: Optional[str] = None


class UpdateStatusRequest(BaseModel):
    status: str
    content: Optional[str] = None


@router.get("/")
async def list_all_history(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of results"),
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    List all content generation history.
    Permission: Admin+ users see their company's history, super_admin sees all.
    
    Query Parameters:
        - status: Optional filter by status (e.g., 'pending', 'completed', 'failed')
        - limit: Maximum number of results (default: 100, max: 500)
    """
    result = await list_all_content_generation_history(user_id, status, limit)
    
    # Unwrap service layer response
    history = result.get("data") or []
    
    return {
        "success": True,
        "data": {"history": history, "count": len(history)},
        "error": result.get("error")
    }


@router.get("/{content_generation_history_id}")
async def get_history_by_id(
    content_generation_history_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get content generation history by ID.
    Permission: User must have access to the original training module.
    """
    result = await get_content_generation_history_by_id(user_id, content_generation_history_id)
    
    # Unwrap service layer response
    history_item = result.get("data") or None
    
    return {
        "success": True,
        "data": history_item,
        "error": result.get("error")
    }


@router.get("/by-original-module/{original_module_id}")
async def get_history_by_original_module(
    original_module_id: str,
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of results"),
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    List content generation history for a specific original module.
    Permission: User must have access to the original training module.
    
    Query Parameters:
        - status: Optional filter by status
        - limit: Maximum number of results (default: 100, max: 500)
    """
    result = await list_content_generation_history_by_original_module(
        user_id, original_module_id, status, limit
    )
    
    # Unwrap service layer response
    history = result.get("data") or []
    
    return {
        "success": True,
        "data": {"history": history, "count": len(history)},
        "error": result.get("error")
    }


@router.get("/by-processed-module/{processed_module_id}")
async def get_history_by_processed_module(
    processed_module_id: str,
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of results"),
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    List content generation history for a specific processed module.
    Permission: User must have access to the original training module.
    
    Query Parameters:
        - status: Optional filter by status
        - limit: Maximum number of results (default: 100, max: 500)
    """
    result = await list_content_generation_history_by_processed_module(
        user_id, processed_module_id, status, limit
    )
    
    # Unwrap service layer response
    history = result.get("data") or []
    
    return {
        "success": True,
        "data": {"history": history, "count": len(history)},
        "error": result.get("error")
    }


@router.post("/")
async def create_history(
    request: CreateContentGenerationHistoryRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Create a new content generation history record.
    Permission: User must have access to the original training module.
    
    Request Body:
        - original_module_id: UUID of the original training module (required)
        - processed_module_id: UUID of the processed module (optional)
        - content: Generated content (optional)
        - status: Status of generation (default: 'pending')
    """
    history_data = request.dict()
    result = await create_content_generation_history(user_id, history_data)
    
    # Unwrap service layer response
    history_item = result.get("data") or None
    if history_item and isinstance(history_item, list):
        history_item = history_item[0]
    
    return {
        "success": True,
        "data": history_item,
        "error": result.get("error")
    }


@router.patch("/{content_generation_history_id}")
async def update_history(
    content_generation_history_id: str,
    request: UpdateContentGenerationHistoryRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update content generation history record.
    Permission: User must have access to the original training module.
    
    Request Body:
        - content: Updated content (optional)
        - status: Updated status (optional)
    
    Note: original_module_id and processed_module_id cannot be updated.
    """
    update_data = request.dict(exclude_unset=True)
    result = await update_content_generation_history(
        user_id, content_generation_history_id, update_data
    )
    
    # Unwrap service layer response
    history_item = result.get("data") or None
    if history_item and isinstance(history_item, list):
        history_item = history_item[0]
    
    return {
        "success": True,
        "data": history_item,
        "error": result.get("error")
    }


@router.patch("/{content_generation_history_id}/status")
async def update_status(
    content_generation_history_id: str,
    request: UpdateStatusRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update the status (and optionally content) of a content generation history record.
    Permission: User must have access to the original training module.
    
    Request Body:
        - status: New status (required) - e.g., 'pending', 'processing', 'completed', 'failed'
        - content: Optional content to update along with status
    """
    result = await update_content_generation_status(
        user_id,
        content_generation_history_id,
        request.status,
        request.content
    )
    
    # Unwrap service layer response
    history_item = result.get("data") or None
    if history_item and isinstance(history_item, list):
        history_item = history_item[0]
    
    return {
        "success": True,
        "data": history_item,
        "error": result.get("error")
    }


@router.delete("/{content_generation_history_id}")
async def delete_history(
    content_generation_history_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Delete a content generation history record.
    Permission: Admin+ users can delete their company's records, super_admin can delete any.
    """
    await delete_content_generation_history(user_id, content_generation_history_id)
    
    return {
        "success": True,
        "data": None,
        "error": None
    }
