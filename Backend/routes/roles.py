from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Optional, List
from utils.auth import RequestAuth, get_request_auth_required, get_effective_company_id

from utils.db.roles_db import (
    get_all_roles,
    assign_user_role,
    get_user_roles,
    get_all_role_assignments,
    update_role_assignment,
    revoke_role_assignment
)

from utils.redis_client import redis_client
from utils.exceptions import ValidationError

router = APIRouter(prefix="/api/roles", tags=["roles"])


def _normalize_target_user_id(target_user_id: str, auth_user_id: str) -> str:
    value = (target_user_id or '').strip()
    if not value or value in {'undefined', 'null', 'None'}:
        return auth_user_id
    return value


class AssignRoleRequest(BaseModel):
    user_id: str
    role_id: str
    scope_type: str  # 'COMPANY', 'DEPARTMENT', 'TEAM', 'PROJECT'
    scope_id: Optional[str] = None  # Auto-defaults to user's company if scope_type='COMPANY'
    expires_at: Optional[str] = None  # ISO 8601 timestamp
    notes: Optional[str] = None


class UpdateRoleAssignmentRequest(BaseModel):
    expires_at: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/")
async def list_all_roles(
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Get all available roles.
    Permission: Any authenticated user (for dropdowns/UI).
    """
    result = await get_all_roles(auth_ctx.user_id)
    
    # result is {"data": [...], "error": ...} from service layer
    # Handle both None and missing key
    roles = result.get("data") or []
    
    return {
        "success": True,
        "data": roles,
        "error": result.get("error")
    }


@router.get("/assignments/company/{company_id}")
async def list_company_role_assignments(
    company_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
    effective_company_id: str = Depends(get_effective_company_id),
    include_inactive: bool = Query(False)
):
    """
    Get all role assignments for a company.
    Permission: Manager+ in the company.
    """
    result = await get_all_role_assignments(auth_ctx.user_id, effective_company_id, include_inactive)
    
    # result is {"data": [...], "error": ...} from service layer
    # Handle both None and missing key
    assignments = result.get("data") or []
    
    return {
        "success": True,
        "data": assignments,
        "error": result.get("error")
    }


@router.get("/users/{target_user_id}")
async def get_user_role_assignments(
    target_user_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Get all active role assignments for a specific user.
    Permission: Self OR manager+ in same company.
    """
    normalized_target_user_id = _normalize_target_user_id(target_user_id, auth_ctx.user_id)
    result = await get_user_roles(auth_ctx.user_id, normalized_target_user_id)
    
    # result is {"data": [...], "error": ...} from service layer
    # Handle both None and missing key
    assignments = result.get("data") or []
    
    return {
        "success": True,
        "assignments": assignments,
        "error": result.get("error")
    }


@router.post("/assignments")
async def create_role_assignment(
    request: AssignRoleRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Assign a role to a user.
    Permission: Company admin+ in the same company.
    
    Scope types:
    - COMPANY: Company-wide role
    - DEPARTMENT: Department-specific role
    - TEAM: Team-specific role
    - PROJECT: Project-specific role
    """
    role_data = {
        "role_id": request.role_id,
        "scope_type": request.scope_type,
        "scope_id": request.scope_id,
        "expires_at": request.expires_at,
        "notes": request.notes
    }
    
    data = await assign_user_role(auth_ctx.user_id, request.user_id, role_data)
    
    # Immediately invalidate user's cached permission level across instances
    try:
        redis_client.delete(f"user_max_role_level:{request.user_id}")
    except Exception as e:
        print(f"[create_role_assignment] Redis invalidation warning: {e}")

    return {
        "success": True,
        "data": data,
        "error": None
    }


@router.put("/assignments/{assignment_id}")
async def update_assignment(
    assignment_id: str,
    request: UpdateRoleAssignmentRequest,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Update a role assignment (expires_at, notes, is_active).
    Permission: Company admin+ in the same company.
    """
    updates = {}
    if request.expires_at is not None:
        updates["expires_at"] = request.expires_at
    if request.notes is not None:
        updates["notes"] = request.notes
    if request.is_active is not None:
        updates["is_active"] = request.is_active
    
    data = await update_role_assignment(auth_ctx.user_id, assignment_id, updates)
    
    # Immediately invalidate user's cached permission level across instances
    try:
        target_uid = None
        resp_data = data.get("data") if data else None
        if isinstance(resp_data, list) and len(resp_data) > 0 and isinstance(resp_data[0], dict):
            target_uid = resp_data[0].get("user_id")
        elif isinstance(resp_data, dict):
            target_uid = resp_data.get("user_id")
        if target_uid:
            redis_client.delete(f"user_max_role_level:{target_uid}")
    except Exception as e:
        print(f"[update_assignment] Redis invalidation warning: {e}")

    return {
        "success": True,
        "data": data,
        "error": None
    }


@router.delete("/assignments/{assignment_id}")
async def revoke_assignment(
    assignment_id: str,
    auth_ctx: RequestAuth = Depends(get_request_auth_required)
):
    """
    Revoke a role assignment (soft delete, sets is_active=false).
    Permission: Company admin+ in the same company.
    """
    data = await revoke_role_assignment(auth_ctx.user_id, assignment_id)
    
    # Immediately invalidate user's cached permission level across instances
    try:
        target_uid = None
        resp_data = data.get("data") if data else None
        if isinstance(resp_data, list) and len(resp_data) > 0 and isinstance(resp_data[0], dict):
            target_uid = resp_data[0].get("user_id")
        elif isinstance(resp_data, dict):
            target_uid = resp_data.get("user_id")
        if target_uid:
            redis_client.delete(f"user_max_role_level:{target_uid}")
    except Exception as e:
        print(f"[revoke_assignment] Redis invalidation warning: {e}")

    return {
        "success": True,
        "data": data,
        "error": None
    }