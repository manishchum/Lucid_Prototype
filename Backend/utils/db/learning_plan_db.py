"""
Database operations for learning_plan table.
Handles CRUD operations with permission checks.
"""

from typing import Dict, Any, List, Optional
from utils.supabase_client import supabase
import uuid
from ..auth_bridge import get_service_supabase_client
from .permissions import check_user_permission
from utils.assignment_notifications import send_assignment_notification_email
from utils.redis_client import get_cache, set_cache, redis_client


def _resolve_app_user_id(service_supabase, user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None

    try:
        uuid.UUID(str(user_id))
        return str(user_id)
    except Exception:
        pass

    try:
        resp = (
            service_supabase
            .table('users')
            .select('user_id')
            .eq('firebase_uid', str(user_id))
            .maybe_single()
            .execute()
        )
        data = getattr(resp, 'data', None)
        if isinstance(data, dict) and data.get('user_id'):
            return str(data.get('user_id'))
    except Exception:
        return None

    return None

async def get_user_company_id(
    user_id: str
) -> Optional[str]:

    cache_key = f"user_company:{user_id}"

    cached = get_cache(cache_key)

    if cached:
        return cached

    try:
        db = get_service_supabase_client()

        resolved_user_id = _resolve_app_user_id(
            db,
            user_id
        )

        if not resolved_user_id:
            return None

        resp = (
            db.table("users")
            .select("company_id")
            .eq("user_id", resolved_user_id)
            .maybe_single()
            .execute()
        )

        company_id = (
            resp.data.get("company_id")
            if resp.data
            else None
        )

        if company_id:
            set_cache(
                cache_key,
                company_id,
                ttl=3600
            )

        return company_id

    except Exception:
        return None


async def check_company_access(requesting_user_id: str, target_user_id: str) -> bool:
    """Check if requesting user has access to target user (same company)"""
    try:
        requesting_company = await get_user_company_id(requesting_user_id)
        target_company = await get_user_company_id(target_user_id)
        
        if not requesting_company or not target_company:
            return False
        
        return requesting_company == target_company
    except Exception:
        return False


async def get_learning_plan_by_id(
    requesting_user_id: str,
    learning_plan_id: str
) -> Dict[str, Any]:
    """
    Get a single learning plan by ID.
    Permission: User can view their own plan, manager+ can view plans in their company.
    """
    try:
        db = get_service_supabase_client()
        resolved_requesting_user_id = _resolve_app_user_id(db, requesting_user_id) or requesting_user_id
        # Fetch the learning plan
        resp = db.table('learning_plan').select(
            '*, users(user_id, name, email, company_id), training_modules(module_id, title, company_id)'
        ).eq('learning_plan_id', learning_plan_id).maybe_single().execute()
        
        if not resp.data:
            return {"data": None, "error": "Learning plan not found"}
        
        plan = resp.data
        plan_user_id = plan.get('user_id')
        
        # Check if user is viewing their own plan
        if resolved_requesting_user_id == plan_user_id:
            return {"data": plan, "error": None}
        
        # Check if user has manager+ permission and same company
        has_permission = await check_user_permission(resolved_requesting_user_id, 'manager')
        if not has_permission:
            return {"data": None, "error": "Permission denied: Manager role required"}
        
        has_access = await check_company_access(resolved_requesting_user_id, plan_user_id)
        if not has_access:
            return {"data": None, "error": "Access denied: Different company"}
        
        return {"data": plan, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def list_learning_plans(
    requesting_user_id: str,
    user_id: Optional[str] = None,
    module_id: Optional[str] = None,
    status: Optional[str] = None,
    baseline_assessment: Optional[bool] = None,
    limit: Optional[int] = None
) -> Dict[str, Any]:
    """
    List learning plans with optional filters.
    Permission: User sees only their own plans, manager+ sees plans in their company.
    """
    try:
        db = get_service_supabase_client()
        resolved_requesting_user_id = _resolve_app_user_id(db, requesting_user_id) or requesting_user_id
        # Build query
        query = db.table('learning_plan').select(
            '*, users(user_id, name, email, company_id), training_modules(module_id, title, company_id)'
        )
        
        # Check if user has manager+ permission
        has_permission = await check_user_permission(resolved_requesting_user_id, 'manager')
        
        if not has_permission:
            # Regular user can only see their own plans
            query = query.eq('user_id', resolved_requesting_user_id)
        else:
            # Manager+ can filter by user_id or see all in their company
            if user_id:
                # Check company access
                has_access = await check_company_access(resolved_requesting_user_id, user_id)
                if not has_access:
                    return {"data": None, "error": "Access denied: Different company"}
                query = query.eq('user_id', user_id)
            else:
                # Filter by company
                user_company_id = await get_user_company_id(resolved_requesting_user_id)
                if not user_company_id:
                    return {"data": None, "error": "User company not found"}
        
        # Apply filters
        if module_id:
            query = query.eq('module_id', module_id)
        if status:
            query = query.eq('status', status)
        if baseline_assessment is not None:
            query = query.eq('baseline_assessment', baseline_assessment)
        
        # Order by most recent first
        query = query.order('assigned_on', desc=True)
        
        if limit:
            query = query.limit(limit)
        
        resp = query.execute()
        
        # Filter by company if manager+
        plans = resp.data or []
        if has_permission:
            user_company_id = await get_user_company_id(resolved_requesting_user_id)
            filtered_plans = []
            for plan in plans:
                user_data = plan.get('users', {})
                plan_company_id = user_data.get('company_id') if isinstance(user_data, dict) else None
                if plan_company_id == user_company_id:
                    filtered_plans.append(plan)
            plans = filtered_plans
        
        return {"data": plans, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_user_learning_plans(
    requesting_user_id: str,
    target_user_id: str
) -> Dict[str, Any]:
    """
    Get all learning plans for a specific user.
    Permission: User can view their own plans, manager+ can view plans in their company.
    """
    # Check if user is viewing their own plans
    resolved_requesting_user_id = requesting_user_id
    try:
        db = get_service_supabase_client()
        resolved_requesting_user_id = _resolve_app_user_id(db, requesting_user_id) or requesting_user_id
    except Exception:
        pass

    if resolved_requesting_user_id != target_user_id:
        # Check if user has manager+ permission
        has_permission = await check_user_permission(resolved_requesting_user_id, 'manager')
        if not has_permission:
            return {"data": None, "error": "Permission denied: Manager role required"}
        
        # Check company access
        has_access = await check_company_access(resolved_requesting_user_id, target_user_id)
        if not has_access:
            return {"data": None, "error": "Access denied: Different company"}
    
    return await list_learning_plans(resolved_requesting_user_id, user_id=target_user_id)


async def create_learning_plan(
    requesting_user_id: str,
    plan_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new learning plan.
    Permission: Manager+ can create plans for users in their company.
    """
    try:
        # Check if user has manager+ permission
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        if not has_permission:
            return {"data": None, "error": "Permission denied: Manager role required"}
        
        # Validate required fields
        user_id = plan_data.get('user_id')
        module_id = plan_data.get('module_id')
        
        if not user_id or not module_id:
            return {"data": None, "error": "user_id and module_id are required"}
        
        # Check company access
        has_access = await check_company_access(requesting_user_id, user_id)
        if not has_access:
            return {"data": None, "error": "Access denied: Cannot create plan for user in different company"}
        
        # Verify module exists and belongs to same company
        module_resp = supabase.table('training_modules').select('company_id').eq(
            'module_id', module_id
        ).maybe_single().execute()
        
        if not module_resp.data:
            return {"data": None, "error": "Training module not found"}
        
        user_company_id = await get_user_company_id(requesting_user_id)
        module_company_id = module_resp.data.get('company_id')
        
        if module_company_id != user_company_id:
            return {"data": None, "error": "Module belongs to different company"}
        
        # Set default status if not provided
        if 'status' not in plan_data:
            plan_data['status'] = 'ASSIGNED'

        # If this module has processed modules (i.e., it's a sprint composed of multiple
        # processed_module entries), fetch them and attach processed_module_ids so the
        # frontend can render all child modules. This is a safe, best-effort enrichment
        # and will be skipped on error.
        try:
            pm_resp = supabase.table('processed_modules').select('processed_module_id').eq(
                'original_module_id', module_id
            ).execute()
            pm_rows = pm_resp.data or []
            if pm_rows and isinstance(pm_rows, list):
                plan_data['processed_module_ids'] = [r.get('processed_module_id') for r in pm_rows if r.get('processed_module_id')]
        except Exception:
            # don't block plan creation if this enrichment fails
            pass
        
        # Create the learning plan
        resp = supabase.table('learning_plan').insert(plan_data).execute()
        
        if not resp.data:
            return {"data": None, "error": "Failed to create learning plan"}

        created_plan = resp.data[0] if isinstance(resp.data, list) else resp.data

        try:
            user_resp = supabase.table('users').select('user_id, email, name').eq(
                'user_id', user_id
            ).single().execute()
            module_title_resp = supabase.table('training_modules').select('title').eq(
                'module_id', module_id
            ).single().execute()
            company_resp = supabase.table('companies').select('name').eq(
                'company_id', user_company_id
            ).single().execute()

            user_row = user_resp.data if user_resp.data else None
            module_row = module_title_resp.data if module_title_resp.data else None
            company_row = company_resp.data if company_resp.data else None

            if user_row and module_row and company_row:
                notification_result = await send_assignment_notification_email(
                    recipient_email=user_row.get('email', ''),
                    recipient_name=user_row.get('name', 'Employee'),
                    recipient_user_id=user_row.get('user_id', user_id),
                    assignment_title=module_row.get('title', 'New Sprint'),
                    company_name=company_row.get('name', 'Your company'),
                    assignment_kind='sprint',
                )
                created_plan['notification'] = notification_result
        except Exception as notification_error:
            created_plan['notification_error'] = str(notification_error)
        
        return {"data": created_plan, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_learning_plan(
    requesting_user_id: str,
    learning_plan_id: str,
    updates: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Update a learning plan.
    Permission: User can update their own plan (limited fields), manager+ can update plans in their company.
    """
    try:
        # Fetch the learning plan to check ownership
        plan_resp = supabase.table('learning_plan').select('user_id').eq(
            'learning_plan_id', learning_plan_id
        ).maybe_single().execute()
        
        if not plan_resp.data:
            return {"data": None, "error": "Learning plan not found"}
        
        plan_user_id = plan_resp.data.get('user_id')
        resolved_requesting_user_id = requesting_user_id
        try:
            db = get_service_supabase_client()
            resolved_requesting_user_id = _resolve_app_user_id(db, requesting_user_id) or requesting_user_id
        except Exception:
            pass
        
        # Check if user is updating their own plan
        if resolved_requesting_user_id == plan_user_id:
            # Users can only update certain fields (status, started_at, completed_at, processed_module_ids)
            allowed_fields = ['status', 'started_at', 'completed_at', 'overall_status', 'processed_module_ids']
            filtered_updates = {k: v for k, v in updates.items() if k in allowed_fields}
            
            if not filtered_updates:
                return {"data": None, "error": "No valid fields to update"}
            
            updates = filtered_updates
        else:
            # Check if user has manager+ permission
            has_permission = await check_user_permission(resolved_requesting_user_id, 'manager')
            if not has_permission:
                return {"data": None, "error": "Permission denied: Manager role required"}
            
            # Check company access
            has_access = await check_company_access(resolved_requesting_user_id, plan_user_id)
            if not has_access:
                return {"data": None, "error": "Access denied: Different company"}
        
        # Don't allow updating user_id
        if 'user_id' in updates:
            del updates['user_id']
        
        # Update the learning plan
        resp = supabase.table('learning_plan').update(updates).eq(
            'learning_plan_id', learning_plan_id
        ).execute()
        
        if not resp.data:
            return {"data": None, "error": "Failed to update learning plan"}
        
        return {"data": resp.data[0] if isinstance(resp.data, list) else resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def delete_learning_plan(
    requesting_user_id: str,
    learning_plan_id: str
) -> Dict[str, Any]:
    """
    Delete a learning plan.
    Permission: Manager+ only, same company.
    """
    try:
        # Check if user has manager+ permission
        resolved_requesting_user_id = requesting_user_id
        try:
            db = get_service_supabase_client()
            resolved_requesting_user_id = _resolve_app_user_id(db, requesting_user_id) or requesting_user_id
        except Exception:
            pass

        has_permission = await check_user_permission(resolved_requesting_user_id, 'manager')
        if not has_permission:
            return {"data": None, "error": "Permission denied: Manager role required"}
        
        # Fetch the learning plan to check company
        plan_resp = supabase.table('learning_plan').select('user_id').eq(
            'learning_plan_id', learning_plan_id
        ).maybe_single().execute()
        
        if not plan_resp.data:
            return {"data": None, "error": "Learning plan not found"}
        
        plan_user_id = plan_resp.data.get('user_id')
        
        # Check company access
        has_access = await check_company_access(resolved_requesting_user_id, plan_user_id)
        if not has_access:
            return {"data": None, "error": "Access denied: Different company"}
        
        # Delete the learning plan
        resp = supabase.table('learning_plan').delete().eq(
            'learning_plan_id', learning_plan_id
        ).execute()
        
        return {"data": {"success": True, "message": "Learning plan deleted"}, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_learning_plan_stats(
    requesting_user_id: str,
    user_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get statistics about learning plans.
    Permission: User sees their own stats, manager+ sees stats for company.
    """
    try:
        # Determine which user's stats to get
        resolved_requesting_user_id = requesting_user_id
        try:
            db = get_service_supabase_client()
            resolved_requesting_user_id = _resolve_app_user_id(db, requesting_user_id) or requesting_user_id
        except Exception:
            pass

        target_user_id = user_id if user_id else resolved_requesting_user_id
        
        # Check permissions
        if resolved_requesting_user_id != target_user_id:
            has_permission = await check_user_permission(resolved_requesting_user_id, 'manager')
            if not has_permission:
                return {"data": None, "error": "Permission denied: Manager role required"}
            
            has_access = await check_company_access(resolved_requesting_user_id, target_user_id)
            if not has_access:
                return {"data": None, "error": "Access denied: Different company"}
        
        # Get all plans for the user
        plans_result = await list_learning_plans(resolved_requesting_user_id, user_id=target_user_id)
        
        if plans_result.get('error'):
            return plans_result
        
        plans = plans_result.get('data', [])
        
        # Calculate statistics
        stats = {
            "total": len(plans),
            "assigned": len([p for p in plans if p.get('status') == 'ASSIGNED']),
            "in_progress": len([p for p in plans if p.get('status') == 'IN_PROGRESS']),
            "completed": len([p for p in plans if p.get('status') == 'COMPLETED']),
            "baseline_assessments": len([p for p in plans if p.get('baseline_assessment') == True]),
            "module_plans": len([p for p in plans if p.get('baseline_assessment') == False])
        }
        
        return {"data": stats, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
