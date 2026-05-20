"""
Database operations for processed_modules table.
Handles CRUD operations with permission checks.
"""
from typing import Dict, Any, Optional, List
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access


async def get_user_company_id(user_id: str) -> Optional[str]:
    """Helper function to get user's company_id"""
    try:
        resp = supabase.table('users').select('company_id').eq(
            'user_id', user_id
        ).single().execute()
        return resp.data.get('company_id') if resp.data else None
    except Exception:
        return None


async def check_module_access(requesting_user_id: str, original_module_id: str) -> bool:
    """Check if user has access to the original training module"""
    try:
        # Get the training module's company
        module_resp = supabase.table('training_modules').select('company_id').eq(
            'module_id', original_module_id
        ).single().execute()
        
        if not module_resp.data:
            return False
        
        module_company_id = module_resp.data.get('company_id')
        if not module_company_id:
            return False
        
        # Check if user has access to this company
        return await check_company_access(requesting_user_id, module_company_id)
    except Exception:
        return False


# ==================== PROCESSED MODULE OPERATIONS ====================

async def get_processed_modules_by_original_module(
    requesting_user_id: str,
    original_module_id: str,
    learning_style: Optional[str] = None
) -> Dict[str, Any]:
    """
    Fetch all processed modules for a specific original module.
    Permission: User must have access to the original training module.
    Optional filter: learning_style
    """
    has_access = await check_module_access(requesting_user_id, original_module_id)
    
    if not has_access:
        return {
            "data": None,
            "error": "Permission denied: No access to this module"
        }
    
    try:
        query = supabase.table('processed_modules').select('*').eq(
            'original_module_id', original_module_id
        )
        
        if learning_style:
            query = query.eq('learning_style', learning_style)
        
        response = query.order('order_index').execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_processed_module_by_id(
    requesting_user_id: str,
    processed_module_id: str
) -> Dict[str, Any]:
    """
    Fetch a specific processed module by ID.
    Permission: User must have access to the original training module.
    Includes sprint (training module) information.
    """
    try:
        # Get the processed module with original_module_id
        response = supabase.table('processed_modules').select('*').eq(
            'processed_module_id', processed_module_id
        ).maybe_single().execute()
        
        if not response.data:
            return {"data": None, "error": "Processed module not found"}
        
        original_module_id = response.data.get('original_module_id')
        if not original_module_id:
            return {"data": None, "error": "No original module reference found"}
        
        # Check access to original module
        has_access = await check_module_access(requesting_user_id, original_module_id)
        if not has_access:
            return {
                "data": None,
                "error": "Permission denied: No access to this module"
            }
        
        # Fetch sprint (training module) info
        sprint_response = supabase.table('training_modules').select('module_id, title').eq(
            'module_id', original_module_id
        ).maybe_single().execute()
        
        sprint_data = sprint_response.data if sprint_response.data else {}
        sprint_name = sprint_data.get('title', '')
        
        # Add sprint information to the response
        module_data = response.data.copy()
        module_data['sprint_name'] = sprint_name
        module_data['sprint_id'] = original_module_id
        
        return {"data": module_data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def create_processed_module(
    requesting_user_id: str,
    module_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new processed module.
    Permission: User must have access to the original training module.
    This is typically called by the content generation pipeline.
    """
    original_module_id = module_data.get('original_module_id')
    
    if not original_module_id:
        return {"data": None, "error": "original_module_id is required"}
    
    # Check access to original module
    has_access = await check_module_access(requesting_user_id, original_module_id)
    if not has_access:
        return {
            "data": None,
            "error": "Permission denied: No access to this module"
        }
    
    try:
        response = supabase.table('processed_modules').insert(module_data).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_processed_module(
    requesting_user_id: str,
    processed_module_id: str,
    updates: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Update a processed module.
    Permission: User must have access to the original training module.
    """
    try:
        # Get the processed module to check access
        module_resp = supabase.table('processed_modules').select(
            'original_module_id'
        ).eq('processed_module_id', processed_module_id).maybe_single().execute()
        
        if not module_resp.data:
            return {"data": None, "error": "Processed module not found"}
        
        original_module_id = module_resp.data.get('original_module_id')
        if not original_module_id:
            return {"data": None, "error": "No original module reference found"}
        
        # Check access
        has_access = await check_module_access(requesting_user_id, original_module_id)
        if not has_access:
            return {
                "data": None,
                "error": "Permission denied: No access to this module"
            }
        
        # Update the module
        response = supabase.table('processed_modules').update(updates).eq(
            'processed_module_id', processed_module_id
        ).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def delete_processed_module(
    requesting_user_id: str,
    processed_module_id: str
) -> Dict[str, Any]:
    """
    Delete a processed module.
    Permission: Manager+ role required and access to the original training module.
    """
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    
    if not has_permission:
        return {
            "data": None,
            "error": "Permission denied: Manager role required"
        }
    
    try:
        # Get the processed module to check access
        module_resp = supabase.table('processed_modules').select(
            'original_module_id'
        ).eq('processed_module_id', processed_module_id).maybe_single().execute()
        
        if not module_resp.data:
            return {"data": None, "error": "Processed module not found"}
        
        original_module_id = module_resp.data.get('original_module_id')
        if original_module_id:
            has_access = await check_module_access(requesting_user_id, original_module_id)
            if not has_access:
                return {
                    "data": None,
                    "error": "Permission denied: No access to this module"
                }
        
        # Delete the module
        response = supabase.table('processed_modules').delete().eq(
            'processed_module_id', processed_module_id
        ).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_audio_data(
    requesting_user_id: str,
    processed_module_id: str,
    audio_url: str,
    audio_duration: Optional[int] = None,
    language: str = 'english'
) -> Dict[str, Any]:
    """
    Update audio-related fields for a processed module.
    Permission: User must have access to the original training module.
    """
    try:
        # Get the processed module to check access
        module_resp = supabase.table('processed_modules').select(
            'original_module_id'
        ).eq('processed_module_id', processed_module_id).maybe_single().execute()
        
        if not module_resp.data:
            return {"data": None, "error": "Processed module not found"}
        
        original_module_id = module_resp.data.get('original_module_id')
        if original_module_id:
            has_access = await check_module_access(requesting_user_id, original_module_id)
            if not has_access:
                return {
                    "data": None,
                    "error": "Permission denied: No access to this module"
                }
        
        # Prepare updates based on language
        updates = {
            'audio_generated_at': 'now()'
        }
        
        if language == 'hinglish':
            updates['audio_url_hinglish'] = audio_url
        else:
            updates['audio_url'] = audio_url
            if audio_duration is not None:
                updates['audio_duration'] = audio_duration
        
        # Update the module
        response = supabase.table('processed_modules').update(updates).eq(
            'processed_module_id', processed_module_id
        ).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_video_data(
    requesting_user_id: str,
    processed_module_id: str,
    video_url: Optional[str] = None,
    video_status: Optional[str] = None,
    video_error: Optional[str] = None
) -> Dict[str, Any]:
    """
    Update video-related fields for a processed module.
    Permission: User must have access to the original training module.
    """
    try:
        # Get the processed module to check access
        module_resp = supabase.table('processed_modules').select(
            'original_module_id, video_attempts'
        ).eq('processed_module_id', processed_module_id).maybe_single().execute()
        
        if not module_resp.data:
            return {"data": None, "error": "Processed module not found"}
        
        original_module_id = module_resp.data.get('original_module_id')
        if original_module_id:
            has_access = await check_module_access(requesting_user_id, original_module_id)
            if not has_access:
                return {
                    "data": None,
                    "error": "Permission denied: No access to this module"
                }
        
        # Prepare updates
        updates = {
            'video_updated_at': 'now()'
        }
        
        if video_url is not None:
            updates['video_url'] = video_url
            updates['video_generated_at'] = 'now()'
        
        if video_status is not None:
            updates['video_status'] = video_status
            if video_status == 'processing':
                updates['video_started_at'] = 'now()'
            elif video_status == 'failed':
                # Increment attempts
                current_attempts = module_resp.data.get('video_attempts', 0)
                updates['video_attempts'] = current_attempts + 1
        
        if video_error is not None:
            updates['video_error'] = video_error
        
        # Update the module
        response = supabase.table('processed_modules').update(updates).eq(
            'processed_module_id', processed_module_id
        ).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_content_generation_data(
    requesting_user_id: str,
    processed_module_id: str,
    mindmap_data: Optional[dict] = None,
    flashcard_data: Optional[list] = None,
    infographic_data: Optional[dict] = None
) -> Dict[str, Any]:
    """
    Update content generation fields (mindmap, flashcard, infographic).
    Permission: User must have access to the original training module.
    """
    try:
        print(f"Starting update_content_generation_data for processed_module_id: {processed_module_id} by user: {requesting_user_id}")
        # Get the processed module to check access
        module_resp = supabase.table('processed_modules').select(
            'original_module_id'
        ).eq('processed_module_id', processed_module_id).maybe_single().execute()
        

        print(f"Fetched module for update_content_generation_data: {module_resp.data}")
        if not module_resp.data:
            return {"data": None, "error": "Processed module not found"}
        
        original_module_id = module_resp.data.get('original_module_id')
        if original_module_id:
            has_access = await check_module_access(requesting_user_id, original_module_id)
            if not has_access:
                return {
                    "data": None,
                    "error": "Permission denied: No access to this module"
                }
        
        # Prepare updates
        updates = {}
        
        if mindmap_data is not None:
            updates['mindmap_data'] = mindmap_data
        
        if flashcard_data is not None:
            updates['flashcard_data'] = flashcard_data
        
        if infographic_data is not None:
            updates['infographic_data'] = infographic_data
        
        if not updates:
            return {"data": None, "error": "No data provided for update"}
        
        print(f"Updating processed_module_id {processed_module_id} with data: {updates}")
        # Update the module
        response = supabase.table('processed_modules').update(updates).eq(
            'processed_module_id', processed_module_id
        ).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_podcast_data(
    requesting_user_id: str,
    processed_module_id: str,
    podcast_transcript: Optional[str] = None,
    podcast_timeline: Optional[str] = None,
    language: str = 'english'
) -> Dict[str, Any]:
    """
    Update podcast-related fields for a processed module.
    Permission: User must have access to the original training module.
    """
    try:
        # Get the processed module to check access
        module_resp = supabase.table('processed_modules').select(
            'original_module_id'
        ).eq('processed_module_id', processed_module_id).maybe_single().execute()
        
        if not module_resp.data:
            return {"data": None, "error": "Processed module not found"}
        
        original_module_id = module_resp.data.get('original_module_id')
        if original_module_id:
            has_access = await check_module_access(requesting_user_id, original_module_id)
            if not has_access:
                return {
                    "data": None,
                    "error": "Permission denied: No access to this module"
                }
        
        # Prepare updates based on language
        updates = {}
        
        if language == 'hinglish':
            if podcast_transcript is not None:
                updates['podcast_transcript_hinglish'] = podcast_transcript
            if podcast_timeline is not None:
                updates['podcast_timeline_hinglish'] = podcast_timeline
        else:
            if podcast_transcript is not None:
                updates['podcast_transcript'] = podcast_transcript
            if podcast_timeline is not None:
                updates['podcast_timeline'] = podcast_timeline
        
        if not updates:
            return {"data": None, "error": "No data provided for update"}
        
        # Update the module
        response = supabase.table('processed_modules').update(updates).eq(
            'processed_module_id', processed_module_id
        ).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_processed_modules_by_ids(
    requesting_user_id: str,
    processed_module_ids: List[str]
) -> Dict[str, Any]:
    """
    Fetch multiple processed modules by their IDs.
    Permission: User must have access to the original training modules.
    Returns only the modules the user has access to.
    """
    if not processed_module_ids:
        return {"data": [], "error": None}
    
    try:
        # Get all processed modules
        response = supabase.table('processed_modules').select('*').in_(
            'processed_module_id', processed_module_ids
        ).execute()
        
        if not response.data:
            return {"data": [], "error": None}
        
        # Filter modules based on access
        accessible_modules = []
        for module in response.data:
            original_module_id = module.get('original_module_id')
            if original_module_id:
                has_access = await check_module_access(requesting_user_id, original_module_id)
                if has_access:
                    accessible_modules.append(module)
        
        return {"data": accessible_modules, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}