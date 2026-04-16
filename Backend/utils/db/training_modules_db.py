from typing import Dict, Any, Optional, List
from urllib.parse import urlparse, unquote
import re
from ..supabase_client import supabase
from ..auth_bridge import create_user_scoped_supabase_client_from_claims, get_service_supabase_client
from .permissions import check_user_permission, check_company_access


def extract_storage_path_from_url(content_url: str) -> Optional[str]:
    """
    Extract the storage path from a Supabase storage URL.
    
    Example URL:
    https://xxx.supabase.co/storage/v1/object/public/content%20library/uploads/module_id_combined.pdf
    
    Returns: uploads/module_id_combined.pdf
    """
    if not content_url:
        return None
    
    try:
        parsed = urlparse(content_url)
        path = unquote(parsed.path)  # Decode URL-encoded characters
        
        # Pattern: /storage/v1/object/public/content library/uploads/...
        if '/content library/' in path:
            idx = path.find('/content library/')
            if idx != -1:
                return path[idx + len('/content library/'):]
        
        # Fallback: try to find 'uploads/' directly
        if '/uploads/' in path:
            idx = path.find('uploads/')
            if idx != -1:
                return path[idx:]
        
        return None
    except Exception:
        return None


def extract_base_filename(source_path: str) -> Optional[str]:
    """
    Extract the base filename from a source file path.
    
    Example: uploads/cc1dd720-2c2f-489f-a6ec-f836ea4e5677/source/AI_Grayscale.pdf
    Returns: AI_Grayscale.pdf
    """
    if not source_path:
        return None
    try:
        # Get the last part after the final /
        parts = source_path.split('/')
        return parts[-1] if parts else None
    except Exception:
        return None


async def find_timestamped_uploads(base_filenames: List[str]) -> List[str]:
    """
    Find original timestamped upload files that match the base filenames.
    These are files like: uploads/1773293935634_0_filename.pdf
    """
    if not base_filenames:
        return []
    
    matching_paths = []
    
    try:
        # List all files in the uploads folder (not recursive)
        list_response = supabase.storage.from_("content library").list("uploads")
        
        if list_response:
            for file_info in list_response:
                file_name = file_info.get('name', '')
                # Skip folders (they have id = None for directories)
                if file_info.get('id') is None:
                    continue
                
                # Check if this file matches any of our base filenames
                # Pattern: {timestamp}_{index}_{original_filename}
                for base_name in base_filenames:
                    # The uploaded filename might have spaces replaced with underscores
                    base_name_normalized = base_name.replace(" ", "_")
                    
                    # Check if file_name ends with the base filename (after timestamp_index_ prefix)
                    # Pattern: digits_digit(s)_filename
                    match = re.match(r'^\d+_\d+_(.+)$', file_name)
                    if match:
                        matched_name = match.group(1)
                        if matched_name == base_name or matched_name == base_name_normalized:
                            matching_paths.append(f"uploads/{file_name}")
                            break
    except Exception as e:
        print(f"[DELETE] Warning: Could not list uploads folder: {e}")
    
    return matching_paths


# ==================== TRAINING MODULE OPERATIONS ====================

