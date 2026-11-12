# Backend/routes/rbac.py
"""
Enterprise RBAC / Zanzibar ReBAC Sharing & Governance API Router.

Provides:
- Team-to-Team & User container sharing (Team A <-> Team B explicit sharing + deny overrides)
- Document-level share grant / revoke / privacy toggle
- Permission inspection & Zanzibar `explain_access` diagnostics
- External cloud identity alias linking (`user_external_identities`)
- Teams/Departments picker metadata for Manager+ sharing UI
"""

from typing import Optional, Dict, Any, List
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from pydantic import BaseModel, Field

from utils.auth import RequestAuth, get_request_auth_required
from utils.db.permissions import check_user_permission
from utils.supabase_client import supabase_admin
from security.rebac import (
    resolve_user_principals,
    grant_share,
    revoke_share,
    explain_access,
    recompute_document_acl,
    invalidate_company_security_cache,
    invalidate_user_security_cache,
    is_missing_schema_error,
)

router = APIRouter(
    prefix="/api/rbac",
    tags=["RBAC & ReBAC Sharing Governance"],
)


class ShareGrantRequest(BaseModel):
    subject_type: str = Field(..., description="user | team | department | company")
    subject_id: str = Field(..., description="Target user_id, function_id, sub_function_id, or company_id")
    relation: str = Field("viewer", description="viewer | editor | deny_viewer")
    expires_at: Optional[str] = None


class ShareRevokeRequest(BaseModel):
    subject_type: str
    subject_id: str
    relation: Optional[str] = None


class ExplainAccessRequest(BaseModel):
    user_id: str
    document_id: str


class ExternalIdentityRequest(BaseModel):
    provider: str
    external_email: Optional[str] = None
    external_user_id: Optional[str] = None
    target_user_id: Optional[str] = None


def _audit_rbac_event(
    company_id: str,
    actor_id: str,
    actor_email: Optional[str],
    action: str,
    target_type: str,
    target_id: str,
    details: Optional[Dict[str, Any]] = None,
    status: str = "SUCCESS",
) -> None:
    try:
        supabase_admin.table("audit_logs").insert({
            "company_id": str(company_id),
            "actor_id": str(actor_id),
            "actor_email": actor_email,
            "action": action,
            "action_category": "REBAC_GOVERNANCE",
            "target_type": target_type,
            "target_id": str(target_id),
            "details": details or {},
            "status": status,
        }).execute()
    except Exception as e:
        print(f"[RBAC AUDIT] Note: {e}")


def _validate_share_payload(payload: ShareGrantRequest, company_id: str, is_admin: bool) -> None:
    st = (payload.subject_type or "").lower()
    rel = (payload.relation or "").lower()
    if st not in ("user", "team", "department", "company"):
        raise HTTPException(status_code=400, detail="subject_type must be 'user', 'team', 'department', or 'company'.")
    if rel not in ("viewer", "editor", "deny_viewer"):
        raise HTTPException(status_code=400, detail="relation must be 'viewer', 'editor', or 'deny_viewer'.")
    if st == "company" and not is_admin:
        raise HTTPException(status_code=403, detail="Only Company Administrators can grant company-wide access.")
    if st == "company" and str(payload.subject_id) != str(company_id):
        raise HTTPException(status_code=403, detail="Cross-company sharing is forbidden.")

    # Verify target user belongs to same company
    if st == "user":
        u_res = (
            supabase_admin.table("users")
            .select("user_id")
            .eq("user_id", str(payload.subject_id))
            .eq("company_id", str(company_id))
            .maybe_single()
            .execute()
        )
        if not getattr(u_res, "data", None):
            raise HTTPException(status_code=404, detail="Target user not found in your organization.")


