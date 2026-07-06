from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional, List
from utils.auth import RequestAuth, get_request_auth_required
from utils.redis_client import get_cache, set_cache, redis_client

from utils.db.processed_modules_db import (
    get_processed_modules_by_original_module,
    get_processed_module_by_id,
    create_processed_module,
    update_processed_module,
    delete_processed_module,
    update_audio_data,
    update_video_data,
    update_content_generation_data,
    update_podcast_data,
    get_processed_modules_by_ids
)

router = APIRouter(prefix="/api/processed-modules", tags=["processed_modules"])


class CreateProcessedModuleRequest(BaseModel):
    original_module_id: str
    title: str
    content: str
    section_type: Optional[str] = None
    order_index: Optional[int] = None
    learning_style: Optional[str] = None
    RAG_content: Optional[str] = None


class UpdateProcessedModuleRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    section_type: Optional[str] = None
    order_index: Optional[int] = None
    learning_style: Optional[str] = None
    RAG_content: Optional[str] = None


class UpdateAudioRequest(BaseModel):
    audio_url: str
    audio_duration: Optional[int] = None
    language: str = 'english'  # 'english', 'hinglish', 'german', 'spanish', or 'french'


class UpdateVideoRequest(BaseModel):
    video_url: Optional[str] = None
    video_status: Optional[str] = None  # 'pending', 'processing', 'completed', 'failed'
    video_error: Optional[str] = None


class UpdateContentGenerationRequest(BaseModel):
    mindmap_data: Optional[dict] = None
    flashcard_data: Optional[list] = None  # Array of flashcard objects with heading and points
    infographic_data: Optional[dict] = None


class UpdatePodcastRequest(BaseModel):
    podcast_transcript: Optional[str] = None
    podcast_timeline: Optional[str] = None
    language: str = 'english'  # 'english', 'hinglish', 'german', 'spanish', or 'french'


class GetMultipleRequest(BaseModel):
    processed_module_ids: List[str]


# ==================== GET ENDPOINTS ====================

@router.get("/original-module/{original_module_id}")
async def get_processed_modules_by_original_module_route(
    original_module_id: str,
    learning_style: Optional[str] = Query(None),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Get all processed modules for a specific original training module.
    Optional query parameter: learning_style
    """
    cache_key = f"processed_modules:original_module:{original_module_id}:learning_style:{learning_style or 'default'}"
    cached = get_cache(cache_key)
    if cached:
        print(f"PROCESSED MODULES CACHE HIT {cache_key}")
        return cached
    print(f"PROCESSED MODULES CACHE MISS {cache_key}")
    
    result = await get_processed_modules_by_original_module(
        auth_ctx.user_id, original_module_id, learning_style, auth_claims=auth_ctx.claims
    )
    
    if result["error"]:
        raise HTTPException(status_code=403 if "Permission denied" in result["error"] else 404, 
                          detail=result["error"])
    
    response_payload = {"data": result["data"]}
    set_cache(cache_key, response_payload, ttl=3600)
    return response_payload


@router.get("/{processed_module_id}")
async def get_processed_module_by_id_route(
    processed_module_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Get a specific processed module by ID.
    """
    cache_key = f"processed_module:{processed_module_id}"
    cached = get_cache(cache_key)
    if cached:
        print(f"PROCESSED MODULE CACHE HIT {cache_key}")
        return cached
    print(f"PROCESSED MODULE CACHE MISS {cache_key}")
    
    result = await get_processed_module_by_id(auth_ctx.user_id, processed_module_id, auth_claims=auth_ctx.claims)
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 404,
            detail=result["error"]
        )
    
    response_payload = {"data": result["data"]}
    set_cache(cache_key, response_payload, ttl=3600)
    return response_payload


@router.post("/batch")
async def get_multiple_processed_modules_route(
    request: GetMultipleRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Get multiple processed modules by their IDs.
    Returns only modules the user has access to.
    """
    result = await get_processed_modules_by_ids(user_id, request.processed_module_ids)
    
    if result["error"]:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return {"data": result["data"]}


# ==================== CREATE ENDPOINT ====================

@router.post("/")
async def create_processed_module_route(
    request: CreateProcessedModuleRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Create a new processed module.
    Requires access to the original training module.
    """
    module_data = request.dict()
    result = await create_processed_module(user_id, module_data)
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 400,
            detail=result["error"]
        )
    original_module_id = (
        result["data"]
        .get("original_module_id")
    )
    for key in redis_client.scan_iter(f"processed_modules:original_module:{original_module_id}:*"):
        redis_client.delete(key)
    
    return {"data": result["data"], "message": "Processed module created successfully"}


# ==================== UPDATE ENDPOINTS ====================

