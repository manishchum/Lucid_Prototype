from typing import Dict, Any, Optional
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access

# ==================== USER/EMPLOYEE OPERATIONS ====================

async def get_user_by_email(requesting_user_id: Optional[str], email: str) -> Dict[str, Any]:
    """
    Return user by email. If requesting_user_id is None, allow lookup for auth bootstrap.
    """
    try:
        resp = supabase.table('users').select('*').eq('email', email).eq('is_active', True).single().execute()
        user = resp.data if hasattr(resp, 'data') else None
        if not user:
            return {"data": None, "error": "User not found"}
        # If a requesting user is provided, perform a permission check; otherwise allow lookup.
        if requesting_user_id:
            has_permission = await check_user_permission(requesting_user_id, 'user')
            if not has_permission:
                return {"data": None, "error": "Permission denied"}
        # strip sensitive fields before returning
        user.pop('password', None)
        return {"data": user, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_user_by_id(requesting_user_id: str, target_user_id: str) -> Dict[str, Any]:
    """
    Return single user. Permission: self OR manager+ in same company.
    """
    try:
        resp = supabase.table('users').select('*').eq('user_id', target_user_id).single().execute()
        if not resp.data:
            return {"data": None, "error": "User not found"}
        user = resp.data
        is_self = requesting_user_id == target_user_id
        if not is_self:
            has_perm = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, user.get('company_id'))
            if not has_perm or not has_access:
                return {"data": None, "error": "Permission denied"}
        user.pop('password', None)
        return {"data": user, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_users_by_company(
    requesting_user_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Fetch all users for a company.
    Permission: User must be manager+ in the same company.
    """
    # Check permissions
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Insufficient privileges or company mismatch"
        }
    
    try:
        response = supabase.table('users').select(
            '*'
        ).eq('company_id', company_id).order('name').execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def create_user(
    requesting_user_id: str,
    user_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new user.
    Permission: Must be company_admin+ in the same company.
    """
    company_id = user_data.get('company_id')
    
    if not company_id:
        return {"data": None, "error": "company_id is required"}
    
    has_permission = await check_user_permission(requesting_user_id, 'company_admin')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Only company admins can create users"
        }
    
    try:
        response = supabase.table('users').insert(user_data).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def update_user(
    requesting_user_id: str,
    target_user_id: str,
    updates: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Update an existing user.
    Permission: company_admin+ OR the user updating themselves (limited fields).
    """
    # Get target user's company
    target_user = supabase.table('users').select('company_id').eq(
        'user_id', target_user_id
    ).single().execute()
    
    if not target_user.data:
        return {"data": None, "error": "User not found"}
    
    target_company = target_user.data['company_id']
    
    # Check if user is updating themselves
    is_self_update = requesting_user_id == target_user_id
    
    # Check if requesting user is an admin
    is_admin = await check_user_permission(requesting_user_id, 'company_admin')
    
    if is_self_update and not is_admin:
        # Non-admin users can only update certain fields for themselves
        allowed_fields = {'name', 'email', 'phone', 'profile_picture'}
        if not set(updates.keys()).issubset(allowed_fields):
            return {
                "data": None,
                "error": "Can only update name, email, phone, profile_picture for yourself"
            }
    elif not is_self_update:
        # Updating someone else - must be company_admin in same company
        has_access = await check_company_access(requesting_user_id, target_company)
        
        if not is_admin or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Only company admins can update other users"
            }
    # If is_self_update and is_admin, allow all fields (no restrictions)
    
    try:
        response = supabase.table('users').update(updates).eq(
            'user_id', target_user_id
        ).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def delete_user(
    requesting_user_id: str,
    target_user_id: str
) -> Dict[str, Any]:
    """
    Delete a user (soft delete by setting employment_status = 'terminated').
    Permission: Must be company_admin+ in the same company.
    """
    # Get target user's company
    target_user = supabase.table('users').select('company_id').eq(
        'user_id', target_user_id
    ).single().execute()
    
    if not target_user.data:
        return {"data": None, "error": "User not found"}
    
    target_company = target_user.data['company_id']
    
    has_permission = await check_user_permission(requesting_user_id, 'company_admin')
    has_access = await check_company_access(requesting_user_id, target_company)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Only company admins can delete users"
        }
    
    try:
        # Soft delete
        response = supabase.table('users').delete().eq('user_id', target_user_id).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
