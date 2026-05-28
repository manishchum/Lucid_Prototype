from ..auth_bridge import get_service_supabase_client
from typing import Dict, Any, Optional, List
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access
from ..supabase_client import supabase

# ==================== COMPANY OPERATIONS ====================

async def get_company_by_id(requesting_user_id: Optional[str], company_id: str) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Get company by ID.
    Permission: Any authenticated user can view any company (basic info).
    """
    try:
        resp = supabase.table('companies').select('*').eq('company_id', company_id).maybe_single().execute()
        if not resp.data:
            return {"data": None, "error": "Company not found"}
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_company_by_name(requesting_user_id: Optional[str], company_name: str) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Get company by name (case-insensitive).
    Permission: Public access (for signup validation).
    """
    try:
        resp = supabase.table('companies').select('*').ilike('name', company_name).maybe_single().execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_company_by_domain(requesting_user_id: Optional[str], domain: str) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
    """
    Get company by domain.
    Permission: Public access (for signup/email domain validation).
    """
    try:
        resp = supabase.table('companies').select('*').eq('domain', domain).maybe_single().execute()
        if not resp.data:
            return {"data": None, "error": "Company not found"}
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def list_all_companies(requesting_user_id: str) -> Dict[str, Any]:
    supabase = get_service_supabase_client()
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
    supabase = get_service_supabase_client()
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

    if not company_data.get('company_logo'):
        return {"data": None, "error": "Company logo is required"}
    
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
    supabase = get_service_supabase_client()
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
    supabase = get_service_supabase_client()
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
    supabase = get_service_supabase_client()
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


async def get_org_templates_from_sub_department(requesting_user_id: str) -> Dict[str, Any]:
    """
    Fetch default org templates from sub_department table.
    Permission: Super admin or developer.
    """
    has_super_admin = await check_user_permission(requesting_user_id, 'super_admin')
    has_developer = await check_user_permission(requesting_user_id, 'developer')
    if not has_super_admin and not has_developer:
        return {"data": None, "error": "Permission denied: Super admin access required"}

    try:
        resp = (
            supabase
            .table('sub_department')
            .select('department_id, department_name, sub_department_name')
            .order('department_name')
            .order('sub_department_name')
            .execute()
        )
        return {"data": resp.data or [], "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def provision_company_functions(
    requesting_user_id: str,
    company_id: str,
    selected_department_ids: List[str],
    custom_entries: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Provision function/sub_function rows for a company using
    selected sub_department templates and optional custom mappings.
    Permission: Super admin or developer.
    """
    has_super_admin = await check_user_permission(requesting_user_id, 'super_admin')
    has_developer = await check_user_permission(requesting_user_id, 'developer')
    if not has_super_admin and not has_developer:
        return {"data": None, "error": "Permission denied: Super admin access required"}

    try:
        company_resp = (
            supabase
            .table('companies')
            .select('company_id')
            .eq('company_id', company_id)
            .single()
            .execute()
        )
        if not company_resp.data:
            return {"data": None, "error": "Company not found"}

        template_rows: List[Dict[str, Any]] = []
        unique_selected_ids = list({sid for sid in (selected_department_ids or []) if sid})
        if unique_selected_ids:
            template_resp = (
                supabase
                .table('sub_department')
                .select('department_id, department_name, sub_department_name')
                .in_('department_id', unique_selected_ids)
                .execute()
            )
            template_rows = template_resp.data or []

        normalized_custom_entries: List[Dict[str, Optional[str]]] = []
        for entry in (custom_entries or []):
            function_name = (entry.get('function_name') or '').strip()
            sub_function_name = (entry.get('sub_function_name') or '').strip() or None
            if function_name:
                normalized_custom_entries.append({
                    'function_name': function_name,
                    'sub_function_name': sub_function_name,
                })

        function_to_subfunctions: Dict[str, set] = {}

        for row in template_rows:
            function_name = (row.get('department_name') or '').strip()
            sub_function_name = (row.get('sub_department_name') or '').strip()
            if not function_name:
                continue
            if function_name not in function_to_subfunctions:
                function_to_subfunctions[function_name] = set()
            if sub_function_name:
                function_to_subfunctions[function_name].add(sub_function_name)

        for entry in normalized_custom_entries:
            function_name = (entry.get('function_name') or '').strip()
            sub_function_name = (entry.get('sub_function_name') or '').strip() if entry.get('sub_function_name') else ''
            if not function_name:
                continue
            if function_name not in function_to_subfunctions:
                function_to_subfunctions[function_name] = set()
            if sub_function_name:
                function_to_subfunctions[function_name].add(sub_function_name)

        if not function_to_subfunctions:
            return {
                "data": {
                    "functions_created": 0,
                    "sub_functions_created": 0,
                    "functions_existing": 0,
                    "sub_functions_existing": 0,
                },
                "error": None,
            }

        functions_created = 0
        sub_functions_created = 0
        functions_existing = 0
        sub_functions_existing = 0

        for function_name, subfunctions in function_to_subfunctions.items():
            existing_function_resp = (
                supabase
                .table('function')
                .select('function_id')
                .eq('company_id', company_id)
                .eq('function_name', function_name)
                .limit(1)
                .execute()
            )

            existing_functions = existing_function_resp.data or []
            if existing_functions:
                function_id = existing_functions[0].get('function_id')
                functions_existing += 1
            else:
                insert_function_resp = (
                    supabase
                    .table('function')
                    .insert({
                        'company_id': company_id,
                        'function_name': function_name,
                        'is_active': True,
                    })
                    .execute()
                )
                inserted_functions = insert_function_resp.data or []
                if not inserted_functions:
                    return {"data": None, "error": f"Failed to create function: {function_name}"}
                function_id = inserted_functions[0].get('function_id')
                functions_created += 1

            if not function_id:
                return {"data": None, "error": f"Missing function_id for function: {function_name}"}

            for sub_function_name in sorted(subfunctions):
                existing_sub_resp = (
                    supabase
                    .table('sub_function')
                    .select('sub_function_id')
                    .eq('function_id', function_id)
                    .eq('sub_function_name', sub_function_name)
                    .limit(1)
                    .execute()
                )
                existing_sub_rows = existing_sub_resp.data or []
                if existing_sub_rows:
                    sub_functions_existing += 1
                    continue

                insert_sub_resp = (
                    supabase
                    .table('sub_function')
                    .insert({
                        'function_id': function_id,
                        'sub_function_name': sub_function_name,
                        'is_active': True,
                    })
                    .execute()
                )
                inserted_sub_rows = insert_sub_resp.data or []
                if not inserted_sub_rows:
                    return {"data": None, "error": f"Failed to create sub function: {sub_function_name}"}
                sub_functions_created += 1

        return {
            "data": {
                "functions_created": functions_created,
                "sub_functions_created": sub_functions_created,
                "functions_existing": functions_existing,
                "sub_functions_existing": sub_functions_existing,
            },
            "error": None,
        }
    except Exception as e:
        return {"data": None, "error": str(e)}
