from typing import Dict, Any
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access

# ==================== MODULE OPERATIONS ====================

async def get_training_modules(
    requesting_user_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Fetch all training modules with processing status.
    Permission: Manager+ can see all modules, employees see only assigned ones.
    """
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_access:
        return {
            "data": None,
            "error": "Permission denied: Not a member of this company"
        }
    
    try:
        # Get modules
        modules_response = supabase.table('training_modules').select('*').eq(
            'company_id', company_id
        ).order('created_at', desc=True).execute()
        
        if not modules_response.data:
            return {"data": [], "error": None}
        
        # Check if user is manager+
        is_manager = await check_user_permission(requesting_user_id, 'manager')
        
        # Enrich with status
        enriched_modules = []
        for module in modules_response.data:
            # Get job status
            job_response = supabase.table('content_jobs').select('status').eq(
                'module_id', module['module_id']
            ).maybe_single().execute()
            
            if not job_response.data:
                processing_status = 'not_started'
            elif job_response.data.get('status') == 'completed':
                processing_status = 'completed'
            elif job_response.data.get('status') == 'failed':
                processing_status = 'failed'
            else:
                processing_status = 'processing'
            
            # If not manager, only show assigned modules
            if not is_manager:
                assignment = supabase.table('assignments').select('assignment_id').eq(
                    'user_id', requesting_user_id
                ).eq('module_id', module['module_id']).maybe_single().execute()
                
                if not assignment.data:
                    continue  # Skip this module
            
            enriched_modules.append({
                **module,
                'processing_status': processing_status
            })
        
        return {"data": enriched_modules, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_completed_modules(
    requesting_user_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Fetch only completed training modules.
    Permission: Manager+ in the company.
    """
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Only managers can view all completed modules"
        }
    
    try:
        # Get completed job module IDs
        jobs_response = supabase.table('content_jobs').select('module_id').eq(
            'status', 'completed'
        ).execute()
        
        if not jobs_response.data:
            return {"data": [], "error": None}
        
        completed_ids = [job['module_id'] for job in jobs_response.data]
        
        # Get modules
        modules_response = supabase.table('training_modules').select('*').eq(
            'company_id', company_id
        ).in_('module_id', completed_ids).order('title').execute()
        
        return {"data": modules_response.data or [], "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
