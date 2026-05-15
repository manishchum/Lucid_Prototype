from typing import Dict, Any
from ..supabase_client import supabase

# ==================== PERMISSION HELPERS ====================

async def check_user_permission(user_id: str, required_role: str) -> bool:
    """
    Determine if user has at least the required role level.
    - Reads active role assignments and roles.level from DB.
    - Accepts synonyms for common role names (e.g. 'company_admin' -> ADMIN).
    """
    try:
        # normalize required_role to a level
        role_aliases = {
            'developer': 6, 'DEVELOPER': 6,
            'super_admin': 4, 'SUPER_ADMIN': 4, 'SUPERADMIN': 4, 'ceo': 4, 'CEO': 4,
            'admin': 3, 'ADMIN': 3, 'company_admin': 3,
            'manager': 2, 'Manager': 2,
            'user': 1, 'USER': 1
        }
        req_level = role_aliases.get(required_role, None)
        # if caller passed a numeric-like string, allow it
        if req_level is None:
            try:
                req_level = int(required_role)
            except Exception:
                # default to manager-level if unknown
                req_level = 2

        # fetch active role assignments for the user with joined role level
        resp = supabase.table('user_role_assignments').select('is_active, role:roles(level,name)').eq(
            'user_id', user_id
        ).execute()

        # Backward compatibility: NULL is_active is treated as active.
        assignments = [a for a in (resp.data or []) if a.get('is_active') is not False]
        if not assignments:
            return False

        # compute max level from assigned roles
        max_level = 0
        for a in assignments:
            role = a.get('role') or {}
            level = role.get('level') or 0
            try:
                level = int(level)
            except Exception:
                level = 0
            if level > max_level:
                max_level = level

        return max_level >= req_level
    except Exception as e:
        print(f"[check_user_permission] exception: {e}")
        return False

async def check_company_access(user_id: str, company_id: str) -> bool:
    """
    Ensure the user belongs to the given company_id.
    """
    try:
        # Developers can operate across companies.
        if await check_user_permission(user_id, 'developer'):
            return True

        resp = supabase.table('users').select('company_id').eq('user_id', user_id).execute()
        if not resp.data:
            return False
        user_company_data = resp.data[0] if resp.data else {}
        return str(user_company_data.get('company_id')) == str(company_id)
    except Exception as e:
        print(f"[check_company_access] exception: {e}")
        return False