async def _authorize_container_management(auth: RequestAuth, source_id: str) -> bool:
    is_admin = await check_user_permission(auth.user_id, "admin")
    if is_admin:
        return True
    is_mgr = await check_user_permission(auth.user_id, "manager")
    if not is_mgr:
        raise HTTPException(status_code=403, detail="Permission denied: Manager role or higher required.")

    src_res = (
        supabase_admin.table("integration_monitored_sources")
        .select("integration_id, company_id")
        .eq("company_id", str(auth.company_id))
        .eq("source_id", source_id)
        .execute()
    )
    rows = getattr(src_res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=404, detail="Monitored container not found.")

    int_ids = [r["integration_id"] for r in rows if r.get("integration_id")]
    if not int_ids:
        raise HTTPException(status_code=403, detail="Permission denied for container.")

    try:
        int_res = (
            supabase_admin.table("company_integrations")
            .select("id, owner_user_id, connected_by")
            .eq("company_id", str(auth.company_id))
            .in_("id", int_ids)
            .execute()
        )
    except Exception as col_err:
        if not is_missing_schema_error(col_err):
            raise
        int_res = (
            supabase_admin.table("company_integrations")
            .select("id, connected_by")
            .eq("company_id", str(auth.company_id))
            .in_("id", int_ids)
            .execute()
        )
    for integ in (getattr(int_res, "data", None) or []):
        owner = str(integ.get("owner_user_id") or integ.get("connected_by") or "")
        if owner == str(auth.user_id):
            return False

    raise HTTPException(
        status_code=403,
        detail="Permission denied: You can only share containers belonging to your own connectors.",
    )


async def _authorize_document_management(auth: RequestAuth, document_id: str) -> tuple[Dict[str, Any], bool]:
    is_admin = await check_user_permission(auth.user_id, "admin")
    try:
        doc_res = (
            supabase_admin.table("coach_uploaded_documents")
            .select("id, company_id, uploaded_by, author_user_id, source_integration_id, acl_principals, deny_principals, sensitivity_tier")
            .eq("id", document_id)
            .eq("company_id", str(auth.company_id))
            .maybe_single()
            .execute()
        )
    except Exception as col_err:
        if not is_missing_schema_error(col_err):
            raise
        doc_res = (
            supabase_admin.table("coach_uploaded_documents")
            .select("id, company_id, uploaded_by")
            .eq("id", document_id)
            .eq("company_id", str(auth.company_id))
            .maybe_single()
            .execute()
        )
    doc = getattr(doc_res, "data", None)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found in company.")

    if is_admin:
        return doc, True

    is_mgr = await check_user_permission(auth.user_id, "manager")
    if not is_mgr:
        raise HTTPException(status_code=403, detail="Permission denied: Manager role or higher required.")

    owner = str(doc.get("author_user_id") or doc.get("uploaded_by") or "")
    if owner == str(auth.user_id):
        return doc, False

    raise HTTPException(status_code=403, detail="Permission denied: Only document owners or administrators can modify document shares.")


@router.get("/teams")
async def list_share_targets(
    auth: RequestAuth = Depends(get_request_auth_required),
):
    """Lists departments/functions, teams/sub-functions, and active users for sharing pickers (Manager+)."""
    if not auth.company_id or not auth.user_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")
    is_mgr = await check_user_permission(auth.user_id, "manager")
    if not is_mgr:
        raise HTTPException(status_code=403, detail="Manager role or higher required.")

    cid = str(auth.company_id)
    teams: List[Dict[str, Any]] = []
    users_list: List[Dict[str, Any]] = []

    try:
        fn_res = (
            supabase_admin.table("functions")
            .select("function_id, function_name")
            .eq("company_id", cid)
            .execute()
        )
        for f in (getattr(fn_res, "data", None) or []):
            teams.append({
                "id": str(f["function_id"]),
                "name": f.get("function_name") or "Department",
                "subject_type": "department",
            })
    except Exception:
        pass

    try:
        sf_res = (
            supabase_admin.table("sub_functions")
            .select("sub_function_id, sub_function_name, function_id")
            .execute()
        )
        dept_ids = {t["id"] for t in teams}
        for sf in (getattr(sf_res, "data", None) or []):
            if str(sf.get("function_id") or "") in dept_ids or not dept_ids:
                teams.append({
                    "id": str(sf["sub_function_id"]),
                    "name": sf.get("sub_function_name") or "Team",
                    "subject_type": "team",
                })
    except Exception:
        pass

    try:
        u_res = (
            supabase_admin.table("users")
            .select("user_id, name, email")
            .eq("company_id", cid)
            .eq("is_active", True)
            .order("name")
            .limit(200)
            .execute()
        )
        users_list = getattr(u_res, "data", None) or []
    except Exception:
        pass

    return {"teams": teams, "users": users_list}


