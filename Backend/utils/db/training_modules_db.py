from typing import Dict, Any, Optional, List
from urllib.parse import urlparse, unquote
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access


def extract_storage_path_from_url(content_url: str) -> Optional[str]:
    """
    Extract the storage path from a Supabase storage URL.
    
    Example URL:
    https://xxx.supabase.co/storage/v1/object/public/content%20library/uploads/1771312847766_0_Content%20Testing_AI.docx?token=...
    
    Returns: uploads/1771312847766_0_Content Testing_AI.docx
    """
    if not content_url:
        return None
    
    try:
        parsed = urlparse(content_url)
        path = unquote(parsed.path)  # Decode URL-encoded characters
        
        # Pattern: /storage/v1/object/public/content library/uploads/...
        # or /storage/v1/object/sign/content library/uploads/...
        if '/content library/' in path:
            # Extract everything after 'content library/'
            idx = path.find('/content library/')
            if idx != -1:
                storage_path = path[idx + len('/content library/'):]
                return storage_path
        
        # Fallback: try to find 'uploads/' directly
        if '/uploads/' in path:
            idx = path.find('uploads/')
            if idx != -1:
                return path[idx:]
        
        return None
    except Exception:
        return None

# ==================== TRAINING MODULE OPERATIONS ====================

async def get_training_modules_by_company(
    requesting_user_id: str,
    company_id: str,
    processing_status: Optional[str] = None,
    review_stage: Optional[str] = None
) -> Dict[str, Any]:
    """
    Fetch all training modules for a company.
    Permission: Any user in the company can view modules.
    Optional filters: processing_status, review_stage
    """
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_access:
        return {
            "data": None,
            "error": "Permission denied: Not a member of this company"
        }
    
    try:
        query = supabase.table('training_modules').select('*').eq('company_id', company_id)
        
        if processing_status:
            query = query.eq('processing_status', processing_status)
        
        if review_stage:
            query = query.eq('review_stage', review_stage)
        
        response = query.order('created_at', desc=True).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_training_module_by_id(
    requesting_user_id: str,
    module_id: str
) -> Dict[str, Any]:
    """
    Fetch a specific training module by ID.
    Permission: Any user in the company can view modules.
    """
    try:
        response = supabase.table('training_modules').select('*').eq(
            'module_id', module_id
        ).maybe_single().execute()
        
        if not response.data:
            return {"data": None, "error": "Training module not found"}
        
        module = response.data
        company_id = module.get('company_id')
        
        # Check if user has access to this company
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_access:
            return {
                "data": None,
                "error": "Permission denied: Not a member of this company"
            }
        
        return {"data": module, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def create_training_module(
    requesting_user_id: str,
    module_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new training module.
    Permission: Manager+ in the same company.
    """
    company_id = module_data.get('company_id')
    
    if not company_id:
        return {"data": None, "error": "company_id is required"}
    
    # Check permissions
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Manager access required"
        }
    
    # Validate required fields
    if not module_data.get('title'):
        return {"data": None, "error": "title is required"}
    
    # Set default uploaded_by to requesting user if not specified
    if 'uploaded_by' not in module_data:
        module_data['uploaded_by'] = requesting_user_id
    
    try:
        response = supabase.table('training_modules').insert(module_data).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_training_module(
    requesting_user_id: str,
    module_id: str,
    updates: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Update an existing training module.
    Permission: Manager+ in same company OR the uploader themselves.
    """
    # Get the module to check company and uploader
    try:
        module_response = supabase.table('training_modules').select('company_id, uploaded_by').eq(
            'module_id', module_id
        ).maybe_single().execute()
        
        if not module_response.data:
            return {"data": None, "error": "Training module not found"}
    except Exception as e:
        return {"data": None, "error": "Training module not found"}
    
    module = module_response.data
    company_id = module['company_id']
    uploaded_by = module.get('uploaded_by')
    
    # Check if user is the uploader
    is_uploader = requesting_user_id == uploaded_by
    
    # Check if user is manager+ in the same company
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not (is_uploader or (has_permission and has_access)):
        return {
            "data": None,
            "error": "Permission denied: Must be manager or the uploader"
        }
    
    # Prevent updating certain fields
    protected_fields = ['module_id', 'company_id', 'created_at', 'uploaded_by']
    for field in protected_fields:
        updates.pop(field, None)
    
    try:
        response = supabase.table('training_modules').update(updates).eq(
            'module_id', module_id
        ).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def delete_training_module(
    requesting_user_id: str,
    module_id: str
) -> Dict[str, Any]:
    """
    Delete a training module and its associated files from storage.
    Permission: Company admin+ only.
    """
    # Get the module with content_url and source_files for storage cleanup
    try:
        module_response = supabase.table('training_modules').select(
            'company_id, content_url, source_files'
        ).eq(
            'module_id', module_id
        ).maybe_single().execute()
        
        if not module_response.data:
            return {"data": None, "error": "Training module not found"}
    except Exception as e:
        return {"data": None, "error": "Training module not found"}
    
    module_data = module_response.data
    company_id = module_data['company_id']
    
    # Check permissions
    has_permission = await check_user_permission(requesting_user_id, 'company_admin')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Company admin access required"
        }
    
    # Collect all storage paths to delete
    storage_paths_to_delete = []
    
    # Extract path from content_url (main file like merged PDF)
    content_url = module_data.get('content_url')
    if content_url:
        main_storage_path = extract_storage_path_from_url(content_url)
        if main_storage_path:
            storage_paths_to_delete.append(main_storage_path)
    
    # Add source files paths (these are already storage paths)
    source_files = module_data.get('source_files')
    if source_files:
        if isinstance(source_files, list):
            storage_paths_to_delete.extend(source_files)
        elif isinstance(source_files, str):
            # In case it's stored as a JSON string
            try:
                import json
                parsed_files = json.loads(source_files)
                if isinstance(parsed_files, list):
                    storage_paths_to_delete.extend(parsed_files)
            except:
                pass
    
    # Delete files from storage bucket
    if storage_paths_to_delete:
        try:
            # Remove files from 'content library' bucket
            supabase.storage.from_("content library").remove(storage_paths_to_delete)
            print(f"[DELETE] Removed {len(storage_paths_to_delete)} files from storage: {storage_paths_to_delete}")
        except Exception as storage_error:
            # Log but don't fail the entire operation if storage deletion fails
            print(f"[DELETE] Warning: Failed to delete some storage files: {storage_error}")
    
    # Delete the module from database
    try:
        response = supabase.table('training_modules').delete().eq(
            'module_id', module_id
        ).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_training_modules_by_uploader(
    requesting_user_id: str,
    uploader_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Fetch all training modules uploaded by a specific user in a company.
    Permission: User must be in the same company.
    """
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_access:
        return {
            "data": None,
            "error": "Permission denied: Not a member of this company"
        }
    
    try:
        response = supabase.table('training_modules').select('*').eq(
            'company_id', company_id
        ).eq('uploaded_by', uploader_id).order('created_at', desc=True).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_module_processing_status(
    requesting_user_id: str,
    module_id: str,
    processing_status: str,
    additional_updates: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Update the processing status of a training module.
    Permission: Manager+ in the same company.
    Can also update AI-generated fields like gpt_summary, transcription, etc.
    """
    # Get the module to check company
    try:
        module_response = supabase.table('training_modules').select('company_id').eq(
            'module_id', module_id
        ).single().execute()
        
        if not module_response.data:
            return {"data": None, "error": "Training module not found"}
    except Exception as e:
        return {"data": None, "error": "Training module not found"}
    
    company_id = module_response.data['company_id']
    
    # Check permissions
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Manager access required"
        }
    
    updates = {'processing_status': processing_status}
    
    if additional_updates:
        updates.update(additional_updates)
    
    try:
        response = supabase.table('training_modules').update(updates).eq(
            'module_id', module_id
        ).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_module_review_stage(
    requesting_user_id: str,
    module_id: str,
    review_stage: str,
    reviewer_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Update the review stage of a training module.
    Permission: Manager+ in the same company.
    """
    # Get the module to check company
    try:
        module_response = supabase.table('training_modules').select('company_id').eq(
            'module_id', module_id
        ).single().execute()
        
        if not module_response.data:
            return {"data": None, "error": "Training module not found"}
    except Exception as e:
        return {"data": None, "error": "Training module not found"}
    
    company_id = module_response.data['company_id']
    
    # Check permissions
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Manager access required"
        }
    
    updates = {'review_stage': review_stage}
    
    if reviewer_id:
        updates['reviewer_id'] = reviewer_id
    
    try:
        response = supabase.table('training_modules').update(updates).eq(
            'module_id', module_id
        ).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}