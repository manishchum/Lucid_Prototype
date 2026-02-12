from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel, EmailStr
from typing import Optional, List

from utils.db_operations import (
    get_user_by_email,
    get_users_by_company,
    get_user_by_id,
    create_user,
    update_user,
    delete_user,
    assign_user_role,
    get_user_roles
)

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


@router.get("/company/{company_id}")
async def list_users(
    company_id: str,
    user_id: str = Header(..., alias="X-User-ID"),
    status: Optional[str] = Query(None),
    department_id: Optional[str] = Query(None)
):
    result = await get_users_by_company(user_id, company_id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    users = result["data"] or []
    if status:
        users = [u for u in users if u.get("employment_status") == status]
    if department_id:
        users = [u for u in users if u.get("department_id") == department_id]
    return {"users": users, "count": len(users)}


@router.get("/{target_user_id}")
async def get_user(
    target_user_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    result = await get_user_by_id(user_id, target_user_id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"user": result["data"]}


@router.post("/")
async def create_user_endpoint(
    request: CreateUserRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    user_data = request.dict()
    # NOTE: hash password before storing in production
    result = await create_user(user_id, user_data)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"user": result["data"], "message": "User created successfully"}


@router.put("/{target_user_id}")
async def update_user_endpoint(
    target_user_id: str,
    request: UpdateUserRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    updates = {k: v for k, v in request.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = await update_user(user_id, target_user_id, updates)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"user": result["data"], "message": "User updated successfully"}


@router.delete("/{target_user_id}")
async def delete_user_endpoint(
    target_user_id: str,
    user_id: str = Header(..., alias="X-User-ID"),
    hard_delete: bool = Query(False)
):
    result = await delete_user(user_id, target_user_id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"message": "User deleted successfully"}


@router.post("/{target_user_id}/roles")
async def assign_role(
    target_user_id: str,
    request: AssignRoleRequest,
    user_id: str = Header(..., alias="X-User-ID")
):
    result = await assign_user_role(user_id, target_user_id, request.dict())
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"message": "Role assigned successfully", "assignment": result["data"]}


@router.get("/{target_user_id}/roles")
async def get_user_roles_endpoint(
    target_user_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    result = await get_user_roles(user_id, target_user_id)
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    return {"roles": result["data"]}

@router.get("/by-email/{email}")
async def get_user_by_email_route(
    email: str,
    user_id: Optional[str] = Header(None, alias="X-User-ID")
):
    requesting_user_id = None if not user_id else user_id
    result = await get_user_by_email(requesting_user_id, email)
    if result["error"]:
        if "not found" in (result["error"] or "").lower():
            raise HTTPException(status_code=404, detail=result["error"])
        raise HTTPException(status_code=403, detail=result["error"])
    return {"user": result["data"]}