def _fetch_and_enrich_shares(company_id: str, object_type: str, object_id: str) -> List[Dict[str, Any]]:
    """
    Fetches explicit ReBAC tuples for a container or document and enriches them with
    human-readable target names, emails, and permission labels for quick identification & revocation.
    """
    cid = str(company_id)
    try:
        tup_res = (
            supabase_admin.table("rebac_tuples")
            .select("id, object_type, object_id, relation, subject_type, subject_id, grant_source, expires_at, created_at")
            .eq("company_id", cid)
            .eq("object_type", object_type)
            .eq("object_id", str(object_id))
            .execute()
        )
        tuples = getattr(tup_res, "data", None) or []
    except Exception as tbl_err:
        if is_missing_schema_error(tbl_err):
            return []
        print(f"[RBAC] Fetch shares warning for {object_type}:{object_id}: {tbl_err}")
        return []

    if not tuples:
        return []

    dept_ids = {str(t["subject_id"]) for t in tuples if t.get("subject_type") == "department" and t.get("subject_id")}
    team_ids = {str(t["subject_id"]) for t in tuples if t.get("subject_type") == "team" and t.get("subject_id")}
    user_ids = {str(t["subject_id"]) for t in tuples if t.get("subject_type") == "user" and t.get("subject_id")}

    dept_map: Dict[str, str] = {}
    team_map: Dict[str, str] = {}
    user_map: Dict[str, Dict[str, str]] = {}

    if dept_ids:
        try:
            f_res = (
                supabase_admin.table("functions")
                .select("function_id, function_name")
                .eq("company_id", cid)
                .in_("function_id", list(dept_ids))
                .execute()
            )
            for row in (getattr(f_res, "data", None) or []):
                dept_map[str(row["function_id"])] = row.get("function_name") or "Department"
        except Exception:
            pass

    if team_ids:
        try:
            sf_res = (
                supabase_admin.table("sub_functions")
                .select("sub_function_id, sub_function_name")
                .in_("sub_function_id", list(team_ids))
                .execute()
            )
            for row in (getattr(sf_res, "data", None) or []):
                team_map[str(row["sub_function_id"])] = row.get("sub_function_name") or "Team"
        except Exception:
            pass

    if user_ids:
        try:
            u_res = (
                supabase_admin.table("users")
                .select("user_id, name, email")
                .eq("company_id", cid)
                .in_("user_id", list(user_ids))
                .execute()
            )
            for row in (getattr(u_res, "data", None) or []):
                user_map[str(row["user_id"])] = {
                    "name": (row.get("name") or "").strip(),
                    "email": (row.get("email") or "").strip(),
                }
        except Exception:
            pass

    rel_labels = {
        "viewer": "Allow (Viewer)",
        "editor": "Editor",
        "deny_viewer": "Explicit Deny",
        "deny": "Explicit Deny",
        "owner": "Owner",
        "scoped_subject": "Scoped Employee",
        "shared_with": "Shared",
    }

    enriched: List[Dict[str, Any]] = []
    for t in tuples:
        st = str(t.get("subject_type") or "").lower()
        sid = str(t.get("subject_id") or "")
        rel = str(t.get("relation") or "").lower()
        grant_src = str(t.get("grant_source") or "lucid_manual")

        if st == "department":
            sname = dept_map.get(sid) or f"Department ({sid[:8]})"
            sdetail = "Department"
        elif st == "team":
            sname = team_map.get(sid) or f"Team ({sid[:8]})"
            sdetail = "Team"
        elif st == "user":
            uinfo = user_map.get(sid) or {}
            sname = uinfo.get("name") or uinfo.get("email") or f"User ({sid[:8]})"
            sdetail = uinfo.get("email") or "User"
        elif st == "company":
            sname = "Entire Organization"
            sdetail = "Company-Wide"
        else:
            sname = sid
            sdetail = st.title()

        enriched.append({
            "id": t.get("id") or f"{object_type}:{object_id}:{st}:{sid}:{rel}",
            "object_type": object_type,
            "object_id": str(object_id),
            "subject_type": st,
            "subject_id": sid,
            "subject_name": sname,
            "subject_detail": sdetail,
            "relation": rel,
            "relation_label": rel_labels.get(rel, rel.title()),
            "grant_source": grant_src,
            "revocable": grant_src == "lucid_manual",
            "expires_at": t.get("expires_at"),
            "created_at": t.get("created_at"),
        })

    enriched.sort(key=lambda x: (x["relation"] != "deny_viewer", x["subject_type"], x["subject_name"].lower()))
    return enriched