@router.put("/{processed_module_id}")
async def update_processed_module_route(
    processed_module_id: str,
    request: UpdateProcessedModuleRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update basic fields of a processed module.
    """
    updates = {k: v for k, v in request.dict().items() if v is not None}
    
    if not updates:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    existing_module = await get_processed_module_by_id(
        user_id,
        processed_module_id,
        auth_claims=auth_ctx.claims
    )
    
    original_module_id = (
        existing_module["data"].get("original_module_id")
        if existing_module["data"]
        else None
    )
    
    result = await update_processed_module(user_id, processed_module_id, updates)
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 404,
            detail=result["error"]
        )
    
    redis_client.delete(f"processed_module:{processed_module_id}")
    
    if original_module_id:
        for key in redis_client.scan_iter(f"processed_modules:original_module:{original_module_id}:*"):
            redis_client.delete(key)
    
    return {"data": result["data"], "message": "Processed module updated successfully"}


@router.patch("/{processed_module_id}/audio")
async def update_audio_route(
    processed_module_id: str,
    request: UpdateAudioRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update audio-related fields for a processed module.
    Supports both English and Hinglish audio.
    """
    existing_module = await get_processed_module_by_id(
        user_id,
        processed_module_id,
        auth_claims=auth_ctx.claims
    )
    
    original_module_id = (
        existing_module["data"].get("original_module_id")
        if existing_module["data"]
        else None
    )
    
    result = await update_audio_data(
        user_id,
        processed_module_id,
        request.audio_url,
        request.audio_duration,
        request.language
    )
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 404,
            detail=result["error"]
        )
    
    redis_client.delete(f"processed_module:{processed_module_id}")
    
    if original_module_id:
        for key in redis_client.scan_iter(f"processed_modules:original_module:{original_module_id}:*"):
            redis_client.delete(key)
    
    return {"data": result["data"], "message": "Audio data updated successfully"}


@router.patch("/{processed_module_id}/video")
async def update_video_route(
    processed_module_id: str,
    request: UpdateVideoRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update video-related fields for a processed module.
    """
    existing_module = await get_processed_module_by_id(
        user_id,
        processed_module_id,
        auth_claims=auth_ctx.claims
    )
    
    original_module_id = (
        existing_module["data"].get("original_module_id")
        if existing_module["data"]
        else None
    )
    
    result = await update_video_data(
        user_id,
        processed_module_id,
        request.video_url,
        request.video_status,
        request.video_error
    )
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 404,
            detail=result["error"]
        )
    
    redis_client.delete(f"processed_module:{processed_module_id}")
    
    if original_module_id:
        for key in redis_client.scan_iter(f"processed_modules:original_module:{original_module_id}:*"):
            redis_client.delete(key)
    
    return {"data": result["data"], "message": "Video data updated successfully"}


@router.patch("/{processed_module_id}/content-generation")
async def update_content_generation_route(
    processed_module_id: str,
    request: UpdateContentGenerationRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update content generation fields (mindmap, flashcard, infographic).
    """
    existing_module = await get_processed_module_by_id(
        user_id,
        processed_module_id,
        auth_claims=auth_ctx.claims
    )
    
    original_module_id = (
        existing_module["data"].get("original_module_id")
        if existing_module["data"]
        else None
    )

    print(f"Received request to update content generation data for processed_module_id: {processed_module_id} by user: {user_id}")
    print(f"Mindmap data: {request.mindmap_data}")
    print(f"Flashcard data: {request.flashcard_data}")
    print(f"Infographic data: {request.infographic_data}")
    result = await update_content_generation_data(
        user_id,
        processed_module_id,
        request.mindmap_data,
        request.flashcard_data,
        request.infographic_data
    )
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 404,
            detail=result["error"]
        )
        
    redis_client.delete(f"processed_module:{processed_module_id}")
    
    if original_module_id:
        for key in redis_client.scan_iter(f"processed_modules:original_module:{original_module_id}:*"):
            redis_client.delete(key)
        
    return {"data": result["data"], "message": "Content generation data updated successfully"}


@router.patch("/{processed_module_id}/podcast")
async def update_podcast_route(
    processed_module_id: str,
    request: UpdatePodcastRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Update podcast-related fields for a processed module.
    Supports both English and Hinglish podcasts.
    """
    existing_module = await get_processed_module_by_id(
        user_id,
        processed_module_id,
        auth_claims=auth_ctx.claims
    )
    
    original_module_id = (
        existing_module["data"].get("original_module_id")
        if existing_module["data"]
        else None
    )
    
    result = await update_podcast_data(
        user_id,
        processed_module_id,
        request.podcast_transcript,
        request.podcast_timeline,
        request.language
    )
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 404,
            detail=result["error"]
        )
    
    redis_client.delete(f"processed_module:{processed_module_id}")
    
    if original_module_id:
        for key in redis_client.scan_iter(f"processed_modules:original_module:{original_module_id}:*"):
            redis_client.delete(key)
    
    return {"data": result["data"], "message": "Podcast data updated successfully"}


# ==================== DELETE ENDPOINT ====================

@router.delete("/{processed_module_id}")
async def delete_processed_module_route(
    processed_module_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    user_id = auth_ctx.user_id
    """
    Delete a processed module.
    Requires Manager+ role.
    """
    existing_module = await get_processed_module_by_id(
        user_id,
        processed_module_id,
        auth_claims=auth_ctx.claims
    )
    
    original_module_id = (
        existing_module["data"].get("original_module_id")
        if existing_module["data"]
        else None
    )
    
    result = await delete_processed_module(user_id, processed_module_id)
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 404,
            detail=result["error"]
        )
    
    redis_client.delete(f"processed_module:{processed_module_id}")
    
    if original_module_id:
        for key in redis_client.scan_iter(f"processed_modules:original_module:{original_module_id}:*"):
            redis_client.delete(key)
    
    return {"message": "Processed module deleted successfully"}