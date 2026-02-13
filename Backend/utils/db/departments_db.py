from typing import Dict, Any
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access

# ==================== DEPARTMENT OPERATIONS ====================

async def get_departments_by_company(
    requesting_user_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Fetch all departments for a company.
    Permission: Any user in the company can view departments.
    """
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_access:
        return {
            "data": None,
            "error": "Permission denied: Not a member of this company"
        }
    
    try:
        response = supabase.table('departments').select('*').eq(
            'company_id', company_id
        ).order('name').execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def create_department(
    requesting_user_id: str,
    dept_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new department.
    Permission: Must be company_admin+ in the same company.
    """
    company_id = dept_data.get('company_id')
    
    if not company_id:
        return {"data": None, "error": "company_id is required"}
    
    has_permission = await check_user_permission(requesting_user_id, 'company_admin')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Only company admins can create departments"
        }
    
    try:
        response = supabase.table('departments').insert(dept_data).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