@router.get("/containers/{source_id}/permissions")
async def get_container_permissions(
    source_id: str,
    auth: RequestAuth = Depends(get_request_auth_required),
):
    """Returns explicit shared permissions and deny overrides configured on a monitored container."""
    if not auth.company_id or not auth.user_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")
    await _authorize_container_management(auth, source_id)
    perms = _fetch_and_enrich_shares(str(auth.company_id), "container", source_id)
    return {
        "source_id": source_id,
        "permissions": perms,
    }


@router.post("/containers/{source_id}/share")
async def share_container(
    source_id: str,
    payload: ShareGrantRequest,
    background_tasks: BackgroundTasks,
    auth: RequestAuth = Depends(get_request_auth_required),
):
    """Grants or denies cross-team / user permissions on a monitored connector container."""
    if not auth.company_id or not auth.user_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")
    is_admin = await _authorize_container_management(auth, source_id)
    _validate_share_payload(payload, auth.company_id, is_admin)

    result = grant_share(
        company_id=str(auth.company_id),
        object_type="container",
        object_id=source_id,
        subject_type=payload.subject_type.lower(),
        subject_id=payload.subject_id,
        relation=payload.relation.lower(),
        actor_user_id=str(auth.user_id),
        expires_at=payload.expires_at,
    )
    background_tasks.add_task(
        _audit_rbac_event,
        company_id=auth.company_id,
        actor_id=auth.user_id,
        actor_email=auth.email,
        action="REBAC_CONTAINER_SHARE_GRANTED",
        target_type="container",
        target_id=source_id,
        details=payload.model_dump(),
    )
    perms = _fetch_and_enrich_shares(str(auth.company_id), "container", source_id)
    return {"success": True, **result, "permissions": perms}


@router.delete("/containers/{source_id}/share")
async def unshare_container(
    source_id: str,
    background_tasks: BackgroundTasks,
    subject_type: str = Query(...),
    subject_id: str = Query(...),
    relation: Optional[str] = Query(None),
    auth: RequestAuth = Depends(get_request_auth_required),
):
    """Revokes an explicit manual share on a monitored container."""
    if not auth.company_id or not auth.user_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")
    await _authorize_container_management(auth, source_id)

    result = revoke_share(
        company_id=str(auth.company_id),
        object_type="container",
        object_id=source_id,
        subject_type=subject_type.lower(),
        subject_id=subject_id,
        relation=relation.lower() if relation else None,
    )
    background_tasks.add_task(
        _audit_rbac_event,
        company_id=auth.company_id,
        actor_id=auth.user_id,
        actor_email=auth.email,
        action="REBAC_CONTAINER_SHARE_REVOKED",
        target_type="container",
        target_id=source_id,
        details={"subject_type": subject_type, "subject_id": subject_id, "relation": relation},
    )
    perms = _fetch_and_enrich_shares(str(auth.company_id), "container", source_id)
    return {"success": True, **result, "permissions": perms}


@router.post("/documents/{document_id}/share")
async def share_document(
    document_id: str,
    payload: ShareGrantRequest,
    background_tasks: BackgroundTasks,
    auth: RequestAuth = Depends(get_request_auth_required),
):
    """Grants or denies access on an individual document (team, user, or deny_viewer)."""
    if not auth.company_id or not auth.user_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")
    _, is_admin = await _authorize_document_management(auth, document_id)
    _validate_share_payload(payload, auth.company_id, is_admin)

    result = grant_share(
        company_id=str(auth.company_id),
        object_type="document",
        object_id=document_id,
        subject_type=payload.subject_type.lower(),
        subject_id=payload.subject_id,
        relation=payload.relation.lower(),
        actor_user_id=str(auth.user_id),
        expires_at=payload.expires_at,
    )
    background_tasks.add_task(
        _audit_rbac_event,
        company_id=auth.company_id,
        actor_id=auth.user_id,
        actor_email=auth.email,
        action="REBAC_DOCUMENT_SHARE_GRANTED",
        target_type="document",
        target_id=document_id,
        details=payload.model_dump(),
    )
    perms = _fetch_and_enrich_shares(str(auth.company_id), "document", document_id)
    return {"success": True, **result, "permissions": perms}


