from typing import Dict, Any
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access

# ==================== ASSIGNMENT OPERATIONS ====================

async def create_assignment(
    requesting_user_id: str,
    assignment_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Assign a module to a user.
    Permission: Must be manager+ in the same company.
    """
    company_id = assignment_data.get('company_id')
    
    if not company_id:
        return {"data": None, "error": "company_id is required"}
    
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Only managers can assign modules"
        }
    
    try:
        response = supabase.table('assignments').insert(assignment_data).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_user_assignments(
    requesting_user_id: str,
    target_user_id: str
) -> Dict[str, Any]:
    """
    Get all assignments for a user.
    Permission: User viewing their own assignments OR manager+ in same company.
    """
    is_self = requesting_user_id == target_user_id
    
    if not is_self:
        # Get target user's company
        target_user = supabase.table('users').select('company_id').eq(
            'user_id', target_user_id
        ).single().execute()
        
        if not target_user.data:
            return {"data": None, "error": "User not found"}
        
        target_company = target_user.data['company_id']
        
        has_permission = await check_user_permission(requesting_user_id, 'manager')
        has_access = await check_company_access(requesting_user_id, target_company)
        
        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Can only view your own assignments"
            }
    
    try:
        response = supabase.table('assignments').select(
            '*, module:training_modules(*)'
        ).eq('user_id', target_user_id).order('created_at', desc=True).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
