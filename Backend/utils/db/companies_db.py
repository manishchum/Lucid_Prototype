from typing import Dict, Any, Optional
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access

# ==================== COMPANY OPERATIONS ====================

async def get_company_by_id(requesting_user_id: Optional[str], company_id: str) -> Dict[str, Any]:
    """
    Get company by ID.
    Permission: Any authenticated user can view any company (basic info).
    """
    try:
        resp = supabase.table('companies').select('*').eq('company_id', company_id).single().execute()
        if not resp.data:
            return {"data": None, "error": "Company not found"}
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_company_by_name(requesting_user_id: Optional[str], company_name: str) -> Dict[str, Any]:
    """
    Get company by name (case-insensitive).
    Permission: Public access (for signup validation).
    """
    try:
        resp = supabase.table('companies').select('*').ilike('name', company_name).maybeSingle().execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_company_by_domain(requesting_user_id: Optional[str], domain: str) -> Dict[str, Any]:
    """
    Get company by domain.
    Permission: Public access (for signup/email domain validation).
    """
    try:
        resp = supabase.table('companies').select('*').eq('domain', domain).single().execute()
        if not resp.data:
            return {"data": None, "error": "Company not found"}
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def list_all_companies(requesting_user_id: str) -> Dict[str, Any]:
    """
    List all companies.
    Permission: Super admin only.
    """
    has_permission = await check_user_permission(requesting_user_id, 'super_admin')
    if not has_permission:
        return {"data": None, "error": "Permission denied: Super admin access required"}
    
    try:
        resp = supabase.table('companies').select('*').order('name').execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def create_company(requesting_user_id: Optional[str], company_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a new company.
    Permission: Super admin OR public signup (requesting_user_id is None).
    """
    # If requesting_user_id is provided, check super_admin permission
    if requesting_user_id:
        has_permission = await check_user_permission(requesting_user_id, 'super_admin')
        if not has_permission:
            return {"data": None, "error": "Permission denied: Super admin access required"}
    
    # Validate required fields
    if not company_data.get('name'):
        return {"data": None, "error": "Company name is required"}
    
    if not company_data.get('domain'):
        return {"data": None, "error": "Company domain is required"}
    
    try:
        resp = supabase.table('companies').insert(company_data).execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        error_msg = str(e)
        # Check for unique constraint violation on domain
        if '23505' in error_msg or 'duplicate key' in error_msg.lower():
            return {"data": None, "error": "A company with this domain already exists"}
        return {"data": None, "error": error_msg}


async def update_company(requesting_user_id: str, company_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Update company details.
    Permission: Admin+ of the same company OR super admin.
    """
    # Check if user has access to this company
    has_access = await check_company_access(requesting_user_id, company_id)
    has_permission = await check_user_permission(requesting_user_id, 'admin')
    
    if not has_access or not has_permission:
        return {"data": None, "error": "Permission denied: Admin access required for this company"}
    
    try:
        resp = supabase.table('companies').update(update_data).eq('company_id', company_id).execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def delete_company(requesting_user_id: str, company_id: str) -> Dict[str, Any]:
    """
    Delete a company.
    Permission: Super admin only.
    """
    has_permission = await check_user_permission(requesting_user_id, 'super_admin')
    if not has_permission:
        return {"data": None, "error": "Permission denied: Super admin access required"}
    
    try:
        resp = supabase.table('companies').delete().eq('company_id', company_id).execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def search_companies(requesting_user_id: Optional[str], search_term: str, limit: int = 10) -> Dict[str, Any]:
    """
    Search companies by name with a partial match (case-insensitive).
    Permission: Public access (for signup), but requires minimum 2 characters for privacy.
    
    Args:
        requesting_user_id: Optional user ID (can be None for public signup)
        search_term: Search term (minimum 2 characters)
        limit: Maximum number of results to return (default: 10)
    
    Returns:
        Dictionary with matching companies data or error
    """
    # Validate minimum search term length for privacy
    if not search_term or len(search_term.strip()) < 2:
        return {"data": None, "error": "Search term must be at least 2 characters"}
    
    try:
        # Use ilike for case-insensitive partial matching with wildcards
        search_pattern = f"%{search_term.strip()}%"
        resp = supabase.table('companies').select('company_id, name, domain').ilike('name', search_pattern).limit(limit).order('name').execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
