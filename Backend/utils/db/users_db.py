from typing import Dict, Any, Optional
import bcrypt
from ..supabase_client import supabase
from .permissions import check_user_permission, check_company_access

# Default password for new users
DEFAULT_PASSWORD = "workfloww@2025"

# ==================== USER/EMPLOYEE OPERATIONS ====================

async def get_user_by_email(requesting_user_id: Optional[str], email: str) -> Dict[str, Any]:
    """
    Return user by email. If requesting_user_id is None, allow lookup for auth bootstrap.
    """
    try:
        # Use select + limit(1) instead of .single() to avoid APIError on 0 rows
        resp = supabase.table('users').select(
            "user_id, email, name, phone, company_id, department_id, is_active, employment_status, created_at, password, company:companies(name)"
        ).eq('email', email).eq('is_active', True).limit(1).execute()
        rows = resp.data if hasattr(resp, 'data') else []
        user = rows[0] if rows else None
        if not user:
            print(f"[get_user_by_email] No active user found for email: {email}")
            return {"data": None, "error": "User not found"}
            
        if user and 'company' in user and user['company']:
            user['company_name'] = user['company'].get('name')
            user.pop('company', None)
        # If a requesting user is provided, perform a permission check; otherwise allow lookup.
        if requesting_user_id:
            has_permission = await check_user_permission(requesting_user_id, 'user')
            if not has_permission:
                return {"data": None, "error": "Permission denied"}
            # strip sensitive fields before returning (only when not used for auth)
            user.pop('password', None)
        # For authentication (requesting_user_id is None), keep password for validation
        return {"data": user, "error": None}
    except Exception as e:
        print(f"[get_user_by_email] Exception for {email}: {e}")
        return {"data": None, "error": str(e)}


async def get_user_by_phone(requesting_user_id: Optional[str], phone: str) -> Dict[str, Any]:
    """
    Return user by phone. If requesting_user_id is None, allow lookup for auth bootstrap.
    """
    try:
        # Use select + limit(1) instead of .single() to avoid APIError on 0 rows
        resp = supabase.table('users').select(
            "user_id, email, name, phone, company_id, department_id, is_active, employment_status, created_at, password, company:companies(name)"
        ).eq('phone', phone).eq('is_active', True).limit(1).execute()
        rows = resp.data if hasattr(resp, 'data') else []
        user = rows[0] if rows else None
        if not user:
            print(f"[get_user_by_phone] No active user found for phone: {phone}")
            return {"data": None, "error": "User not found"}
            
        if user and 'company' in user and user['company']:
            user['company_name'] = user['company'].get('name')
            user.pop('company', None)
        # If a requesting user is provided, perform a permission check; otherwise allow lookup.
        if requesting_user_id:
            has_permission = await check_user_permission(requesting_user_id, 'user')
            if not has_permission:
                return {"data": None, "error": "Permission denied"}
            # strip sensitive fields before returning (only when not used for auth)
            user.pop('password', None)
        # For authentication (requesting_user_id is None), keep password for validation
        return {"data": user, "error": None}
    except Exception as e:
        print(f"[get_user_by_number] Exception for {phone}: {e}")
        return {"data": None, "error": str(e)}

async def get_user_by_id(requesting_user_id: str, target_user_id: str) -> Dict[str, Any]:
    """
    Return single user. Permission: self OR manager+ in same company.
    """
    try:
        resp = supabase.table('users').select(
            "user_id, email, name, phone, company_id, department_id, is_active, employment_status, created_at, company:companies(name)"
        ).eq('user_id', target_user_id).execute()
        
        if not resp.data:
            return {"data": None, "error": "User not found"}
        
        user = resp.data[0] if resp.data else None
        if user and 'company' in user and user['company']:
            user['company_name'] = user['company'].get('name')
            user.pop('company', None)
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
            "user_id, email, name, phone, company_id, department_id, is_active, employment_status, created_at, company:companies(name)"
        ).eq('company_id', company_id).eq('is_active', True).order('name').execute()
        
        users = response.data or []
        for user in users:
            if user and 'company' in user and user['company']:
                user['company_name'] = user['company'].get('name')
                user.pop('company', None)
        
        return {"data": users, "error": None}
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
        email = user_data.get('email', '').lower().strip()

        # Check for an existing inactive user with the same email in this company
        if email:
            existing_resp = supabase.table('users').select('user_id').ilike('email', email).eq(
                'company_id', company_id
            ).eq('is_active', False).execute()
            existing_data = existing_resp.data[0] if existing_resp.data else None

            if existing_data:
                # Reactivate the existing user and apply any new fields from user_data
                reactivation_fields = {
                    **{k: v for k, v in user_data.items()
                       if k not in ('user_id', 'company_id', 'email', 'created_at')},
                    'is_active': True,
                    'employment_status': user_data.get('employment_status', 'ACTIVE'),
                }
                resp = supabase.table('users').update(reactivation_fields).eq(
                    'user_id', existing_data['user_id']
                ).execute()
                return {"data": resp.data, "error": None, "reactivated": True}

        # Hash password if not provided, if it's the plain default password, or if it's not already hashed
        password = user_data.get('password')
        if not password or password == DEFAULT_PASSWORD:
            # Use default password and hash it
            hashed_password = bcrypt.hashpw(
                DEFAULT_PASSWORD.encode('utf-8'),
                bcrypt.gensalt()
            ).decode('utf-8')
            user_data['password'] = hashed_password
        elif not (password.startswith('$2b$') or password.startswith('$2a$') or password.startswith('$2y$')):
            # If password doesn't look like a bcrypt hash, hash it
            hashed_password = bcrypt.hashpw(
                password.encode('utf-8'),
                bcrypt.gensalt()
            ).decode('utf-8')
            user_data['password'] = hashed_password
        # If it already looks like a bcrypt hash, leave it as-is

        response = supabase.table('users').insert(user_data).execute()
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}



