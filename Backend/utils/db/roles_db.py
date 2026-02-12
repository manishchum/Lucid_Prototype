from typing import Dict, Any, Optional
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access

# ==================== ROLE OPERATIONS ====================

async def get_all_roles(requesting_user_id: str) -> Dict[str, Any]:
    """
    Fetch all available roles from the roles table.
    Permission: Any authenticated user (for dropdowns).
    """
    try:
        response = supabase.table('roles').select('*').order('level').execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


# ==================== USER ROLE ASSIGNMENT OPERATIONS ====================

async def assign_user_role(
    requesting_user_id: str,
    target_user_id: str,
    role_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new role assignment in user_role_assignments table.
    
    Schema fields:
    - user_id: UUID (required)
    - role_id: UUID (required)
    - scope_type: TEXT (required) - 'COMPANY', 'DEPARTMENT', 'TEAM', 'PROJECT'
    - scope_id: UUID (required)
    - assigned_by: UUID (auto-set to requesting_user_id)
    - expires_at: TIMESTAMP (optional)
    - notes: TEXT (optional)
    - is_active: BOOLEAN (defaults to true)
    
    Permission: company_admin+ in the same company.
    """
    try:
        # Fetch target user's company
        target_resp = supabase.table('users').select('company_id').eq(
            'user_id', target_user_id
        ).single().execute()
        
        if not target_resp.data:
            return {"data": None, "error": "Target user not found"}
        
        target_company = target_resp.data['company_id']
        
        # Normalize and validate scope_type
        scope_type = (role_data.get('scope_type') or '').upper()
        valid_scope_types = ['COMPANY', 'DEPARTMENT', 'TEAM', 'PROJECT']
        
        if scope_type not in valid_scope_types:
            return {
                "data": None,
                "error": f"Invalid scope_type. Must be one of: {', '.join(valid_scope_types)}"
            }
        
        scope_id = role_data.get('scope_id')
        
        # Default company scope_id when missing and scope_type is COMPANY
        if scope_type == 'COMPANY' and not scope_id:
            scope_id = target_company
        
        # Require scope_id for all scope types
        if not scope_id:
            return {"data": None, "error": "scope_id is required for role assignment"}
        
        # Validate role_id is provided
        role_id = role_data.get('role_id')
        if not role_id:
            return {"data": None, "error": "role_id is required"}
        
        # Permission check: company admins only
        has_perm = await check_user_permission(requesting_user_id, 'company_admin')
        has_access = await check_company_access(requesting_user_id, str(target_company))
        
        if not has_perm or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Only company admins can assign roles"
            }
        
        # Build assignment object
        assignment = {
            "user_id": target_user_id,
            "role_id": role_id,
            "scope_type": scope_type,
            "scope_id": scope_id,
            "assigned_by": requesting_user_id,
            "expires_at": role_data.get('expires_at'),
            "notes": role_data.get('notes'),
            "is_active": role_data.get('is_active', True)
        }
        
        resp = supabase.table('user_role_assignments').insert(assignment).execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_user_roles(
    requesting_user_id: str,
    target_user_id: str
) -> Dict[str, Any]:
    """
    Fetch all active role assignments for a user.
    Returns assignments with joined role details.
    
    Permission: self OR manager+ in same company.
    """
    try:
        is_self = requesting_user_id == target_user_id
        
        if not is_self:
            # Get target user's company
            target_resp = supabase.table('users').select('company_id').eq(
                'user_id', target_user_id
            ).single().execute()
            
            if not target_resp.data:
                return {"data": None, "error": "User not found"}
            
            # Permission check
            has_perm = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(
                requesting_user_id,
                target_resp.data['company_id']
            )
            
            if not has_perm or not has_access:
                return {"data": None, "error": "Permission denied"}
        
        # Fetch active role assignments with role details
        resp = supabase.table('user_role_assignments').select(
            '*, role:roles(*)'
        ).eq('user_id', target_user_id).eq('is_active', True).execute()
        
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_all_role_assignments(
    requesting_user_id: str,
    company_id: str,
    include_inactive: bool = False
) -> Dict[str, Any]:
    """
    Fetch all role assignments for a company.
    Optionally include inactive assignments.
    
    Permission: manager+ in the company.
    """
    try:
        # Permission check
        has_perm = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, company_id)
        
        if not has_perm or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Only managers can view all role assignments"
            }
        
        # Build query - get assignments for users in this company
        query = supabase.table('user_role_assignments').select(
            '*, role:roles(*), user:users!user_id(user_id, name, email, company_id)'
        )
        
        if not include_inactive:
            query = query.eq('is_active', True)
        
        resp = query.execute()
        
        # Filter to only include users from the requesting company
        if resp.data:
            filtered = [
                assignment for assignment in resp.data
                if assignment.get('user', {}).get('company_id') == company_id
            ]
            return {"data": filtered, "error": None}
        
        return {"data": [], "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_role_assignment(
    requesting_user_id: str,
    assignment_id: str,
    updates: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Update an existing role assignment.
    Allowed fields: expires_at, notes, is_active
    
    Permission: company_admin+ in the same company as the assigned user.
    """
    try:
        # Get the assignment with user info
        assignment_resp = supabase.table('user_role_assignments').select(
            '*, user:users!user_id(company_id)'
        ).eq('user_role_assignment_id', assignment_id).single().execute()
        
        if not assignment_resp.data:
            return {"data": None, "error": "Role assignment not found"}
        
        user_company = assignment_resp.data.get('user', {}).get('company_id')
        
        # Permission check
        has_perm = await check_user_permission(requesting_user_id, 'company_admin')
        has_access = await check_company_access(requesting_user_id, user_company)
        
        if not has_perm or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Only company admins can update role assignments"
            }
        
        # Only allow updating specific fields
        allowed_fields = {'expires_at', 'notes', 'is_active'}
        filtered_updates = {
            k: v for k, v in updates.items() if k in allowed_fields
        }
        
        if not filtered_updates:
            return {"data": None, "error": "No valid fields to update"}
        
        # Update the assignment
        resp = supabase.table('user_role_assignments').update(
            filtered_updates
        ).eq('user_role_assignment_id', assignment_id).execute()
        
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def revoke_role_assignment(
    requesting_user_id: str,
    assignment_id: str
) -> Dict[str, Any]:
    """
    Revoke a role assignment (soft delete by setting is_active = false).
    
    Permission: company_admin+ in the same company as the assigned user.
    """
    try:
        # Get the assignment with user info
        assignment_resp = supabase.table('user_role_assignments').select(
            '*, user:users!user_id(company_id)'
        ).eq('user_role_assignment_id', assignment_id).single().execute()
        
        if not assignment_resp.data:
            return {"data": None, "error": "Role assignment not found"}
        
        user_company = assignment_resp.data.get('user', {}).get('company_id')
        
        # Permission check
        has_perm = await check_user_permission(requesting_user_id, 'company_admin')
        has_access = await check_company_access(requesting_user_id, user_company)
        
        if not has_perm or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Only company admins can revoke role assignments"
            }
        
        # Soft delete by setting is_active to false
        resp = supabase.table('user_role_assignments').update(
            {"is_active": False}
        ).eq('user_role_assignment_id', assignment_id).execute()
        
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
