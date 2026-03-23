from fastapi import APIRouter, Header, Query
from pydantic import BaseModel, EmailStr
from typing import Optional, List

from utils.db.users_db import (
    get_user_by_email,
    get_users_by_company,
    get_user_by_id,
    create_user,
    create_user_signup,
    update_user,
    delete_user,
    get_users_by_filter
)

from utils.db.roles_db import (
    assign_user_role,
    get_user_roles
)

from utils.exceptions import NotFoundError, ValidationError

router = APIRouter(prefix="/api/users", tags=["users"])


class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str
    company_id: str
    password: Optional[str] = None  # Optional - can be set later by user
    department_id: Optional[str] = None
    manager_id: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    hire_date: Optional[str] = None  # Accept as string (YYYY-MM-DD format)
    title_id: Optional[str] = None
    function_id: Optional[str] = None
    sub_function_id: Optional[str] = None


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    position: Optional[str] = None
    department_id: Optional[str] = None
    manager_id: Optional[str] = None
    avatar_url: Optional[str] = None
    employment_status: Optional[str] = None
    title_id: Optional[str] = None
    function_id: Optional[str] = None
    sub_function_id: Optional[str] = None
    ready_status: Optional[bool] = None


class AssignRoleRequest(BaseModel):
    role_id: str
    scope_type: str
    scope_id: str
    expires_at: Optional[str] = None
    notes: Optional[str] = None


@router.get("/")
async def list_users_by_filter(
    function_id: Optional[str] = Query(None),
    sub_function_id: Optional[str] = Query(None),
    title_id: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    employment_status: Optional[str] = Query(None),
    user_id: Optional[str] = Header(None, alias="X-User-ID")
):
    """List users by filter criteria."""
    filters = {}
    if function_id:
        filters["function_id"] = function_id
    if sub_function_id:
        filters["sub_function_id"] = sub_function_id
    if title_id:
        filters["title_id"] = title_id
    if is_active is not None:
        filters["is_active"] = is_active
    if employment_status:
        filters["employment_status"] = employment_status

    data = await get_users_by_filter(filters)
    
    return {
        "success": True,
        "data": {"users": data or [], "count": len(data) if data else 0},
        "error": None
    }


@router.get("/company/{company_id}")
async def list_users(
    company_id: str,
    user_id: str = Header(..., alias="X-User-ID"),
    status: Optional[str] = Query(None),
    department_id: Optional[str] = Query(None)
):
    """List all users in a company."""
    users = await get_users_by_company(user_id, company_id)
    
    if status:
        users = [u for u in users if u.get("employment_status") == status]
    if department_id:
        users = [u for u in users if u.get("department_id") == department_id]
    
    return {
        "success": True,
        "data": {"users": users or [], "count": len(users) if users else 0},
        "error": None
    }


@router.get("/{target_user_id}")
async def get_user(
    target_user_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    """Get a specific user by ID."""
    data = await get_user_by_id(user_id, target_user_id)
    
    return {
        "success": True,
        "data": data,
        "error": None
    }




@router.post("/signup")
async def signup_endpoint(
    request: CreateUserRequest
):
    """Create a new user via signup endpoint (no auth required)."""
    user_data = request.dict()
    result = await create_user_signup(user_data)
    
    reactivated = result.get("reactivated", False)
    return {
        "success": True,
        "data": {
            "user": result["data"],
            "reactivated": reactivated
        },
        "error": None
    }


@router.post("/")
async def create_user_endpoint(
    request: CreateUserRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """Create a new user (requires authentication and authorization)."""
    user_data = request.dict()
    result = await create_user(user_id, user_data)
    
    reactivated = result.get("reactivated", False)
    return {
        "success": True,
        "data": {
            "user": result["data"],
            "reactivated": reactivated
        },
        "error": None
    }


@router.put("/{target_user_id}")
async def update_user_endpoint(
    target_user_id: str,
    request: UpdateUserRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """Update user details."""
    updates = {k: v for k, v in request.dict().items() if v is not None}
    if not updates:
        raise ValidationError("No fields to update")
    
    data = await update_user(user_id, target_user_id, updates)
    
    return {
        "success": True,
        "data": data,
        "error": None
    }


@router.delete("/{target_user_id}")
async def delete_user_endpoint(
    target_user_id: str,
    user_id: str = Header(..., alias="X-User-ID"),
    hard_delete: bool = Query(False)
):
    """Delete a user."""
    await delete_user(user_id, target_user_id)
    
    return {
        "success": True,
        "data": None,
        "error": None
    }


@router.post("/{target_user_id}/roles")
async def assign_role(
    target_user_id: str,
    request: AssignRoleRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    """Assign a role to a user."""
    data = await assign_user_role(user_id, target_user_id, request.dict())
    
    return {
        "success": True,
        "data": data,
        "error": None
    }


@router.get("/{target_user_id}/roles")
async def get_user_roles_endpoint(
    target_user_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    """Get all roles assigned to a user."""
    data = await get_user_roles(user_id, target_user_id)
    
    return {
        "success": True,
        "data": data,
        "error": None
    }


@router.get("/by-email/{email}")
async def get_user_by_email_route(
    email: str,
    user_id: Optional[str] = Header(None, alias="X-User-ID")
):
    """Get a user by email address."""
    requesting_user_id = user_id if user_id else None
    result = await get_user_by_email(requesting_user_id, email)
    
    # result is {"data": user, "error": ...} from the service layer
    user_data = result.get("data")
    
    return {
        "success": True,
        "user": user_data,
        "error": None
    }