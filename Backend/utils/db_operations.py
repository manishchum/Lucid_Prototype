from typing import Dict, Any, List, Optional
from .supabase_client import supabase
from fastapi import HTTPException

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
        resp = supabase.table('user_role_assignments').select('role:roles(level,name)').eq(
            'user_id', user_id
        ).eq('is_active', True).execute()

        assignments = resp.data or []
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
        resp = supabase.table('users').select('company_id').eq('user_id', user_id).single().execute()
        if not resp.data:
            return False
        return str(resp.data.get('company_id')) == str(company_id)
    except Exception as e:
        print(f"[check_company_access] exception: {e}")
        return False

# ==================== USER/EMPLOYEE OPERATIONS ====================

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
            'user_id, name, email, phone, company_id, department_id, is_active, created_at'
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
        allowed_fields = {'name', 'email', 'phone'}
        if not set(updates.keys()).issubset(allowed_fields):
            return {
                "data": None,
                "error": "Can only update name, email, phone for yourself"
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
        response = supabase.table('departments').select('department_id, name, company_id, created_at').eq(
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

# ==================== MODULE OPERATIONS ====================

async def get_training_modules(
    requesting_user_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Fetch all training modules with processing status.
    Permission: Manager+ can see all modules, employees see only assigned ones.
    """
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_access:
        return {
            "data": None,
            "error": "Permission denied: Not a member of this company"
        }
    
    try:
        # Get modules
        modules_response = supabase.table('training_modules').select(
            'module_id, title, gpt_summary, company_id, created_at'
        ).eq(
            'company_id', company_id
        ).order('created_at', desc=True).execute()
        
        if not modules_response.data:
            return {"data": [], "error": None}
        
        # Check if user is manager+
        is_manager = await check_user_permission(requesting_user_id, 'manager')
        
        # Enrich with status
        enriched_modules = []
        for module in modules_response.data:
            # Get job status
            job_response = supabase.table('content_jobs').select('status').eq(
                'module_id', module['module_id']
            ).maybe_single().execute()
            
            if not job_response.data:
                processing_status = 'not_started'
            elif job_response.data.get('status') == 'completed':
                processing_status = 'completed'
            elif job_response.data.get('status') == 'failed':
                processing_status = 'failed'
            else:
                processing_status = 'processing'
            
            # If not manager, only show assigned modules
            if not is_manager:
                assignment = supabase.table('assignments').select('assignment_id').eq(
                    'user_id', requesting_user_id
                ).eq('module_id', module['module_id']).maybe_single().execute()
                
                if not assignment.data:
                    continue  # Skip this module
            
            enriched_modules.append({
                **module,
                'processing_status': processing_status
            })
        
        return {"data": enriched_modules, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_completed_modules(
    requesting_user_id: str,
    company_id: str
) -> Dict[str, Any]:
    """
    Fetch only completed training modules.
    Permission: Manager+ in the company.
    """
    has_permission = await check_user_permission(requesting_user_id, 'manager')
    has_access = await check_company_access(requesting_user_id, company_id)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Only managers can view all completed modules"
        }
    
    try:
        # Get completed job module IDs
        jobs_response = supabase.table('content_jobs').select('module_id').eq(
            'status', 'completed'
        ).execute()
        
        if not jobs_response.data:
            return {"data": [], "error": None}
        
        completed_ids = [job['module_id'] for job in jobs_response.data]
        
        # Get modules
        modules_response = supabase.table('training_modules').select(
            'module_id, title, gpt_summary, company_id, created_at'
        ).eq(
            'company_id', company_id
        ).in_('module_id', completed_ids).order('title').execute()
        
        return {"data": modules_response.data or [], "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

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

# ==================== ROLE OPERATIONS ====================

async def get_all_roles(requesting_user_id: str) -> Dict[str, Any]:
    """
    Fetch all available roles.
    Permission: Any authenticated user (for dropdowns).
    """
    try:
        response = supabase.table('roles').select('role_id, name, level, description').order('level').execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
    
    
async def get_user_by_id(requesting_user_id: str, target_user_id: str) -> Dict[str, Any]:
    """
    Return single user. Permission: self OR manager+ in same company.
    """
    try:
        resp = supabase.table('users').select(
            'user_id, name, email, phone, company_id, department_id, is_active, created_at'
        ).eq('user_id', target_user_id).single().execute()
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


async def assign_user_role(requesting_user_id: str, target_user_id: str, role_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Insert into user_role_assignments after admin permission check.
    Ensures scope_id is provided; if scope_type == 'COMPANY' and scope_id missing,
    defaults scope_id to target user's company_id.
    """
    try:
        # fetch target user's company
        target_resp = supabase.table('users').select('company_id').eq('user_id', target_user_id).single().execute()
        if not target_resp.data:
            return {"data": None, "error": "Target user not found"}
        target_company = target_resp.data['company_id']

        # normalize role_data keys
        scope_type = (role_data.get('scope_type') or '').upper()
        scope_id = role_data.get('scope_id')

        # default company scope_id when missing and scope_type is COMPANY
        if scope_type == 'COMPANY' and not scope_id:
            scope_id = target_company

        # require scope_id for other scope types as well
        if not scope_id:
            return {"data": None, "error": "scope_id is required for role assignment"}

        # permission check: company admins only
        has_perm = await check_user_permission(requesting_user_id, 'company_admin')
        has_access = await check_company_access(requesting_user_id, str(target_company))
        if not has_perm or not has_access:
            return {"data": None, "error": "Permission denied: Only company admins can assign roles"}

        assignment = {
            "user_id": target_user_id,
            "assigned_by": requesting_user_id,
            "role_id": role_data.get('role_id'),
            "scope_type": scope_type,
            "scope_id": scope_id,
            "expires_at": role_data.get('expires_at'),
            "notes": role_data.get('notes'),
            "is_active": role_data.get('is_active', True)
        }

        resp = supabase.table('user_role_assignments').insert(assignment).execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}


async def get_user_roles(requesting_user_id: str, target_user_id: str) -> Dict[str, Any]:
    """
    Return active role assignments for a user. Permission: self OR manager+ in same company.
    """
    try:
        is_self = requesting_user_id == target_user_id
        if not is_self:
            target_resp = supabase.table('users').select('company_id').eq('user_id', target_user_id).single().execute()
            if not target_resp.data:
                return {"data": None, "error": "User not found"}
            has_perm = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, target_resp.data['company_id'])
            if not has_perm or not has_access:
                return {"data": None, "error": "Permission denied"}
        resp = supabase.table('user_role_assignments').select(
            'id, user_id, role_id, scope_type, scope_id, is_active, created_at, role:roles(role_id, name, level)'
        ).eq('user_id', target_user_id).eq('is_active', True).execute()
        return {"data": resp.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
    
async def get_user_by_email(requesting_user_id: Optional[str], email: str) -> Dict[str, Any]:
    """
    Return user by email. If requesting_user_id is None, allow lookup for auth bootstrap.
    """
    try:
        resp = supabase.table('users').select(
            'user_id, name, email, phone, company_id, department_id, is_active, created_at, password'
        ).eq('email', email).eq('is_active', True).single().execute()
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