@router.delete("/documents/{document_id}/share")
async def unshare_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    subject_type: str = Query(...),
    subject_id: str = Query(...),
    relation: Optional[str] = Query(None),
    auth: RequestAuth = Depends(get_request_auth_required),
):
    if not auth.company_id or not auth.user_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")
    await _authorize_document_management(auth, document_id)

    result = revoke_share(
        company_id=str(auth.company_id),
        object_type="document",
        object_id=document_id,
        subject_type=subject_type.lower(),
        subject_id=subject_id,
        relation=relation.lower() if relation else None,
    )
    background_tasks.add_task(
        _audit_rbac_event,
        company_id=auth.company_id,
        actor_id=auth.user_id,
        actor_email=auth.email,
        action="REBAC_DOCUMENT_SHARE_REVOKED",
        target_type="document",
        target_id=document_id,
        details={"subject_type": subject_type, "subject_id": subject_id, "relation": relation},
    )
    perms = _fetch_and_enrich_shares(str(auth.company_id), "document", document_id)
    return {"success": True, **result, "permissions": perms}


@router.get("/documents/{document_id}/permissions")
async def get_document_permissions(
    document_id: str,
    auth: RequestAuth = Depends(get_request_auth_required),
):
    """Returns effective materialized ACLs and explicit ReBAC tuples for a document."""
    if not auth.company_id or not auth.user_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")
    doc, _ = await _authorize_document_management(auth, document_id)

    try:
        tup_res = (
            supabase_admin.table("rebac_tuples")
            .select("*")
            .eq("company_id", str(auth.company_id))
            .eq("object_type", "document")
            .eq("object_id", str(document_id))
            .execute()
        )
        tuples = getattr(tup_res, "data", None) or []
    except Exception as tbl_err:
        if not is_missing_schema_error(tbl_err):
            raise
        tuples = []
    perms = _fetch_and_enrich_shares(str(auth.company_id), "document", document_id)
    return {
        "document_id": document_id,
        "sensitivity_tier": doc.get("sensitivity_tier", "internal"),
        "acl_principals": doc.get("acl_principals") or [],
        "deny_principals": doc.get("deny_principals") or [],
        "tuples": tuples,
        "permissions": perms,
    }


@router.post("/explain")
async def explain_document_access(
    payload: ExplainAccessRequest,
    auth: RequestAuth = Depends(get_request_auth_required),
):
    """Admin-only Zanzibar access explainer for auditing why a user can or cannot view a document."""
    if not auth.company_id or not auth.user_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")
    is_admin = await check_user_permission(auth.user_id, "admin")
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only Company Administrators can invoke access explain diagnostics.")

    return await explain_access(
        company_id=str(auth.company_id),
        actor_user_id=payload.user_id,
        document_id=payload.document_id,
    )


@router.post("/external-identities")
async def link_external_identity(
    payload: ExternalIdentityRequest,
    auth: RequestAuth = Depends(get_request_auth_required),
):
    """Links an external provider email or account ID (Slack/Teams/Drive) to a Lucid user."""
    if not auth.company_id or not auth.user_id:
        raise HTTPException(status_code=400, detail="Authenticated context required.")

    target_uid = payload.target_user_id or str(auth.user_id)
    if target_uid != str(auth.user_id):
        is_admin = await check_user_permission(auth.user_id, "admin")
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only Admins can link identities for other users.")

    row = {
        "user_id": target_uid,
        "company_id": str(auth.company_id),
        "provider": payload.provider.lower().strip(),
        "external_email": payload.external_email.strip().lower() if payload.external_email else None,
        "external_user_id": payload.external_user_id.strip() if payload.external_user_id else None,
        "verified": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    res = supabase_admin.table("user_external_identities").upsert(
        row,
        on_conflict="company_id,provider,user_id",
    ).execute()

    invalidate_user_security_cache(str(auth.company_id), target_uid)
    return {"success": True, "identity": (getattr(res, "data", None) or [row])[0]}

