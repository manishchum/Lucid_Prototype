from typing import Dict, Any, Optional
from ..auth_bridge import get_service_supabase_client
from .permissions import check_user_permission, check_company_access

# ==================== LEARNING STYLE OPERATIONS ====================

async def get_learning_style_by_user_id(
    requesting_user_id: str,
    target_user_id: str
) -> Dict[str, Any]:
    """
    Get learning style by user ID.
    Permission: Self OR manager+ in same company.
    """
    try:
        # Check if requesting user is viewing their own data
        is_self = requesting_user_id == target_user_id
        
        if not is_self:
            # Get target user's company for permission check
            user_resp = supabase.table('users').select('company_id').eq(
                'user_id', target_user_id
            ).maybe_single().execute()
            
            if not user_resp.data:
                return {"data": None, "error": "User not found"}
            
            target_company = user_resp.data['company_id']
            has_perm = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, target_company)
            
            if not has_perm or not has_access:
                return {"data": None, "error": "Permission denied"}
        
        # Fetch learning style
        resp = supabase.table('employee_learning_style').select('*').eq(
            'user_id', target_user_id
        ).maybeSingle().execute()
        
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_learning_styles_by_company(
    requesting_user_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Get all learning styles for users in a company.
    Permission: Manager+ in the same company.
    """
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Manager access required"
        }
    
    try:
        # Join with users table to filter by company
        response = supabase.table('employee_learning_style').select(
            '*, users!inner(company_id, name, email)'
        ).eq('users.company_id', company_id).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def create_learning_style(
    requesting_user_id: str,
    learning_style_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new learning style record.
    Permission: Self (creating own record) OR company_admin+ in same company.
    """
    user_id = learning_style_data.get('user_id')
    
    if not user_id:
        return {"data": None, "error": "user_id is required"}
    
    # Check if requesting user is creating their own record
    is_self = requesting_user_id == user_id
    
    if not is_self:
        # Get target user's company for permission check
        user_resp = supabase.table('users').select('company_id').eq(
            'user_id', user_id
        ).maybe_single().execute()
        
        if not user_resp.data:
            return {"data": None, "error": "User not found"}
        
        target_company = user_resp.data['company_id']
        has_permission = await check_user_permission(requesting_user_id, 'company_admin')
        has_access = await check_company_access(requesting_user_id, target_company)
        
        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Only company admins can create learning styles for other users"
            }
    
    try:
        # Check if learning style already exists for this user
        existing_resp = supabase.table('employee_learning_style').select('*').eq(
            'user_id', user_id
        ).maybeSingle().execute()
        
        if existing_resp.data:
            return {
                "data": None,
                "error": "Learning style already exists for this user. Use update instead."
            }
        
        response = supabase.table('employee_learning_style').insert(
            learning_style_data
        ).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def update_learning_style(
    requesting_user_id: str,
    target_user_id: str,
    updates: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Update an existing learning style record.
    Permission: Self OR company_admin+ in same company.
    """
    try:
        # Check if requesting user is updating their own record
        is_self = requesting_user_id == target_user_id
        
        if not is_self:
            # Get target user's company for permission check
            user_resp = supabase.table('users').select('company_id').eq(
                'user_id', target_user_id
            ).maybe_single().execute()
            
            if not user_resp.data:
                return {"data": None, "error": "User not found"}
            
            target_company = user_resp.data['company_id']
            has_permission = await check_user_permission(requesting_user_id, 'company_admin')
            has_access = await check_company_access(requesting_user_id, target_company)
            
            if not has_permission or not has_access:
                return {
                    "data": None,
                    "error": "Permission denied: Only company admins can update learning styles for other users"
                }
        
        # Remove user_id from updates to prevent changing the primary key
        updates.pop('user_id', None)
        
        response = supabase.table('employee_learning_style').update(updates).eq(
            'user_id', target_user_id
        ).execute()
        
        if not response.data:
            return {"data": None, "error": "Learning style not found"}
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def upsert_learning_style(
    requesting_user_id: str,
    learning_style_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create or update a learning style record (upsert).
    Permission: Self OR company_admin+ in same company.
    """
    user_id = learning_style_data.get('user_id')
    
    if not user_id:
        return {"data": None, "error": "user_id is required"}
    
    # Check if requesting user is upserting their own record
    is_self = requesting_user_id == user_id
    
    if not is_self:
        # Get target user's company for permission check
        user_resp = supabase.table('users').select('company_id').eq(
            'user_id', user_id
        ).maybe_single().execute()
        
        if not user_resp.data:
            return {"data": None, "error": "User not found"}
        
        target_company = user_resp.data['company_id']
        has_permission = await check_user_permission(requesting_user_id, 'company_admin')
        has_access = await check_company_access(requesting_user_id, target_company)
        
        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Only company admins can manage learning styles for other users"
            }
    
    try:
        response = supabase.table('employee_learning_style').upsert(
            learning_style_data,
            on_conflict='user_id'
        ).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def delete_learning_style(
    requesting_user_id: str,
    target_user_id: str
) -> Dict[str, Any]:
    """
    Delete a learning style record.
    Permission: Company_admin+ in same company.
    """
    try:
        # Get target user's company for permission check
        user_resp = supabase.table('users').select('company_id').eq(
            'user_id', target_user_id
        ).maybe_single().execute()
        
        if not user_resp.data:
            return {"data": None, "error": "User not found"}
        
        target_company = user_resp.data['company_id']
        has_permission = await check_user_permission(requesting_user_id, 'company_admin')
        has_access = await check_company_access(requesting_user_id, target_company)
        
        if not has_permission or not has_access:
            return {
                "data": None,
                "error": "Permission denied: Only company admins can delete learning styles"
            }
        
        response = supabase.table('employee_learning_style').delete().eq(
            'user_id', target_user_id
        ).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
