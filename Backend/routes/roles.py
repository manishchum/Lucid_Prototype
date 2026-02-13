from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional, List

from utils.db.roles_db import (
    get_all_roles,
    assign_user_role,
    get_user_roles,
    get_all_role_assignments,
    update_role_assignment,
    revoke_role_assignment
)

router = APIRouter(prefix="/api/roles", tags=["roles"])


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
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get all available roles.
    Permission: Any authenticated user (for dropdowns/UI).
    """
    result = await get_all_roles(user_id)
    
    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return {"roles": result["data"]}


@router.get("/assignments/company/{company_id}")
async def list_company_role_assignments(
    company_id: str,
    user_id: str = Header(..., alias="X-User-ID"),
    include_inactive: bool = Query(False)
):
    """
    Get all role assignments for a company.
    Permission: Manager+ in the company.
    """
    result = await get_all_role_assignments(user_id, company_id, include_inactive)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {"assignments": result["data"]}


@router.get("/users/{target_user_id}")
async def get_user_role_assignments(
    target_user_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Get all active role assignments for a specific user.
    Permission: Self OR manager+ in same company.
    """
    result = await get_user_roles(user_id, target_user_id)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {"assignments": result["data"]}


@router.post("/assignments")
async def create_role_assignment(
    request: AssignRoleRequest,
    user_id: str = Header(..., alias="X-User-ID")
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
    
    result = await assign_user_role(user_id, request.user_id, role_data)
    
    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return {
        "message": "Role assigned successfully",
        "assignment": result["data"]
    }


@router.put("/assignments/{assignment_id}")
async def update_assignment(
    assignment_id: str,
    request: UpdateRoleAssignmentRequest,
    user_id: str = Header(..., alias="X-User-ID")
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
    
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    result = await update_role_assignment(user_id, assignment_id, updates)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "message": "Role assignment updated successfully",
        "assignment": result["data"]
    }


@router.delete("/assignments/{assignment_id}")
async def revoke_assignment(
    assignment_id: str,
    user_id: str = Header(..., alias="X-User-ID")
):
    """
    Revoke a role assignment (soft delete, sets is_active=false).
    Permission: Company admin+ in the same company.
    """
    result = await revoke_role_assignment(user_id, assignment_id)
    
    if result["error"]:
        raise HTTPException(status_code=403, detail=result["error"])
    
    return {
        "message": "Role assignment revoked successfully",
        "assignment": result["data"]
    }
