from typing import Dict, Any, Optional, List
from ..auth_bridge import get_service_supabase_client
from .permissions import check_user_permission, check_company_access

# ==================== CONTENT JOBS OPERATIONS ====================

async def get_module_company_id(module_id: str) -> Optional[str]:
    """
    Helper function to get the company_id associated with a module.
    """
    try:
        db = get_service_supabase_client()
        resp = db.table('training_modules').select('company_id').eq(
            'module_id', module_id
        ).maybe_single().execute()
        if resp.data:
            return resp.data.get('company_id')
        return None
    except Exception:
        return None

async def get_content_job_by_id(
    requesting_user_id: str, 
    job_id: int
) -> Dict[str, Any]:
    """
    Get a single content job by ID.
    Permission: Manager+ in the same company as the module.
    """
    try:
        db = get_service_supabase_client()
        # Get the content job with module info
        resp = db.table('content_jobs').select(
            '*, training_modules(module_id, title, company_id)'
        ).eq('id', job_id).maybe_single().execute()
        
        if not resp.data:
            return {"data": None, "error": "Content job not found"}
        
        job = resp.data
        
        # Get the company_id from the related module
        module = job.get('training_modules', {})
        company_id = module.get('company_id') if isinstance(module, dict) else None
        
        if not company_id:
            return {"data": None, "error": "Module company not found"}
        
        # Check permissions
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Insufficient privileges or company mismatch"
            }
        
        return {"data": job, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def list_content_jobs(
    requesting_user_id: str,
    status: Optional[str] = None,
    module_id: Optional[str] = None,
    limit: Optional[int] = None
) -> Dict[str, Any]:
    """
    List content jobs with optional filters.
    Permission: Manager+ can see jobs from their company only.
    """
    try:
        db = get_service_supabase_client()
        # Check if user has manager+ permission
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        if not has_permission:
            return {
                "data": None,
                "error": "Permission denied: Manager role required"
            }
        
        # Get user's company_id
        user_resp = db.table('users').select('company_id').eq(
            'user_id', requesting_user_id
        ).maybe_single().execute()
        
        if not user_resp.data:
            return {"data": None, "error": "User not found"}
        
        user_company_id = user_resp.data.get('company_id')
        
        # Build query with module join to filter by company
        query = db.table('content_jobs').select(
            '*, training_modules(module_id, title, company_id)'
        )
        
        # Apply filters
        if status:
            query = query.eq('status', status)
        if module_id:
            query = query.eq('module_id', module_id)
        
        # Order by most recent first
        query = query.order('created_at', desc=True)
        
        if limit:
            query = query.limit(limit)
        
        resp = query.execute()
        
        # Filter by company access
        jobs = resp.data or []
        filtered_jobs = []
        for job in jobs:
            module = job.get('training_modules', {})
            job_company_id = module.get('company_id') if isinstance(module, dict) else None
            if job_company_id == user_company_id:
                filtered_jobs.append(job)
        
        return {"data": filtered_jobs, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_content_jobs_by_module(
    requesting_user_id: str,
    module_id: str
) -> Dict[str, Any]:
    """
    Get all content jobs for a specific module.
    Permission: Manager+ in the same company as the module.
    """
    try:
        db = get_service_supabase_client()
        # Get module's company
        company_id = await get_module_company_id(module_id)
        if not company_id:
            return {"data": None, "error": "Module not found"}
        
        # Check permissions
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Insufficient privileges or company mismatch"
            }
        
        # Get all jobs for this module
        resp = db.table('content_jobs').select('*').eq(
            'module_id', module_id
        ).order('created_at', desc=True).execute()
        
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def create_content_job(
    requesting_user_id: str,
    job_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new content job.
    Permission: Company admin or manager in the same company as the module.
    """
    module_id = job_data.get('module_id')
    
    if not module_id:
        return {"data": None, "error": "module_id is required"}
    
    try:
        db = get_service_supabase_client()
        # Get module's company
        company_id = await get_module_company_id(module_id)
        if not company_id:
            return {"data": None, "error": "Module not found"}
        
        # Check permissions
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Manager role required"
            }
        
        # Create the content job
        resp = db.table('content_jobs').insert(job_data).execute()
        
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def update_content_job(
    requesting_user_id: str,
    job_id: int,
    updates: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Update an existing content job.
    Permission: Manager+ in the same company as the module.
    """
    try:
        db = get_service_supabase_client()
        # Get the existing job to check permissions
        existing_job_resp = db.table('content_jobs').select(
            'module_id'
        ).eq('id', job_id).maybe_single().execute()
        
        if not existing_job_resp.data:
            return {"data": None, "error": "Content job not found"}
        
        module_id = existing_job_resp.data.get('module_id')
        
        # Get module's company
        company_id = await get_module_company_id(module_id)
        if not company_id:
            return {"data": None, "error": "Module not found"}
        
        # Check permissions
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Insufficient privileges or company mismatch"
            }
        
        # Add updated_at timestamp
        updates['updated_at'] = 'now()'
        
        # Update the job
        resp = db.table('content_jobs').update(updates).eq(
            'id', job_id
        ).execute()
        
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def delete_content_job(
    requesting_user_id: str,
    job_id: int
) -> Dict[str, Any]:
    """
    Delete a content job.
    Permission: Company admin in the same company as the module.
    """
    try:
        db = get_service_supabase_client()
        # Get the existing job to check permissions
        existing_job_resp = db.table('content_jobs').select(
            'module_id'
        ).eq('id', job_id).maybe_single().execute()
        
        if not existing_job_resp.data:
            return {"data": None, "error": "Content job not found"}
        
        module_id = existing_job_resp.data.get('module_id')
        
        # Get module's company
        company_id = await get_module_company_id(module_id)
        if not company_id:
            return {"data": None, "error": "Module not found"}
        
        # Check permissions (requires company_admin for deletion)
        has_permission = await check_user_permission(requesting_user_id, 'company_admin')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Company admin role required"
            }
        
        # Delete the job
        resp = db.table('content_jobs').delete().eq('id', job_id).execute()
        
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_content_jobs_stats(
    requesting_user_id: str,
    company_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get statistics about content jobs (counts by status).
    Permission: Manager+ can see stats for their company.
    """
    try:
        db = get_service_supabase_client()
        # Check permissions
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        if not has_permission:
            return {
                "data": None,
                "error": "Permission denied: Manager role required"
            }
        
        # If no company_id provided, use requesting user's company
        if not company_id:
            user_resp = db.table('users').select('company_id').eq(
                'user_id', requesting_user_id
            ).maybe_single().execute()
            
            if not user_resp.data:
                return {"data": None, "error": "User not found"}
            
            company_id = user_resp.data.get('company_id')
        else:
            # Verify user has access to the requested company
            has_access = await check_company_access(requesting_user_id, company_id)
            if not has_access:
                return {
                    "data": None,
                    "error": "Permission denied: Company access required"
                }
        
        # Get all jobs with module info
        resp = db.table('content_jobs').select(
            'id, status, training_modules(company_id)'
        ).execute()
        
        jobs = resp.data or []
        
        # Filter by company and count by status
        stats = {
            'pending': 0,
            'in_progress': 0,
            'completed': 0,
            'failed': 0,
            'total': 0
        }
        
        for job in jobs:
            module = job.get('training_modules', {})
            job_company_id = module.get('company_id') if isinstance(module, dict) else None
            
            if job_company_id == company_id:
                status = job.get('status', 'pending')
                if status in stats:
                    stats[status] += 1
                stats['total'] += 1
        
        return {"data": stats, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
