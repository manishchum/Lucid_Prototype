"""
Database operations for content_generation_history table.
Handles CRUD operations with permission checks.
"""
from typing import Dict, Any, Optional, List
from datetime import datetime
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access


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


# ==================== CONTENT GENERATION HISTORY OPERATIONS ====================

async def get_content_generation_history_by_id(
    requesting_user_id: str,
    content_generation_history_id: str
) -> Dict[str, Any]:
    """
    Get content generation history by ID.
    Permission: User must have access to the original training module.
    """
    try:
        # Get the content generation history record
        response = supabase.table('content_generation_history').select('*').eq(
            'content_generation_history_id', content_generation_history_id
        ).maybe_single().execute()
        
        if not response.data:
            return {"data": None, "error": "Content generation history not found"}
        
        original_module_id = response.data.get('original_module_id')
        if original_module_id:
            # Check access to original module
            has_access = await check_module_access(requesting_user_id, original_module_id)
            if not has_access:
                return {"data": None, "error": "Permission denied: No access to this module"}
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def list_content_generation_history_by_original_module(
    requesting_user_id: str,
    original_module_id: str,
    status: Optional[str] = None,
    limit: int = 100
) -> Dict[str, Any]:
    """
    List all content generation history for a specific original module.
    Permission: User must have access to the original training module.
    Optional filter by status.
    """
    has_access = await check_module_access(requesting_user_id, original_module_id)
    
    if not has_access:
        return {
            "data": None,
            "error": "Permission denied: No access to this module"
        }
    
    try:
        query = supabase.table('content_generation_history').select('*').eq(
            'original_module_id', original_module_id
        )
        
        if status:
            query = query.eq('status', status)
        
        response = query.order('created_at', desc=True).limit(limit).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def list_content_generation_history_by_processed_module(
    requesting_user_id: str,
    processed_module_id: str,
    status: Optional[str] = None,
    limit: int = 100
) -> Dict[str, Any]:
    """
    List all content generation history for a specific processed module.
    Permission: User must have access to the original training module.
    Optional filter by status.
    """
    try:
        # First get the processed module to find the original_module_id
        processed_module = supabase.table('processed_modules').select('original_module_id').eq(
            'processed_module_id', processed_module_id
        ).maybe_single().execute()
        
        if not processed_module.data:
            return {"data": None, "error": "Processed module not found"}
        
        original_module_id = processed_module.data.get('original_module_id')
        if not original_module_id:
            return {"data": None, "error": "No original module reference found"}
        
        # Check access to original module
        has_access = await check_module_access(requesting_user_id, original_module_id)
        if not has_access:
            return {"data": None, "error": "Permission denied: No access to this module"}
        
        # Get content generation history
        query = supabase.table('content_generation_history').select('*').eq(
            'processed_module_id', processed_module_id
        )
        
        if status:
            query = query.eq('status', status)
        
        response = query.order('created_at', desc=True).limit(limit).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def list_all_content_generation_history(
    requesting_user_id: str,
    status: Optional[str] = None,
    limit: int = 100
) -> Dict[str, Any]:
    """
    List all content generation history across all modules.
    Permission: Admin+ users can see their company's history, super_admin can see all.
    Optional filter by status.
    """
    try:
        # Check if user is super admin
        is_super_admin = await check_user_permission(requesting_user_id, 'super_admin')
        
        if is_super_admin:
            # Super admin can see all
            query = supabase.table('content_generation_history').select('*')
        else:
            # Get user's company_id
            user_resp = supabase.table('users').select('company_id').eq(
                'user_id', requesting_user_id
            ).single().execute()
            
            if not user_resp.data or not user_resp.data.get('company_id'):
                return {"data": None, "error": "User company not found"}
            
            user_company_id = user_resp.data['company_id']
            
            # Join with training_modules to filter by company
            query = supabase.table('content_generation_history').select(
                '*, training_modules!content_generation_history_original_module_id_fkey(company_id)'
            ).eq('training_modules.company_id', user_company_id)
        
        if status:
            query = query.eq('status', status)
        
        response = query.order('created_at', desc=True).limit(limit).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def create_content_generation_history(
    requesting_user_id: str,
    history_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new content generation history record.
    Permission: User must have access to the original training module.
    Required fields: original_module_id
    Optional fields: processed_module_id, content, status
    """
    # Validate required fields
    original_module_id = history_data.get('original_module_id')
    if not original_module_id:
        return {"data": None, "error": "original_module_id is required"}
    
    # Check access to original module
    has_access = await check_module_access(requesting_user_id, original_module_id)
    if not has_access:
        return {"data": None, "error": "Permission denied: No access to this module"}
    
    # Set default status if not provided
    if 'status' not in history_data:
        history_data['status'] = 'pending'
    
    try:
        response = supabase.table('content_generation_history').insert(history_data).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_content_generation_history(
    requesting_user_id: str,
    content_generation_history_id: str,
    update_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Update content generation history record.
    Permission: User must have access to the original training module.
    """
    # First get the existing record to check permissions
    existing = await get_content_generation_history_by_id(
        requesting_user_id, content_generation_history_id
    )
    
    if existing["error"]:
        return existing
    
    # Don't allow updating original_module_id or processed_module_id
    update_data.pop('original_module_id', None)
    update_data.pop('processed_module_id', None)
    update_data.pop('content_generation_history_id', None)
    update_data.pop('created_at', None)
    
    try:
        response = supabase.table('content_generation_history').update(update_data).eq(
            'content_generation_history_id', content_generation_history_id
        ).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def delete_content_generation_history(
    requesting_user_id: str,
    content_generation_history_id: str
) -> Dict[str, Any]:
    """
    Delete a content generation history record.
    Permission: Admin+ users can delete their company's records, super_admin can delete any.
    """
    # Get the record first
    existing = await get_content_generation_history_by_id(
        requesting_user_id, content_generation_history_id
    )
    
    if existing["error"]:
        return existing
    
    # Check if user has admin permission
    has_permission = await check_user_permission(requesting_user_id, 'admin')
    if not has_permission:
        return {"data": None, "error": "Permission denied: Admin access required"}
    
    try:
        response = supabase.table('content_generation_history').delete().eq(
            'content_generation_history_id', content_generation_history_id
        ).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_content_generation_status(
    requesting_user_id: str,
    content_generation_history_id: str,
    status: str,
    content: Optional[str] = None
) -> Dict[str, Any]:
    """
    Convenience function to update the status (and optionally content) of a content generation history record.
    Permission: User must have access to the original training module.
    
    Common statuses: 'pending', 'processing', 'completed', 'failed'
    """
    update_data = {'status': status}
    if content is not None:
        update_data['content'] = content
    
    return await update_content_generation_history(
        requesting_user_id,
        content_generation_history_id,
        update_data
    )