async def get_training_modules_by_company(
    requesting_user_id: str,
    company_id: str,
    processing_status: Optional[str] = None,
    review_stage: Optional[str] = None,
    auth_claims: Optional[Dict[str, Any]] = None,
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
        query_client = supabase
        if auth_claims:
            try:
                query_client, _, _, _, _ = create_user_scoped_supabase_client_from_claims(auth_claims)
            except Exception:
                query_client = supabase

        query = query_client.table('training_modules').select('*, reviewer:users!training_modules_reviewer_id_fkey(name), uploader:users!training_modules_uploaded_by_fkey(name)').eq('company_id', company_id)

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
    module_id: str,
    auth_claims: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Fetch a specific training module by ID.
    Permission: Any user in the company can view modules.
    """
    try:
        query_client = get_service_supabase_client()
        if auth_claims:
            try:
                query_client, _, _, _, _ = create_user_scoped_supabase_client_from_claims(auth_claims)
            except Exception:
                # Fall back to backend-authoritative client when bridge resolution fails.
                query_client = get_service_supabase_client()

        response = query_client.table('training_modules').select('*').eq(
            'module_id', module_id
        ).maybe_single().execute()
        
        if not response.data:
            return {"data": None, "error": "Training module not found"}
        
        module = response.data or {}
        company_id = module.get('company_id')
        if not company_id:
            return {"data": None, "error": "Training module has no company mapping"}
        
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
    module_data: Dict[str, Any],
    auth_claims: Optional[Dict[str, Any]] = None
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

    query_client = supabase
    if auth_claims:
        try:
            query_client, _, _, _, _ = create_user_scoped_supabase_client_from_claims(auth_claims)
        except Exception:
            query_client = supabase

    # Enforce company content-generation rate limit before creating a new module.
    try:
        company_limit_resp = (
            query_client
            .table('companies')
            .select('rate_limit_content_generation')
            .eq('company_id', company_id)
            .maybe_single()
            .execute()
        )
        company_limit_data = getattr(company_limit_resp, 'data', None) or {}
        company_limit_value = company_limit_data.get('rate_limit_content_generation')
        company_limit = int(company_limit_value) if company_limit_value is not None else 5

        company_modules_resp = (
            query_client
            .table('training_modules')
            .select('module_id')
            .eq('company_id', company_id)
            .execute()
        )
        existing_modules = getattr(company_modules_resp, 'data', None) or []
        existing_count = len(existing_modules)

        if existing_count >= company_limit:
            return {
                "data": None,
                "error": (
                    "RATE_LIMIT_EXCEEDED: You can't upload more documents. "
                    "To upload more contact the administration. "
                    "manish.chum@wokfloww.ai."
                )
            }
    except Exception as e:
        return {"data": None, "error": f"Failed to validate company content generation rate limit: {str(e)}"}
    
    # Set default uploaded_by to requesting user if not specified
    if 'uploaded_by' not in module_data:
        module_data['uploaded_by'] = requesting_user_id
    
    try:
        response = query_client.table('training_modules').insert(module_data).execute()
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
    Delete a training module and all associated files from storage.
    Permission: Company admin+ only.
    
    Deletes files from 3 locations:
    1. uploads/{module_id}/source/{filename} - from source_files column
    2. uploads/{module_id}_combined.pdf - from content_url column
    3. uploads/{timestamp}_{index}_{filename} - original frontend uploads
    """
    # Get the module with content_url and source_files for storage cleanup
    service_client = get_service_supabase_client()
    try:
        module_response = service_client.table('training_modules').select(
            'company_id, content_url, source_files'
        ).eq(
            'module_id', module_id
        ).maybe_single().execute()
        
        if not module_response.data:
            return {"data": None, "error": "Training module not found"}
            
        module_data = module_response.data
        company_id = module_data['company_id']
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"data": None, "error": f"Error fetching training module: {str(e)}"}
    
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
    base_filenames = []  # For finding timestamped uploads
    
    # 1. Extract path from content_url (combined PDF)
    content_url = module_data.get('content_url')
    if content_url:
        main_storage_path = extract_storage_path_from_url(content_url)
        if main_storage_path:
            storage_paths_to_delete.append(main_storage_path)
    
    # 2. Add source files paths and collect base filenames
    source_files = module_data.get('source_files')
    if source_files:
        source_files_list = []
        if isinstance(source_files, list):
            source_files_list = source_files
        elif isinstance(source_files, str):
            # In case it's stored as a JSON string
            try:
                import json
                parsed_files = json.loads(source_files)
                if isinstance(parsed_files, list):
                    source_files_list = parsed_files
            except:
                pass
        
        # Add source file paths and extract base filenames
        for sf in source_files_list:
            storage_paths_to_delete.append(sf)
            base_name = extract_base_filename(sf)
            if base_name:
                base_filenames.append(base_name)
    
    # 3. Find and add timestamped original uploads (uploads/{timestamp}_{index}_{filename})
    if base_filenames:
        timestamped_files = await find_timestamped_uploads(base_filenames)
        if timestamped_files:
            storage_paths_to_delete.extend(timestamped_files)
            print(f"[DELETE] Found timestamped uploads to delete: {timestamped_files}")
    
    # Delete files from storage bucket
    if storage_paths_to_delete:
        try:
            # Remove files from 'content library' bucket
            service_client.storage.from_("content library").remove(storage_paths_to_delete)
            print(f"[DELETE] Removed {len(storage_paths_to_delete)} files from storage: {storage_paths_to_delete}")
        except Exception as storage_error:
            # Log but don't fail the entire operation if storage deletion fails
            print(f"[DELETE] Warning: Failed to delete some storage files: {storage_error}")
    
    # Delete the module from database
    try:
        response = service_client.table('training_modules').delete().eq(
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
    service_client = get_service_supabase_client()
    try:
        module_response = service_client.table('training_modules').select('company_id').eq(
            'module_id', module_id
        ).maybe_single().execute()

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
        response = service_client.table('training_modules').update(updates).eq(
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