async def create_user_signup(
    user_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Create a new user.
    Permission: Must be company_admin+ in the same company.
    """
    company_id = user_data.get('company_id')
    
    if not company_id:
        return {"data": None, "error": "company_id is required"}
    
   
    
    try:
        email = user_data.get('email', '').lower().strip()

        # Check for an existing inactive user with the same email in this company
        if email:
            existing_resp = supabase.table('users').select('user_id').ilike('email', email).eq(
                'company_id', company_id
            ).eq('is_active', False).execute()
            # existing_data = existing_resp.data[0] if existing_resp.data else None

            # if existing_data:
            #     # # Reactivate the existing user and apply any new fields from user_data
            #     # reactivation_fields = {
            #     #     **{k: v for k, v in user_data.items()
            #     #        if k not in ('user_id', 'company_id', 'email', 'created_at')},
            #     #     'is_active': True,
            #     #     'employment_status': user_data.get('employment_status', 'ACTIVE'),
            #     # }
            #     # resp = supabase.table('users').update(reactivation_fields).eq(
            #     #     'user_id', existing_data['user_id']
            #     # ).execute()
            #     # return {"data": resp.data, "error": None, "reactivated": True}
            #     return {"data": None, "error": "An account with this email already exists. Please contact your administrator to reactivate your account if you believe this is an error."}

        # Hash password if not provided, if it's the plain default password, or if it's not already hashed
        password = user_data.get('password')
        if not password or password == DEFAULT_PASSWORD:
            # Use default password and hash it
            hashed_password = bcrypt.hashpw(
                DEFAULT_PASSWORD.encode('utf-8'),
                bcrypt.gensalt()
            ).decode('utf-8')
            user_data['password'] = hashed_password
        elif not (password.startswith('$2b$') or password.startswith('$2a$') or password.startswith('$2y$')):
            # If password doesn't look like a bcrypt hash, hash it
            hashed_password = bcrypt.hashpw(
                password.encode('utf-8'),
                bcrypt.gensalt()
            ).decode('utf-8')
            user_data['password'] = hashed_password
        # If it already looks like a bcrypt hash, leave it as-is

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
    target_user_resp = supabase.table('users').select('company_id').eq(
        'user_id', target_user_id
    ).execute()
    
    if not target_user_resp.data:
        return {"data": None, "error": "User not found"}
    
    target_company = target_user_resp.data[0]['company_id'] if target_user_resp.data else None
    
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
    target_user_resp = supabase.table('users').select('company_id').eq(
        'user_id', target_user_id
    ).execute()
    
    if not target_user_resp.data:
        return {"data": None, "error": "User not found"}
    
    target_company = target_user_resp.data[0]['company_id'] if target_user_resp.data else None
    
    has_permission = await check_user_permission(requesting_user_id, 'company_admin')
    has_access = await check_company_access(requesting_user_id, target_company)
    
    if not has_permission or not has_access:
        return {
            "data": None,
            "error": "Permission denied: Only company admins can delete users"
        }
    
    try:
        # Deactivate all role assignments for the user first
        supabase.table('user_role_assignments').update({'is_active': False}).eq(
            'user_id', target_user_id
        ).execute()
        
        # Soft delete: mark user inactive instead of removing the row
        response = supabase.table('users').update({
            'is_active': False,
            'employment_status': 'INACTIVE'
        }).eq('user_id', target_user_id).execute()
        
        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_users_by_filter(filters: dict):
    try:
        query = supabase.table("users").select(
            "user_id, email, name, phone, company_id, department_id, is_active, employment_status, created_at, function_id, sub_function_id, title_id"
        )

        if "function_id" in filters:
            query = query.eq("function_id", filters["function_id"])
        if "sub_function_id" in filters:
            query = query.eq("sub_function_id", filters["sub_function_id"])
        if "title_id" in filters:
            query = query.eq("title_id", filters["title_id"])
        if "is_active" in filters:
            query = query.eq("is_active", filters["is_active"])
        if "employment_status" in filters:
            query = query.eq("employment_status", filters["employment_status"])

        result = query.execute()
        return {"data": result.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}
