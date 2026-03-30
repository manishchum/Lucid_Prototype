from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional, List

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
    language: str = 'english'  # 'english' or 'hinglish'


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
    language: str = 'english'  # 'english' or 'hinglish'


class GetMultipleRequest(BaseModel):
    processed_module_ids: List[str]


# ==================== GET ENDPOINTS ====================

@router.get("/original-module/{original_module_id}")
async def get_processed_modules_by_original_module_route(
    original_module_id: str,
    learning_style: Optional[str] = Query(None),
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get all processed modules for a specific original training module.
    Optional query parameter: learning_style
    """
    result = await get_processed_modules_by_original_module(
        user_id, original_module_id, learning_style
    )
    
    if result["error"]:
        raise HTTPException(status_code=403 if "Permission denied" in result["error"] else 404, 
                          detail=result["error"])
    
    return {"data": result["data"]}


@router.get("/{processed_module_id}")
async def get_processed_module_by_id_route(
    processed_module_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get a specific processed module by ID.
    """
    result = await get_processed_module_by_id(user_id, processed_module_id)
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 404,
            detail=result["error"]
        )
    
    return {"data": result["data"]}


@router.post("/batch")
async def get_multiple_processed_modules_route(
    request: GetMultipleRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
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
    user_id: str = Header(..., alias="X-User-ID")
):
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
    
    return {"data": result["data"], "message": "Processed module created successfully"}


# ==================== UPDATE ENDPOINTS ====================

@router.put("/{processed_module_id}")
async def update_processed_module_route(
    processed_module_id: str,
    request: UpdateProcessedModuleRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Update basic fields of a processed module.
    """
    updates = {k: v for k, v in request.dict().items() if v is not None}
    
    if not updates:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    result = await update_processed_module(user_id, processed_module_id, updates)
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 404,
            detail=result["error"]
        )
    
    return {"data": result["data"], "message": "Processed module updated successfully"}


@router.patch("/{processed_module_id}/audio")
async def update_audio_route(
    processed_module_id: str,
    request: UpdateAudioRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Update audio-related fields for a processed module.
    Supports both English and Hinglish audio.
    """
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
    
    return {"data": result["data"], "message": "Audio data updated successfully"}


@router.patch("/{processed_module_id}/video")
async def update_video_route(
    processed_module_id: str,
    request: UpdateVideoRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Update video-related fields for a processed module.
    """
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
    
    return {"data": result["data"], "message": "Video data updated successfully"}


@router.patch("/{processed_module_id}/content-generation")
async def update_content_generation_route(
    processed_module_id: str,
    request: UpdateContentGenerationRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Update content generation fields (mindmap, flashcard, infographic).
    """

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
    
    return {"data": result["data"], "message": "Content generation data updated successfully"}


@router.patch("/{processed_module_id}/podcast")
async def update_podcast_route(
    processed_module_id: str,
    request: UpdatePodcastRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Update podcast-related fields for a processed module.
    Supports both English and Hinglish podcasts.
    """
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
    
    return {"data": result["data"], "message": "Podcast data updated successfully"}


# ==================== DELETE ENDPOINT ====================

@router.delete("/{processed_module_id}")
async def delete_processed_module_route(
    processed_module_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Delete a processed module.
    Requires Manager+ role.
    """
    result = await delete_processed_module(user_id, processed_module_id)
    
    if result["error"]:
        raise HTTPException(
            status_code=403 if "Permission denied" in result["error"] else 404,
            detail=result["error"]
        )
    
    return {"message": "Processed module deleted successfully"}