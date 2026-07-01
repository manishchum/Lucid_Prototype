from typing import Dict, Any, Optional
import bcrypt
from ..supabase_client import supabase
from ..auth_bridge import get_service_supabase_client
from .permissions import check_user_permission, check_company_access

# Default password for new users
DEFAULT_PASSWORD = "workfloww@2025"

# ==================== USER/EMPLOYEE OPERATIONS ====================

import re

def normalize_phone(phone: str) -> str:
    if not phone:
        return ""

    digits = re.sub(r"\D", "", str(phone))

    # 07404336860
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]

    # 7404336860
    if len(digits) == 10:
        return f"+91{digits}"

    # 917404336860
    if digits.startswith("91") and len(digits) == 12:
        return f"+{digits}"

    # fallback
    return f"+{digits}"

async def get_user_by_email(requesting_user_id: Optional[str], email: str, auth_claims: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Return user by email. If requesting_user_id is None, allow lookup for auth bootstrap.
    """
    try:
        query_client = supabase
        if auth_claims:
            token_email = (auth_claims.get("email") or "").strip().lower()
            requested_email = (email or "").strip().lower()
            if token_email and requested_email and token_email != requested_email:
                return {"data": None, "error": "Permission denied"}
            query_client = get_service_supabase_client()

        # Use select + limit(1) instead of .single() to avoid APIError on 0 rows
        resp = query_client.table('users').select('*').eq('email', email).eq('is_active', True).limit(1).execute()
        rows = resp.data if hasattr(resp, 'data') else []
        user = rows[0] if rows else None
        if not user:
            print(f"[get_user_by_email] No active user found for email: {email}")
            return {"data": None, "error": "User not found"}
        
        # Enrich user with company subscription data
        company_id = user.get("company_id")

        if company_id:
            company_resp = query_client.table("companies") \
            .select("""
                company_id,
                name,
                company_logo,
                subscription_tier,
                subscription_addons
            """) \
            .eq("company_id", company_id) \
            .limit(1) \
            .execute()

            company_rows = company_resp.data if hasattr(company_resp, "data") else []

            if company_rows:
                company = company_rows[0]

                user["company_name"] = company.get("name")
                user["company_logo"] = company.get("company_logo")

                user["subscription_tier"] = company.get("subscription_tier")
                user["subscription_addons"] = company.get("subscription_addons", [])
        # Strip sensitive fields before returning.
        user.pop('password', None)
        return {"data": user, "error": None}
    except Exception as e:
        print(f"[get_user_by_email] Exception for {email}: {e}")
        return {"data": None, "error": str(e)}


async def get_user_by_phone(requesting_user_id: Optional[str], phone: str, auth_claims: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Return user by phone. If requesting_user_id is None, allow lookup for auth bootstrap.
    """
    try:
        query_client = supabase
        if auth_claims:
            query_client = get_service_supabase_client()

        # Use select + limit(1) instead of .single() to avoid APIError on 0 rows
        normalized_phone = normalize_phone(phone)

        possible_formats = [
            normalized_phone,
        ]

        digits = normalized_phone.replace("+91", "")

        possible_formats.extend([
            digits,
            f"0{digits}",
            f"91{digits}"
        ])

        possible_formats = list(set(possible_formats))

        resp = (
            query_client
            .table("users")
            .select("*")
            .in_("phone", possible_formats)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        rows = resp.data if hasattr(resp, 'data') else []
        user = rows[0] if rows else None
        if auth_claims and user and requesting_user_id and str(user.get("user_id")) != str(requesting_user_id):
            return {"data": None, "error": "Permission denied"}
        if not user:
            print(f"[get_user_by_phone] No active user found for phone: {phone}")
            return {"data": None, "error": "User not found"}
                # Enrich user with company subscription data
        company_id = user.get("company_id")

        if company_id:
            company_resp = (
                query_client.table("companies")
                .select("""
                    company_id,
                    name,
                    company_logo,
                    subscription_tier,
                    subscription_addons
                """)
                .eq("company_id", company_id)
                .limit(1)
                .execute()
            )

            company_rows = company_resp.data if hasattr(company_resp, "data") else []

            if company_rows:
                company = company_rows[0]

                user["company_name"] = company.get("name")
                user["company_logo"] = company.get("company_logo")
                user["subscription_tier"] = company.get("subscription_tier")
                user["subscription_addons"] = company.get("subscription_addons", [])
        # Strip sensitive fields before returning.
        user.pop('password', None)
        return {"data": user, "error": None}
    except Exception as e:
        print(f"[get_user_by_number] Exception for {phone}: {e}")
        return {"data": None, "error": str(e)}

async def get_user_by_id(requesting_user_id: str, target_user_id: str) -> Dict[str, Any]:
    """
    Return single user. Permission: self OR manager+ in same company.
    """
    try:
        resp = supabase.table('users').select().eq('user_id', target_user_id).single().execute()
        if not resp.data:
            return {"data": None, "error": "User not found"}
        user = resp.data
        is_self = requesting_user_id == target_user_id
        if not is_self:
            has_perm = await check_user_permission(requesting_user_id, 'manager')
            has_access = await check_company_access(requesting_user_id, user.get('company_id'))
            if not has_perm or not has_access:
                return {"data": None, "error": "Permission denied"}
        company_id = user.get("company_id")

        if company_id:
            company_resp = supabase.table("companies") \
                .select("subscription_tier, subscription_addons") \
                .eq("company_id", company_id) \
                .limit(1) \
                .execute()

            company_rows = company_resp.data if hasattr(company_resp, "data") else []

            if company_rows:
                company = company_rows[0]

                user["subscription_tier"] = company.get("subscription_tier")
                user["subscription_addons"] = company.get("subscription_addons", [])
        user.pop('password', None)
        return {"data": user, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_users_by_company(
    requesting_user_id: str,
    company_id: str,
    auth_claims: Optional[Dict[str, Any]] = None,
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
        query_client = supabase
        if auth_claims:
            query_client = get_service_supabase_client()

        response = query_client.table('users').select(
            '''
            user_id,
            company_id,
            name,
            email,
            phone,
            position,
            hire_date,
            employment_status,
            department_id,
            is_active,
            created_at
            '''
        ).eq('company_id', company_id).eq('is_active', True).order('name').execute()
        
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
    service_client = get_service_supabase_client()
    
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
            existing_resp = service_client.table('users').select('*').ilike('email', email).eq(
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
                resp = service_client.table('users').update(reactivation_fields).eq(
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

        response = service_client.table("users").insert(user_data).execute()

        # ------------------------------
        # Auto-create default learning style
        # ------------------------------
        if response.data:
            created_user = response.data[0]
            company_id = created_user.get("company_id")

            company_resp = (
                service_client
                .table("companies")
                .select("learning_style")
                .eq("company_id", company_id)
                .maybe_single()
                .execute()
            )

            company = company_resp.data or {}

            # Company does NOT use learning styles
            if company.get("learning_style") is False:

                service_client.table("employee_learning_style").insert({
                    "user_id": created_user["user_id"],
                    "answers": {},
                    "learning_style": "default",
                    "gpt_analysis": None,
                }).execute()

        return {"data": response.data, "error": None}

    except Exception as e:
        import traceback
        traceback.print_exc()
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
            existing_resp = supabase.table('users').select().ilike('email', email).eq(
                'company_id', company_id
            ).eq('is_active', False).maybe_single().execute()
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
    try:
        db = get_service_supabase_client()

        # Get target user's company without raising on 0 rows.
        target_user = db.table('users').select('company_id').eq(
            'user_id', target_user_id
        ).maybe_single().execute()

        if not target_user.data:
            return {"data": None, "error": "User not found"}

        target_company = target_user.data.get('company_id')

        # Check if user is updating themselves
        is_self_update = requesting_user_id == target_user_id

        # Check if requesting user is an admin
        is_admin = await check_user_permission(requesting_user_id, 'company_admin')

        if is_self_update and not is_admin:
            # Non-admin users can only update certain fields for themselves
            allowed_fields = {'name', 'email', 'phone', 'position', 'profile_picture'}
            if not set(updates.keys()).issubset(allowed_fields):
                return {
                    "data": None,
                    "error": "Can only update name, email, phone, position, profile_picture for yourself"
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

        response = db.table('users').update(updates).eq(
            'user_id', target_user_id
        ).execute()

        updated = response.data[0] if isinstance(response.data, list) and response.data else response.data
        if not updated:
            return {"data": None, "error": "User not found or no changes applied"}

        return {"data": updated, "error": None}
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
    service_client = get_service_supabase_client()
    try:
        # Get target user's company
        target_user = service_client.table('users').select('company_id').eq(
            'user_id', target_user_id
        ).maybe_single().execute()

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

        # Deactivate all role assignments for the user first
        service_client.table('user_role_assignments').update({'is_active': False}).eq(
            'user_id', target_user_id
        ).execute()

        # Soft delete: mark user inactive instead of removing the row
        response = service_client.table('users').update({
            'is_active': False,
            'employment_status': 'INACTIVE'
        }).eq('user_id', target_user_id).execute()

        return {"data": response.data, "error": None}
    except Exception as e:
        return {"data": None, "error": str(e)}

async def get_users_by_filter(filters: dict):
    try:
        query = supabase.table("users").select()

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

# async def bulk_create_user(
#     users:list[dict]
# ):