from typing import Dict, Any, Optional, List
from datetime import datetime
from ..auth_bridge import get_service_supabase_client
from .permissions import check_user_permission, check_company_access
from .learning_plan_db import refresh_learning_plan_status
from utils.redis_client import delete_cache_pattern

# ==================== MODULE PROGRESS OPERATIONS ====================

async def get_progress_by_id(requesting_user_id: str, progress_id: str) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Get single module progress record by ID.
    Permission: Self OR manager+ in same company.
    """
    try:
        resp = supabase.table('module_progress').select(
            '*, users!inner(company_id, name, email), processed_modules(title, original_module_id)'
        ).eq('module_progress_id', progress_id).maybe_single().execute()
        
        if not resp or not getattr(resp, 'data', None):
            return {"data": None, "error": "Progress record not found"}
        
        progress = resp.data
        user_company = progress.get('users', {}).get('company_id')
        progress_user_id = progress.get('user_id')
        
        # Check if requesting user is viewing their own progress
        is_self = requesting_user_id == progress_user_id
        
        if not is_self:
            # Must be manager+ in same company
            has_permission = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, user_company)
            
            if not has_permission or not has_access:
                return {"data": None, "error": "Permission denied: Insufficient privileges"}
        
        return {"data": progress, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_progress_by_user(requesting_user_id: str, target_user_id: str, 
                               completed_only: bool = False,
                               auth_claims: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Get all module progress records for a specific user.
    Permission: Self OR manager+ in same company.
    """
    try:
        query_client = supabase

        is_self = requesting_user_id == target_user_id

        if not is_self:
            # We must use service client for authorization lookups to bypass RLS walls
            user_resp = supabase.table('users').select('company_id').eq('user_id', target_user_id).maybe_single().execute()
            if not user_resp or not getattr(user_resp, 'data', None):
                return {"data": None, "error": "User not found"}
            
            target_company = user_resp.data.get('company_id')
            has_permission = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, target_company)
            
            if not has_permission or not has_access:
                return {"data": None, "error": "Permission denied: Insufficient privileges"}
        
        # Build query
        query = query_client.table('module_progress').select(
            '*, processed_modules(title, original_module_id, learning_style)'
        ).eq('user_id', target_user_id).order('started_at', desc=True)
        
        if completed_only:
            query = query.not_('completed_at', 'is', None)
        
        resp = query.execute()
        return {"data": getattr(resp, 'data', None), "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_progress_by_processed_module(requesting_user_id: str, processed_module_id: str) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Get all progress records for a specific processed module.
    Permission: Manager+ in the company that owns the module.
    """
    try:
        # Get module's company
        module_resp = supabase.table('processed_modules').select(
            'training_modules!inner(company_id)'
        ).eq('processed_module_id', processed_module_id).maybe_single().execute()
        
        if not module_resp or not getattr(module_resp, 'data', None):
            return {"data": None, "error": "Processed module not found"}
        
        module_company = module_resp.data.get('training_modules', {}).get('company_id')
        
        # Check permissions
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, module_company)
        
        if not has_permission or not has_access:
            return {"data": None, "error": "Permission denied: Manager access required"}
        
        resp = supabase.table('module_progress').select(
            '*, users!inner(name, email)'
        ).eq('processed_module_id', processed_module_id).order('started_at', desc=True).execute()
        
        return {"data": getattr(resp, 'data', None), "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_progress_by_user_and_module(requesting_user_id: str, user_id: str,
                                          processed_module_id: str) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Get progress record for a specific user and processed module.
    Permission: Self OR manager+ in same company.
    """
    try:
        is_self = requesting_user_id == user_id

        if not is_self:
            # Get user's company
            user_resp = supabase.table('users').select('company_id').eq('user_id', user_id).maybe_single().execute()
            if not user_resp or not getattr(user_resp, 'data', None):
                return {"data": None, "error": "User not found"}
            
            user_company = user_resp.data.get('company_id')
            has_permission = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, user_company)

            if not has_permission or not has_access:
                return {"data": None, "error": "Permission denied: Insufficient privileges"}

        resp = supabase.table('module_progress').select(
            '*, processed_modules(title, original_module_id)'
        ).eq('user_id', user_id).eq('processed_module_id', processed_module_id).maybe_single().execute()
        
        return {"data": getattr(resp, 'data', None), "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_progress_by_company(requesting_user_id: str, company_id: str,
                                  user_id: Optional[str] = None,
                                  completed_only: bool = False) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Get all module progress records for a company (optionally filtered by user).
    Permission: Manager+ in the company.
    """
    try:
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_permission or not has_access:
            return {"data": None, "error": "Permission denied: Manager access required"}
        
        # Build query with company filter through users table
        query = supabase.table('module_progress').select(
            '*, users!inner(name, email, company_id), processed_modules(title, original_module_id)'
        ).eq('users.company_id', company_id).order('started_at', desc=True)
        
        if user_id:
            query = query.eq('user_id', user_id)
        
        if completed_only:
            query = query.not_('completed_at', 'is', None)
        
        resp = query.execute()
        return {"data": getattr(resp, 'data', None), "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def create_or_update_progress(requesting_user_id: str, progress_data: Dict[str, Any]) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Create or update a module progress record (upsert functionality).
    Permission: Self (for own progress) OR manager+ in same company.
    
    This handles the common case where frontend doesn't know if a record exists.
    """
    try:
        user_id = progress_data.get('user_id')
        processed_module_id = progress_data.get('processed_module_id')
        
        module_id = progress_data.get("module_id")

        if not module_id:
            pm_resp = (
                supabase.table("processed_modules")
                .select("original_module_id")
                .eq("processed_module_id", processed_module_id)
                .maybe_single()
                .execute()
            )

            if pm_resp.data:
                module_id = pm_resp.data["original_module_id"]
        
        if not user_id or not processed_module_id:
            return {"data": None, "error": "user_id and processed_module_id are required"}
        
        # Get user's company
        user_resp = supabase.table('users').select('company_id').eq('user_id', user_id).maybe_single().execute()
        
        if not user_resp or not getattr(user_resp, 'data', None):
            return {"data": None, "error": "User not found"}
        
        user_company = user_resp.data.get('company_id')
        is_self = requesting_user_id == user_id
        
        if not is_self:
            has_permission = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, user_company)
            
            if not has_permission or not has_access:
                return {"data": None, "error": "Permission denied: Can only update own progress or must be manager+"}
        
        # Check if progress record exists
        existing = supabase.table('module_progress').select('module_progress_id, completed_at').eq(
            'user_id', user_id
        ).eq('processed_module_id', processed_module_id).maybe_single().execute()
        
        view_only = progress_data.get('viewOnly', False)
        
        existing_data = getattr(existing, 'data', None)
        
        if existing_data:

            if view_only:

                if module_id:
                    await refresh_learning_plan_status(
                        user_id=user_id,
                        module_id=module_id
                    )

                delete_cache_pattern(f"dashboard_summary:{user_id}*")
                delete_cache_pattern("analytics:*")

                return {
                    "data": existing_data,
                    "error": None,
                    "action": "view"
                }
            
            # Update existing record
            progress_id = existing_data['module_progress_id']
            
            # Build update data
            update_data = {}
            
            # Only update fields that are provided
            if 'quiz_score' in progress_data:
                update_data['quiz_score'] = progress_data['quiz_score']
            
            if 'quiz_feedback' in progress_data:
                update_data['quiz_feedback'] = progress_data['quiz_feedback']
            
            if 'audio_listen_duration' in progress_data:
                update_data['audio_listen_duration'] = progress_data['audio_listen_duration']
            
            if 'completed_at' in progress_data:
                update_data['completed_at'] = progress_data['completed_at']
            elif progress_data.get('quiz_score') is not None:
                # Auto-mark as completed if quiz score is provided
                update_data['completed_at'] = datetime.utcnow().isoformat()
            
            # Handle pass_status calculation
            if 'quiz_score' in progress_data and 'max_score' in progress_data:
                quiz_score = progress_data['quiz_score']
                max_score = progress_data['max_score']
                
                if quiz_score is not None and max_score:
                    # Get module's threshold
                    module_id = progress_data.get('module_id')
                    if not module_id:
                        # Fetch from processed_modules
                        pm_resp = supabase.table('processed_modules').select(
                            'original_module_id'
                        ).eq('processed_module_id', processed_module_id).maybe_single().execute()
                        
                        if pm_resp and getattr(pm_resp, "data", None):
                            module_id = pm_resp.data.get('original_module_id')
                    
                    if module_id:
                        threshold_resp = ( 
                            supabase.table('training_modules')
                            .select('threshold_value')
                            .eq('module_id', module_id)
                            .maybe_single()
                            .execute()
                        )
                        if (
                            threshold_resp and getattr(threshold_resp, "data", None)
                            and threshold_resp.data.get("threshold_value") is not None
                        ):
                            score_percentage = (quiz_score / max_score) * 100
                            update_data['pass_status'] = score_percentage >= threshold_resp.data['threshold_value']
            
            if not update_data:
                return {"data": existing_data, "error": None, "action": "no_change"}
            
            resp = (
                supabase.table("module_progress")
                .update(update_data)
                .eq("module_progress_id", progress_id)
                .execute()
            )

            if module_id:
                await refresh_learning_plan_status(
                    user_id=user_id,
                    module_id=module_id
                )

            delete_cache_pattern(f"dashboard_summary:{user_id}*")
            delete_cache_pattern("analytics:*")

            return {
                "data": getattr(resp, "data", None),
                "error": None,
                "action": "updated"
            }
        
        else:
            # Create new record
            insert_data = {
                'user_id': user_id,
                'processed_module_id': processed_module_id,
                'started_at': progress_data.get('started_at', datetime.utcnow().isoformat()),
            }
            
            # Add optional fields
            if 'quiz_score' in progress_data:
                insert_data['quiz_score'] = progress_data['quiz_score']
            
            if 'quiz_feedback' in progress_data:
                insert_data['quiz_feedback'] = progress_data['quiz_feedback']
            
            if 'audio_listen_duration' in progress_data:
                insert_data['audio_listen_duration'] = progress_data['audio_listen_duration']
            
            if 'completed_at' in progress_data:
                insert_data['completed_at'] = progress_data['completed_at']
            
            if 'pass_status' in progress_data:
                insert_data['pass_status'] = progress_data['pass_status']
            
            resp = (
                supabase.table("module_progress")
                .insert(insert_data)
                .execute()
            )

            if module_id:
                await refresh_learning_plan_status(
                    user_id=user_id,
                    module_id=module_id
                )

            delete_cache_pattern(f"dashboard_summary:{user_id}*")
            delete_cache_pattern("analytics:*")

            return {
                "data": getattr(resp, "data", None),
                "error": None,
                "action": "created"
            }
    
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_progress(requesting_user_id: str, progress_id: str,
                         update_data: Dict[str, Any]) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Update an existing module progress record.
    Permission: Self (for own progress) OR manager+ in same company.
    """
    try:
        # Get existing progress to check ownership
        existing = supabase.table('module_progress').select(
            '*, users!inner(company_id)'
        ).eq('module_progress_id', progress_id).maybe_single().execute()
        
        if not existing or not getattr(existing, 'data', None):
            return {"data": None, "error": "Progress record not found"}
        
        progress_user_id = existing.data.get('user_id')
        user_company = existing.data.get('users', {}).get('company_id')
        is_self = requesting_user_id == progress_user_id
        
        if not is_self:
            has_permission = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, user_company)
            
            if not has_permission or not has_access:
                return {"data": None, "error": "Permission denied: Can only update own progress or must be manager+"}
        
        # Filter allowed fields
        allowed_fields = {
            'quiz_score', 'quiz_feedback', 'audio_listen_duration', 
            'completed_at', 'pass_status', 'viewed_at'
        }
        filtered_update = {k: v for k, v in update_data.items() if k in allowed_fields}
        
        if not filtered_update:
            return {"data": None, "error": "No valid fields to update"}
        
        resp = supabase.table('module_progress').update(filtered_update).eq(
            'module_progress_id', progress_id
        ).execute()
        
        return {"data": getattr(resp, 'data', None), "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def delete_progress(requesting_user_id: str, progress_id: str) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Delete a module progress record.
    Permission: Manager+ in same company (hard delete for data cleanup).
    """
    try:
        # Get existing progress to check permissions
        existing = supabase.table('module_progress').select(
            '*, users!inner(company_id)'
        ).eq('module_progress_id', progress_id).maybe_single().execute()
        
        if not existing or not getattr(existing, 'data', None):
            return {"data": None, "error": "Progress record not found"}
        
        user_company = existing.data.get('users', {}).get('company_id')
        
        # Only manager+ can delete progress records
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, user_company)
        
        if not has_permission or not has_access:
            return {"data": None, "error": "Permission denied: Manager access required"}
        
        resp = supabase.table('module_progress').delete().eq(
            'module_progress_id', progress_id
        ).execute()
        
        return {"data": getattr(resp, 'data', None), "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_completion_stats(requesting_user_id: str, company_id: str) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Get completion statistics for a company.
    Permission: Manager+ in the company.
    """
    try:
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_permission or not has_access:
            return {"data": None, "error": "Permission denied: Manager access required"}
        
        # Get all progress records for the company
        resp = supabase.table('module_progress').select(
            'module_progress_id, completed_at, pass_status, users!inner(company_id)'
        ).eq('users.company_id', company_id).execute()
        
        if not resp or not getattr(resp, 'data', None):
            return {"data": {"total": 0, "completed": 0, "passed": 0, "failed": 0}, "error": None}
        
        resp_data = getattr(resp, 'data', [])
        total = len(resp_data)
        completed = len([r for r in resp_data if r.get('completed_at')])
        passed = len([r for r in resp_data if r.get('pass_status') is True])
        failed = len([r for r in resp_data if r.get('completed_at') and r.get('pass_status') is False])
        
        stats = {
            "total": total,
            "completed": completed,
            "passed": passed,
            "failed": failed,
            "completion_rate": round((completed / total * 100), 2) if total > 0 else 0,
            "pass_rate": round((passed / completed * 100), 2) if completed > 0 else 0
        }
        
        return {"data": stats, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
