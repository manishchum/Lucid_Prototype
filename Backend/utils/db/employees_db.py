from typing import Any, Dict, List

from ..auth_bridge import get_service_supabase_client
from .permissions import check_company_access, check_user_permission
from utils.redis_client import get_cache, set_cache
from utils.db.learning_plan_db import get_company_learning_plans

async def get_employees_bootstrap(
    requesting_user_id: str,
    company_id: str,
) -> Dict[str, Any]:
    """
    Load the dashboard bootstrap payload for a company.
    Returns users, roles, departments, training modules, and learning plans.
    """
    cache_key = f"employees_bootstrap:{company_id}"

    cached = get_cache(cache_key)
    if cached:
        return {"data": cached, "error": None}

    try:
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, company_id)

        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Insufficient privileges or company mismatch",
            }

        service_client = get_service_supabase_client()

        users_resp = (
            service_client
            .table('users')
            .select(
                'user_id, company_id, name, email, phone, position, hire_date, '
                'employment_status, function_id, sub_function_id, manager_id, avatar_url, last_login, '
                'login_count, is_active, created_at, updated_at'
            )
            .eq('company_id', company_id)
            .eq('is_active', True)
            .order('name')
            .execute()
        )

        users = users_resp.data or []
        if users:
            user_ids = [u.get('user_id') for u in users if u.get('user_id')]
            role_assignments_resp = (
                service_client
                .table('user_role_assignments')
                .select('user_id, is_active, role:roles(name, display_name, level)')
                .in_('user_id', user_ids)
                .execute()
            )
            assignments = role_assignments_resp.data or []
            active_assignments_by_user: Dict[str, List[Dict[str, Any]]] = {}
            for assignment in assignments:
                if assignment.get('is_active') is False:
                    continue
                user_id = assignment.get('user_id')
                if not user_id:
                    continue
                active_assignments_by_user.setdefault(user_id, []).append(assignment)

            for user in users:
                user_id = user.get('user_id')
                user_assignments = active_assignments_by_user.get(user_id, [])
                if user_assignments:
                    sorted_roles = sorted(
                        (a.get('role') or {} for a in user_assignments),
                        key=lambda r: r.get('level', 0),
                        reverse=True
                    )
                    top_role = sorted_roles[0] if sorted_roles else None
                    if top_role:
                        user['role'] = {
                            'name': top_role.get('name'),
                            'display_name': top_role.get('display_name') or top_role.get('name'),
                            'level': top_role.get('level')
                        }
        else:
            users = []

        roles_resp = (
            service_client
            .table('roles')
            .select('*')
            .order('level')
            .execute()
        )

        functions_resp = (
            service_client
            .table('function')
            .select('*, sub_functions:sub_function(*)')
            .eq('company_id', company_id)
            .order('function_name')
            .execute()
        )

        modules_resp = (
            service_client
            .table('training_modules')
            .select('*')
            .eq('company_id', company_id)
            .order('created_at', desc=True)
            .execute()
        )

        plans_result = await get_company_learning_plans(
            requesting_user_id,
            company_id,
            250
        )
        
        plans = plans_result.get("data",[])

        response_payload = {
            'users': users_resp.data or [],
            'roles': roles_resp.data or [],
            'functions': functions_resp.data or [],
            'training_modules': modules_resp.data or [],
            'learning_plans': plans,
        }

        set_cache(cache_key, response_payload, ttl=300)
        return {"data": response_payload, "error": None}
    except Exception as exc:
        return {"data": None, "error": str(exc)}