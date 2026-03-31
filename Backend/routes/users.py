from fastapi import APIRouter, Depends, HTTPException, Header, Query
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
    get_users_by_filter,
    DEFAULT_PASSWORD,
)

from utils.db.roles_db import (
    assign_user_role,
    get_user_roles
)
from utils.auth import (
    RequestAuth,
    get_request_auth_optional,
    get_request_auth_required,
)
from utils.firebase_provisioning import ensure_firebase_user
from utils.supabase_client import supabase

router = APIRouter(prefix="/api/users", tags=["users"])


def _extract_created_user_row(created_payload):
    if isinstance(created_payload, list):
        return created_payload[0] if created_payload else None
    if isinstance(created_payload, dict):
        return created_payload
    return None


def _ensure_firebase_and_persist_uid(created_payload, request_password: Optional[str]):
    created_user = _extract_created_user_row(created_payload)
    if not created_user:
        raise HTTPException(status_code=500, detail="User row not returned from create flow")

    email = (created_user.get("email") or "").strip().lower()
    name = created_user.get("name")
    user_id = created_user.get("user_id")

    if not email or not user_id:
        raise HTTPException(status_code=500, detail="Created user row missing email or user_id")

    plain_password = request_password or DEFAULT_PASSWORD
    firebase_uid = ensure_firebase_user(email, name, plain_password)

    try:
        update_res = (
            supabase
            .table("users")
            .update({"firebase_uid": firebase_uid})
            .eq("user_id", user_id)
            .execute()
        )
        updated_data = getattr(update_res, "data", None)
        if isinstance(updated_data, list) and updated_data:
            return updated_data
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to persist firebase_uid on user") from exc

    # If update response does not return row data, preserve previous payload and enrich it for response consistency.
    created_user["firebase_uid"] = firebase_uid
    return [created_user]


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
    auth_ctx: RequestAuth = Depends(get_request_auth_optional),
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
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    status: Optional[str] = Query(None),
    department_id: Optional[str] = Query(None)
):
    result = await get_users_by_company(auth_ctx.user_id, company_id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    users = result["data"] or []
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
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await get_user_by_id(auth_ctx.user_id, target_user_id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"user": result["data"]}




@router.post("/signup")
async def signup_endpoint(
    request: CreateUserRequest
):
    """Create a new user via signup endpoint (no auth required)."""
    user_data = request.dict()
    # NOTE: hash password before storing in production
    result = await create_user_signup(user_data)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    result["data"] = _ensure_firebase_and_persist_uid(result.get("data"), request.password)
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
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Create a new user (requires authentication and authorization)."""
    user_data = request.dict()
    # NOTE: hash password before storing in production
    result = await create_user(auth_ctx.user_id, user_data)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    result["data"] = _ensure_firebase_and_persist_uid(result.get("data"), request.password)
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
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """Update user details."""
    updates = {k: v for k, v in request.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = await update_user(auth_ctx.user_id, target_user_id, updates)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"user": result["data"], "message": "User updated successfully"}


@router.delete("/{target_user_id}")
async def delete_user_endpoint(
    target_user_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    hard_delete: bool = Query(False)
):
    result = await delete_user(auth_ctx.user_id, target_user_id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"message": "User deleted successfully"}


@router.post("/{target_user_id}/roles")
async def assign_role(
    target_user_id: str,
    request: AssignRoleRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await assign_user_role(auth_ctx.user_id, target_user_id, request.dict())
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"message": "Role assigned successfully", "assignment": result["data"]}


@router.get("/{target_user_id}/roles")
async def get_user_roles_endpoint(
    target_user_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    result = await get_user_roles(auth_ctx.user_id, target_user_id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"roles": result["data"]}

@router.get("/by-email/{email}")
async def get_user_by_email_route(
    email: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_optional),
):
    requesting_user_id = auth_ctx.user_id
    result = await get_user_by_email(requesting_user_id, email)
    
    # result is {"data": user, "error": ...} from the service layer
    user_data = result.get("data")
    
    return {
        "success": True,
        "user": user_data,
        "error": None
    }



@router.get("/by-phone/{phone}")
async def get_user_by_phone_route(
    phone: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_optional),
):
    requesting_user_id = auth_ctx.user_id
    result = await get_user_by_phone_route(requesting_user_id, phone)
    
    # result is {"data": user, "error": ...} from the service layer
    user_data = result.get("data")
    
    return {
        "success": True,
        "user": user_data,
        "error": None
    }