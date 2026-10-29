from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from utils.auth import RequestAuth, get_request_auth_required
from utils.auth_bridge import get_service_supabase_client
from utils.db.permissions import check_user_permission

router = APIRouter(prefix="/api/audit-logs", tags=["audit-logs"])


@router.get("")
async def get_audit_logs(
    limit: int = Query(50, ge=1, le=200, description="Max logs to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    action: Optional[str] = Query(None, description="Filter by exact action name"),
    action_category: Optional[str] = Query(None, description="Filter by category e.g. IAM, TENANT, DISPATCH, SECURITY, EXPORT"),
    actor_id: Optional[str] = Query(None, description="Filter by actor UUID"),
    target_type: Optional[str] = Query(None, description="Filter by entity type e.g. user, role_assignment, company"),
    target_id: Optional[str] = Query(None, description="Filter by target entity ID"),
    date_from: Optional[str] = Query(None, description="Filter created_at >= date_from (ISO 8601)"),
    date_to: Optional[str] = Query(None, description="Filter created_at <= date_to (ISO 8601)"),
    company_id: Optional[str] = Query(None, description="Company filter (super admins only)"),
    auth_ctx: RequestAuth = Depends(get_request_auth_required),
):
    """
    Query enterprise audit trail logs with tenant isolation and multi-field filters.
    Compliant with SOC 2 (CC5.2, CC7.2) and GDPR (Article 30).
    """
    user_id = auth_ctx.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Permission check: must be manager+
    has_perm = await check_user_permission(user_id, "manager")
    if not has_perm:
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Minimum manager role required to view audit logs"
        )

    # Super admin and developer check
    is_super = await check_user_permission(user_id, "super_admin")
    is_dev = await check_user_permission(user_id, "developer")
    is_privileged = is_super or is_dev

    # Tenant boundary enforcement
    effective_company_id = auth_ctx.company_id

    if not is_privileged:
        if not effective_company_id:
            raise HTTPException(
                status_code=403,
                detail="User does not belong to any tenant company"
            )
        if company_id and str(company_id) != str(effective_company_id):
            raise HTTPException(
                status_code=403,
                detail="Access denied: Cannot query audit logs for other companies"
            )
        resolved_company_id = effective_company_id
    else:
        # Privileged admin can query across all or filter by requested company_id
        resolved_company_id = company_id or effective_company_id

    try:
        db = get_service_supabase_client()
        query = db.table("audit_logs").select("*", count="exact")

        if resolved_company_id:
            query = query.eq("company_id", resolved_company_id)

        if action:
            query = query.eq("action", action)

        if action_category:
            query = query.eq("action_category", action_category.upper())

        if actor_id:
            query = query.eq("actor_id", actor_id)

        if target_type:
            query = query.eq("target_type", target_type.lower())

        if target_id:
            query = query.eq("target_id", target_id)

        if date_from:
            query = query.gte("created_at", date_from)

        if date_to:
            query = query.lte("created_at", date_to)

        query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
        response = query.execute()

        logs = response.data or []
        total = response.count if response.count is not None else len(logs)

        return {
            "success": True,
            "data": {
                "logs": logs,
                "total": total,
                "limit": limit,
                "offset": offset,
            },
            "error": None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query audit logs: {str(e)}")
