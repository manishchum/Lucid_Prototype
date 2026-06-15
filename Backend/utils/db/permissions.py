from typing import Dict, Any, Optional
from ..auth_bridge import get_service_supabase_client
import uuid as _uuid
from ..supabase_client import supabase

# ==================== PERMISSION HELPERS ====================

def _resolve_user_id_for_permissions(service_supabase, user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None

    try:
        _uuid.UUID(str(user_id))
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


async def check_user_permission(user_id: str, required_role: str) -> bool:
    """
    Determine if user has at least the required role level.
    - Reads active role assignments and roles.level from DB.
    - Accepts synonyms for common role names (e.g. 'company_admin' -> ADMIN).
    """
    try:
        service_supabase = get_service_supabase_client()
        # If caller provided a Firebase UID (legacy X-User-ID), try to resolve it
        # to the internal `users.user_id` (UUID) to avoid invalid UUID errors
        # when querying DB columns typed as uuid.
        def _is_uuid(val: str) -> bool:
            try:
                _uuid.UUID(str(val))
                return True
            except Exception:
                return False

        def _resolve_firebase_uid_to_user_id(val: str) -> str:
            # If it's already a UUID, return as-is.
            if _is_uuid(val):
                return val
            try:
                resp = supabase.table('users').select('user_id').eq('firebase_uid', val).maybe_single().execute()
                data = getattr(resp, 'data', None)
                if isinstance(data, dict) and data.get('user_id'):
                    return str(data.get('user_id'))
            except Exception as e:
                # Don't fail here; we'll fall back to original value and let
                # the main query handle the absence of roles.
                print(f"[permissions] firebase_uid lookup failed: {e}")
            return val

        user_id = _resolve_firebase_uid_to_user_id(user_id)
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

        resolved_user_id = _resolve_user_id_for_permissions(service_supabase, user_id)
        if not resolved_user_id:
            return False

        # fetch active role assignments for the user with joined role level
        resp = service_supabase.table('user_role_assignments').select('is_active, role:roles(level,name)').eq(
            'user_id', resolved_user_id
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
        service_supabase = get_service_supabase_client()
        # Developers can operate across companies.
        if await check_user_permission(user_id, 'developer'):
            return True

        resolved_user_id = _resolve_user_id_for_permissions(service_supabase, user_id)
        if not resolved_user_id:
            return False

        resp = service_supabase.table('users').select('company_id').eq('user_id', resolved_user_id).maybe_single().execute()
        if not resp.data:
            return False
        return str(resp.data.get('company_id')) == str(company_id)
    except Exception as e:
        print(f"[check_company_access] exception: {e}")
        return False
