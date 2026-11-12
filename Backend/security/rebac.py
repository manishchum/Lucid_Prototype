# Backend/security/rebac.py
"""
Zanzibar-Inspired ReBAC Permission Graph Engine & Pre-Retrieval ACL Resolver.

Models fine-grained relationships across:
  - Org Hierarchy: company -> department/function -> team/sub_function -> manager -> direct/indirect reports
  - Connectors: integration (org / team / personal) -> container (folder / channel / label) -> document -> spreadsheet_row
  - Cross-Team & Explicit Shares: team:A <-> document/container <-> team:B, with explicit deny_viewer overrides
  - Dual-Source Sync: 'org_hierarchy' + 'native_cloud' + 'lucid_manual' + 'ingestion_rule'

Materializes GIN-indexed `acl_principals` and `deny_principals` arrays onto
`coach_uploaded_documents`, `coach_document_chunks`, and `coach_spreadsheet_rows`
so pgvector similarity search and Text-to-SQL execute strict Pre-Retrieval ACL filtering
in a single database roundtrip.
"""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Set, Tuple

from utils.auth_bridge import get_service_supabase_client
from utils.redis_client import get_cache, set_cache, delete_cache_pattern, redis_client
from security.pii_firewall import allowed_tiers_for_role_level


ROLE_LEVEL_MAP = {
    "developer": 6, "DEVELOPER": 6,
    "super_admin": 4, "SUPER_ADMIN": 4, "SUPERADMIN": 4, "ceo": 4, "CEO": 4,
    "admin": 3, "ADMIN": 3, "company_admin": 3,
    "manager": 2, "Manager": 2, "MANAGER": 2,
    "user": 1, "USER": 1, "employee": 1, "EMPLOYEE": 1,
}


@dataclass
class UserSecurityContext:
    user_id: str
    company_id: str
    email: Optional[str] = None
    role_level: int = 1
    role_name: str = "USER"
    is_active: bool = True
    is_admin: bool = False
    is_manager_or_above: bool = False
    principals: List[str] = field(default_factory=list)
    principals_hash: str = ""
    team_ids: List[str] = field(default_factory=list)
    managed_employee_ids: List[str] = field(default_factory=list)
    allowed_tiers: List[str] = field(default_factory=lambda: ["public", "internal"])

    def can_query_employee(self, target_employee_id: Optional[str]) -> bool:
        if not self.is_active:
            return False
        if not target_employee_id:
            return True
        target_str = str(target_employee_id)
        if self.is_admin:
            return True
        if target_str == str(self.user_id):
            return True
        if self.role_level >= 2 and target_str in set(self.managed_employee_ids):
            return True
        return False

    def to_cache_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "company_id": self.company_id,
            "email": self.email,
            "role_level": self.role_level,
            "role_name": self.role_name,
            "is_active": self.is_active,
            "is_admin": self.is_admin,
            "is_manager_or_above": self.is_manager_or_above,
            "principals": self.principals,
            "principals_hash": self.principals_hash,
            "team_ids": self.team_ids,
            "managed_employee_ids": self.managed_employee_ids,
            "allowed_tiers": self.allowed_tiers,
        }

    @classmethod
    def from_cache_dict(cls, data: Dict[str, Any]) -> "UserSecurityContext":
        return cls(**data)


def _compute_principals_hash(principals: List[str], role_level: int) -> str:
    payload = f"{role_level}:" + ",".join(sorted(set(principals)))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def invalidate_user_security_cache(company_id: Optional[str], user_id: Optional[str]) -> None:
    if not user_id:
        return
    try:
        if company_id:
            redis_client.delete(f"acl:principals:{company_id}:{user_id}")
        else:
            delete_cache_pattern(f"acl:principals:*:{user_id}")
    except Exception as e:
        print(f"[REBAC] Cache invalidation warning for user {user_id}: {e}")


def invalidate_company_security_cache(company_id: str) -> None:
    if not company_id:
        return
    try:
        delete_cache_pattern(f"acl:principals:{company_id}:*")
    except Exception as e:
        print(f"[REBAC] Company cache invalidation warning for {company_id}: {e}")
    # Also clear in-memory Coach schema & document listing L1 caches for immediate UI/Chat reflection
    try:
        from coach.schema_inspector import _SCHEMA_CACHE
        prefix = f"{company_id}:"
        for k in [k for k in list(_SCHEMA_CACHE.keys()) if str(k).startswith(prefix)]:
            _SCHEMA_CACHE.pop(k, None)
    except Exception:
        pass
    try:
        from routes.coach_upload import _COACH_DOCS_L1_CACHE
        prefix = f"docs_list:{company_id}:"
        for k in [k for k in list(_COACH_DOCS_L1_CACHE.keys()) if str(k).startswith(prefix)]:
            _COACH_DOCS_L1_CACHE.pop(k, None)
    except Exception:
        pass


def is_missing_schema_error(exc: Exception) -> bool:
    """
    Detects PostgreSQL / PostgREST schema-mismatch errors (42703 undefined_column,
    42P01 undefined_table, 42883 undefined_function, PGRST202/204/205) so routes
    and pipelines can gracefully fall back when migrations are pending.
    """
    msg = str(exc).lower()
    return (
        "42703" in msg
        or "42p01" in msg
        or "42883" in msg
        or "pgrst202" in msg
        or "pgrst204" in msg
        or "pgrst205" in msg
        or "does not exist" in msg
        or "could not find the" in msg
    )


def _is_not_expired(expires_at: Optional[str]) -> bool:
    if not expires_at:
        return True
    try:
        exp_dt = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        return exp_dt > datetime.now(timezone.utc)
    except Exception:
        return True


def _resolve_reporting_subtree(manager_user_id: str, company_users: List[Dict[str, Any]]) -> List[str]:
    """BFS over active company users to find all direct & indirect reports of manager_user_id."""
    children_by_mgr: Dict[str, List[str]] = {}
    for u in company_users:
        if u.get("is_active") is False:
            continue
        uid = str(u.get("user_id") or "")
        mgr = str(u.get("manager_id") or "")
        if uid and mgr:
            children_by_mgr.setdefault(mgr, []).append(uid)

    visited: Set[str] = set()
    queue: List[str] = list(children_by_mgr.get(str(manager_user_id), []))
    while queue:
        curr = queue.pop(0)
        if curr in visited or curr == str(manager_user_id):
            continue
        visited.add(curr)
        for nxt in children_by_mgr.get(curr, []):
            if nxt not in visited:
                queue.append(nxt)

    return sorted(visited)


async def resolve_user_principals(
    user_id: str,
    company_id: str,
    force_refresh: bool = False
) -> UserSecurityContext:
    """
    Resolves a caller's full Zanzibar principal set, role level, team memberships,
    and reporting subtree for Pre-Retrieval ACL Filtering.
    Fail-closed on inactive/missing users.
    """
    uid = str(user_id)
    cid = str(company_id)
    cache_key = f"acl:principals:{cid}:{uid}"

    if not force_refresh:
        cached = get_cache(cache_key)
        if isinstance(cached, dict) and cached.get("user_id") == uid:
            return UserSecurityContext.from_cache_dict(cached)

    db = get_service_supabase_client()

    # 1. Fetch caller's user record
    u_resp = (
        db.table("users")
        .select("user_id, company_id, email, manager_id, function_id, sub_function_id, is_active")
        .eq("user_id", uid)
        .maybe_single()
        .execute()
    )
    user_row = getattr(u_resp, "data", None)
    if not user_row or user_row.get("is_active") is False:
        return UserSecurityContext(
            user_id=uid,
            company_id=cid,
            role_level=0,
            role_name="INACTIVE",
            is_active=False,
            principals=[],
            principals_hash="inactive",
            allowed_tiers=[],
        )

    # Tenant isolation check (unless developer)
    user_company_id = str(user_row.get("company_id") or "")

    # 2. Fetch active, non-expired role assignments
    role_resp = (
        db.table("user_role_assignments")
        .select("is_active, expires_at, scope_type, scope_id, role:roles(level, name)")
        .eq("user_id", uid)
        .execute()
    )
    assignments = [
        a for a in (getattr(role_resp, "data", None) or [])
        if a.get("is_active") is not False and _is_not_expired(a.get("expires_at"))
    ]

    max_level = 1
    top_role_name = "USER"
    scoped_team_ids: Set[str] = set()

    for a in assignments:
        r = a.get("role") or {}
        r_name = str(r.get("name") or "USER")
        lvl = r.get("level")
        try:
            lvl_int = int(lvl) if lvl is not None else ROLE_LEVEL_MAP.get(r_name, 1)
        except Exception:
            lvl_int = ROLE_LEVEL_MAP.get(r_name, 1)

        if lvl_int > max_level:
            max_level = lvl_int
            top_role_name = r_name

        s_type = str(a.get("scope_type") or "").upper()
        s_id = a.get("scope_id")
        if s_type in ("TEAM", "DEPARTMENT", "PROJECT") and s_id:
            scoped_team_ids.add(str(s_id))

    is_developer = max_level >= 6
    if not is_developer and user_company_id and user_company_id != cid:
        # Cross-tenant fail-closed
        return UserSecurityContext(
            user_id=uid,
            company_id=cid,
            email=user_row.get("email"),
            role_level=0,
            role_name="FORBIDDEN",
            is_active=False,
            principals=[],
            principals_hash="forbidden",
            allowed_tiers=[],
        )

    # 3. Collect org-derived team/function memberships
    if user_row.get("function_id"):
        scoped_team_ids.add(str(user_row["function_id"]))
    if user_row.get("sub_function_id"):
        scoped_team_ids.add(str(user_row["sub_function_id"]))

    # 4. Collect explicit ReBAC team/department memberships from rebac_tuples (safe if table not yet migrated)
    try:
        t_resp = (
            db.table("rebac_tuples")
            .select("object_type, object_id, relation, expires_at")
            .eq("company_id", cid)
            .eq("subject_type", "user")
            .eq("subject_id", uid)
            .in_("object_type", ["team", "department"])
            .in_("relation", ["member", "manager", "viewer"])
            .execute()
        )
        for tup in (getattr(t_resp, "data", None) or []):
            if _is_not_expired(tup.get("expires_at")) and tup.get("object_id"):
                scoped_team_ids.add(str(tup["object_id"]))
    except Exception:
        pass

    # 5. If Manager (level >= 2), resolve reporting subtree
    managed_ids: List[str] = []
    if max_level >= 2:
        try:
            comp_users_resp = (
                db.table("users")
                .select("user_id, manager_id, function_id, sub_function_id, is_active")
                .eq("company_id", cid)
                .execute()
            )
            comp_users = getattr(comp_users_resp, "data", None) or []
            managed_ids = _resolve_reporting_subtree(uid, comp_users)
        except Exception as e:
            print(f"[REBAC] Reporting subtree lookup warning: {e}")

    # 6. Build Principal Token List
    principals: Set[str] = {
        f"user:{uid}",
        f"scoped_emp:{uid}",
        f"company:{cid}",
    }
    for tid in scoped_team_ids:
        principals.add(f"team:{tid}")

    is_admin = max_level >= 3
    if is_admin:
        principals.add(f"role:{cid}:admin_plus")

    if max_level >= 2:
        principals.add(f"mgr_tree:{uid}")
        for emp_id in managed_ids:
            principals.add(f"scoped_emp:{emp_id}")

    sorted_principals = sorted(principals)
    p_hash = _compute_principals_hash(sorted_principals, max_level)

    ctx = UserSecurityContext(
        user_id=uid,
        company_id=cid,
        email=user_row.get("email"),
        role_level=max_level,
        role_name=top_role_name,
        is_active=True,
        is_admin=is_admin,
        is_manager_or_above=max_level >= 2,
        principals=sorted_principals,
        principals_hash=p_hash,
        team_ids=sorted(scoped_team_ids),
        managed_employee_ids=managed_ids,
        allowed_tiers=allowed_tiers_for_role_level(max_level),
    )

    set_cache(cache_key, ctx.to_cache_dict(), ttl=300)
    return ctx


# ============================================================================
# EXTERNAL IDENTITY RESOLUTION (Cloud Email / Slack ID -> Lucid user_id)
# ============================================================================
def resolve_external_principals_to_users(
    company_id: str,
    provider: str,
    emails: Optional[List[str]] = None,
    external_ids: Optional[List[str]] = None
) -> List[str]:
    """
    Resolves cloud collaborator emails / IDs strictly within `company_id`.
    External/unmatched accounts outside the company are ignored (fail-closed).
    """
    db = get_service_supabase_client()
    resolved_user_ids: Set[str] = set()

    clean_emails = sorted({e.strip().lower() for e in (emails or []) if e and "@" in e})
    clean_ext_ids = sorted({str(x).strip() for x in (external_ids or []) if x})

    if clean_emails:
        try:
            u_res = (
                db.table("users")
                .select("user_id, email, is_active")
                .eq("company_id", company_id)
                .execute()
            )
            email_to_uid = {
                str(r.get("email") or "").strip().lower(): str(r["user_id"])
                for r in (getattr(u_res, "data", None) or [])
                if r.get("is_active") is not False and r.get("email")
            }
            for em in clean_emails:
                if em in email_to_uid:
                    resolved_user_ids.add(email_to_uid[em])
        except Exception as e:
            print(f"[REBAC] Email resolution warning: {e}")

        try:
            alias_res = (
                db.table("user_external_identities")
                .select("user_id, external_email")
                .eq("company_id", company_id)
                .eq("provider", provider)
                .eq("verified", True)
                .execute()
            )
            for row in (getattr(alias_res, "data", None) or []):
                em = str(row.get("external_email") or "").strip().lower()
                if em in clean_emails and row.get("user_id"):
                    resolved_user_ids.add(str(row["user_id"]))
        except Exception:
            pass

    if clean_ext_ids:
        try:
            id_res = (
                db.table("user_external_identities")
                .select("user_id, external_user_id")
                .eq("company_id", company_id)
                .eq("provider", provider)
                .in_("external_user_id", clean_ext_ids)
                .execute()
            )
            for row in (getattr(id_res, "data", None) or []):
                if row.get("user_id"):
                    resolved_user_ids.add(str(row["user_id"]))
        except Exception:
            pass

    return sorted(resolved_user_ids)


# ============================================================================
# ZANZIBAR TUPLE MUTATIONS & MATERIALIZATION
# ============================================================================
def _subject_to_principal_token(subject_type: str, subject_id: str) -> Optional[str]:
    st = (subject_type or "").lower()
    sid = str(subject_id or "").strip()
    if not sid:
        return None
    if st == "user":
        return f"user:{sid}"
    if st in ("team", "department", "project", "function", "sub_function"):
        return f"team:{sid}"
    if st == "mgr_tree":
        return f"mgr_tree:{sid}"
    if st == "scoped_emp":
        return f"scoped_emp:{sid}"
    if st == "company":
        return f"company:{sid}"
    if st == "role":
        return sid if sid.startswith("role:") else f"role:{sid}"
    return None


def upsert_rebac_tuples(tuples: List[Dict[str, Any]]) -> None:
    if not tuples:
        return
    db = get_service_supabase_client()
    try:
        db.table("rebac_tuples").upsert(
            tuples,
            on_conflict="company_id,object_type,object_id,relation,subject_type,subject_id,subject_relation,grant_source"
        ).execute()
    except Exception as e:
        print(f"[REBAC] Upsert tuple warning: {e}")


def _compute_doc_acl_from_inputs(
    doc: Dict[str, Any],
    cid: str,
    integ_by_id: Dict[str, Dict[str, Any]],
    doc_tuples: List[Dict[str, Any]],
    container_tuples: List[Dict[str, Any]],
    integ_tuples: List[Dict[str, Any]],
) -> Tuple[List[str], List[str]]:
    """Pure in-memory Zanzibar ACL evaluator for a document and its parent container/integration inputs."""
    allow: Set[str] = {f"role:{cid}:admin_plus"}
    deny: Set[str] = set()

    author_id = doc.get("author_user_id") or doc.get("uploaded_by")
    if author_id:
        allow.add(f"user:{author_id}")

    target_emp_id = doc.get("target_employee_id")
    is_private_note = bool(doc.get("is_private_manager_note"))
    if target_emp_id and not is_private_note:
        # Allows the employee (self) AND their manager chain to read manager-authored feedback
        allow.add(f"scoped_emp:{target_emp_id}")

    integration_id = str(doc.get("source_integration_id") or "")
    integ = integ_by_id.get(integration_id) if integration_id else None
    if integ:
        owner_id = integ.get("owner_user_id")
        vis_mode = integ.get("visibility_mode") or "acl_sync"
        if owner_id:
            allow.add(f"user:{owner_id}")
            if integ.get("connection_scope") == "team":
                allow.add(f"mgr_tree:{owner_id}")
        if integ.get("assigned_team_id") and vis_mode in ("team_only", "acl_sync"):
            allow.add(f"team:{integ['assigned_team_id']}")
        if vis_mode == "company_wide":
            allow.add(f"company:{cid}")

    inherit_blocked = any(
        t.get("relation") == "restrict_inheritance" and _is_not_expired(t.get("expires_at"))
        for t in doc_tuples
    )
    all_tuples = list(doc_tuples)
    if not inherit_blocked:
        all_tuples.extend(container_tuples)
        all_tuples.extend(integ_tuples)

    for t in all_tuples:
        if not _is_not_expired(t.get("expires_at")):
            continue
        rel = str(t.get("relation") or "").lower()
        token = _subject_to_principal_token(t.get("subject_type"), t.get("subject_id"))
        if not token:
            continue
        if rel in ("deny_viewer", "deny"):
            deny.add(token)
        elif rel in ("owner", "editor", "viewer", "scoped_subject", "shared_with"):
            allow.add(token)

    return sorted(allow - deny), sorted(deny)


def _apply_spreadsheet_row_acls(
    db: Any,
    rows: List[Dict[str, Any]],
    doc_acl_map: Dict[str, Tuple[List[str], List[str]]],
) -> None:
    """Batch-updates coach_spreadsheet_rows preserving per-row target_employee_id isolation."""
    if not rows:
        return
    # Group row IDs by exact (acl_tuple, deny_tuple) to minimize HTTP update calls
    row_groups: Dict[Tuple[Tuple[str, ...], Tuple[str, ...]], List[str]] = {}
    for r in rows:
        doc_id = str(r.get("document_id") or "")
        if doc_id not in doc_acl_map:
            continue
        acl_list, deny_list = doc_acl_map[doc_id]
        emp = r.get("target_employee_id")
        if emp:
            non_scoped_allow = [
                p for p in acl_list
                if not p.startswith("scoped_emp:") and not p.startswith("team:") and not p.startswith("company:")
            ]
            row_acl = tuple(sorted(set(non_scoped_allow + [f"scoped_emp:{emp}"]) - set(deny_list)))
        else:
            row_acl = tuple(acl_list)
        key = (row_acl, tuple(deny_list))
        row_groups.setdefault(key, []).append(r["id"])

    for (row_acl, row_deny), r_ids in row_groups.items():
        acl_val = list(row_acl)
        deny_val = list(row_deny)
        for i in range(0, len(r_ids), 200):
            db.table("coach_spreadsheet_rows").update({
                "acl_principals": acl_val,
                "deny_principals": deny_val,
            }).in_("id", r_ids[i:i + 200]).execute()


def recompute_document_acl(document_id: str, company_id: Optional[str] = None) -> Tuple[List[str], List[str]]:
    """
    Walks the Zanzibar ReBAC graph for a document (direct grants + container inheritance +
    integration scope + scoped employee feedback + deny_viewer overrides), materializes
    `acl_principals` and `deny_principals`, and updates the document, its chunks,
    and its spreadsheet rows atomically without re-embedding.
    """
    db = get_service_supabase_client()

    try:
        doc_res = (
            db.table("coach_uploaded_documents")
            .select(
                "id, company_id, uploaded_by, author_user_id, target_employee_id, "
                "source_integration_id, source_container_id, is_private_manager_note"
            )
            .eq("id", document_id)
            .maybe_single()
            .execute()
        )
    except Exception as e:
        if not is_missing_schema_error(e):
            raise
        doc_res = (
            db.table("coach_uploaded_documents")
            .select("id, company_id, uploaded_by, target_employee_id")
            .eq("id", document_id)
            .maybe_single()
            .execute()
        )
    doc = getattr(doc_res, "data", None)
    if not doc:
        return [], []

    cid = str(company_id or doc["company_id"])

    integ_by_id: Dict[str, Dict[str, Any]] = {}
    integration_id = str(doc.get("source_integration_id") or "")
    if integration_id:
        try:
            int_res = (
                db.table("company_integrations")
                .select("id, owner_user_id, connection_scope, assigned_team_id, visibility_mode")
                .eq("id", integration_id)
                .maybe_single()
                .execute()
            )
            integ = getattr(int_res, "data", None)
            if integ:
                integ_by_id[integration_id] = integ
        except Exception:
            pass

    doc_tuples: List[Dict[str, Any]] = []
    container_tuples: List[Dict[str, Any]] = []
    integ_tuples: List[Dict[str, Any]] = []
    try:
        doc_tuples_res = (
            db.table("rebac_tuples")
            .select("*")
            .eq("company_id", cid)
            .eq("object_type", "document")
            .eq("object_id", str(document_id))
            .execute()
        )
        doc_tuples = getattr(doc_tuples_res, "data", None) or []

        inherit_blocked = any(
            t.get("relation") == "restrict_inheritance" and _is_not_expired(t.get("expires_at"))
            for t in doc_tuples
        )
        if not inherit_blocked:
            if doc.get("source_container_id"):
                c_res = (
                    db.table("rebac_tuples")
                    .select("*")
                    .eq("company_id", cid)
                    .eq("object_type", "container")
                    .eq("object_id", str(doc["source_container_id"]))
                    .execute()
                )
                container_tuples = getattr(c_res, "data", None) or []
            if integration_id:
                i_res = (
                    db.table("rebac_tuples")
                    .select("*")
                    .eq("company_id", cid)
                    .eq("object_type", "integration")
                    .eq("object_id", integration_id)
                    .execute()
                )
                integ_tuples = getattr(i_res, "data", None) or []
    except Exception as e:
        print(f"[REBAC] Tuple evaluation warning for doc {document_id}: {e}")

    acl_list, deny_list = _compute_doc_acl_from_inputs(
        doc=doc,
        cid=cid,
        integ_by_id=integ_by_id,
        doc_tuples=doc_tuples,
        container_tuples=container_tuples,
        integ_tuples=integ_tuples,
    )

    try:
        db.table("coach_uploaded_documents").update({
            "acl_principals": acl_list,
            "deny_principals": deny_list,
        }).eq("id", document_id).execute()

        db.table("coach_document_chunks").update({
            "acl_principals": acl_list,
            "deny_principals": deny_list,
        }).eq("document_id", document_id).execute()

        rows_res = (
            db.table("coach_spreadsheet_rows")
            .select("id, document_id, target_employee_id")
            .eq("document_id", document_id)
            .execute()
        )
        rows = getattr(rows_res, "data", None) or []
        _apply_spreadsheet_row_acls(db, rows, {str(document_id): (acl_list, deny_list)})
    except Exception as upd_err:
        print(f"[REBAC] Materialize update warning for doc {document_id}: {upd_err}")

    return acl_list, deny_list


def recompute_container_documents_acl(company_id: str, container_id: str) -> int:
    """
    Batch-recomputes materialized ACLs for all documents belonging to a monitored container.
    Executes O(1) batched Supabase queries instead of O(N * 9) sequential per-document roundtrips.
    """
    db = get_service_supabase_client()
    cid = str(company_id)
    cont_id = str(container_id)
    try:
        res = (
            db.table("coach_uploaded_documents")
            .select(
                "id, company_id, uploaded_by, author_user_id, target_employee_id, "
                "source_integration_id, source_container_id, is_private_manager_note"
            )
            .eq("company_id", cid)
            .eq("source_container_id", cont_id)
            .execute()
        )
    except Exception as e:
        if is_missing_schema_error(e):
            return 0
        raise

    docs = getattr(res, "data", None) or []
    if not docs:
        return 0

    doc_ids = [str(d["id"]) for d in docs]
    integ_ids = sorted({str(d["source_integration_id"]) for d in docs if d.get("source_integration_id")})

    # 1. Fetch container tuples once
    container_tuples: List[Dict[str, Any]] = []
    try:
        c_res = (
            db.table("rebac_tuples")
            .select("*")
            .eq("company_id", cid)
            .eq("object_type", "container")
            .eq("object_id", cont_id)
            .execute()
        )
        container_tuples = getattr(c_res, "data", None) or []
    except Exception as e:
        print(f"[REBAC] Batch container tuple fetch warning: {e}")

    # 2. Fetch unique parent integration metadata & tuples once
    integ_by_id: Dict[str, Dict[str, Any]] = {}
    integ_tuples_by_id: Dict[str, List[Dict[str, Any]]] = {}
    if integ_ids:
        try:
            int_res = (
                db.table("company_integrations")
                .select("id, owner_user_id, connection_scope, assigned_team_id, visibility_mode")
                .in_("id", integ_ids)
                .execute()
            )
            for row in (getattr(int_res, "data", None) or []):
                integ_by_id[str(row["id"])] = row
        except Exception:
            pass
        try:
            i_tup_res = (
                db.table("rebac_tuples")
                .select("*")
                .eq("company_id", cid)
                .eq("object_type", "integration")
                .in_("object_id", integ_ids)
                .execute()
            )
            for t in (getattr(i_tup_res, "data", None) or []):
                integ_tuples_by_id.setdefault(str(t.get("object_id") or ""), []).append(t)
        except Exception:
            pass

    # 3. Fetch document-level tuples in batched chunks of 200
    doc_tuples_by_id: Dict[str, List[Dict[str, Any]]] = {}
    for i in range(0, len(doc_ids), 200):
        try:
            dt_res = (
                db.table("rebac_tuples")
                .select("*")
                .eq("company_id", cid)
                .eq("object_type", "document")
                .in_("object_id", doc_ids[i:i + 200])
                .execute()
            )
            for t in (getattr(dt_res, "data", None) or []):
                doc_tuples_by_id.setdefault(str(t.get("object_id") or ""), []).append(t)
        except Exception as e:
            print(f"[REBAC] Batch doc tuple fetch warning: {e}")

    # 4. Evaluate ACLs in memory & group documents sharing the exact same materialized principals
    doc_acl_map: Dict[str, Tuple[List[str], List[str]]] = {}
    doc_groups: Dict[Tuple[Tuple[str, ...], Tuple[str, ...]], List[str]] = {}
    for doc in docs:
        did = str(doc["id"])
        iid = str(doc.get("source_integration_id") or "")
        acl_list, deny_list = _compute_doc_acl_from_inputs(
            doc=doc,
            cid=cid,
            integ_by_id=integ_by_id,
            doc_tuples=doc_tuples_by_id.get(did, []),
            container_tuples=container_tuples,
            integ_tuples=integ_tuples_by_id.get(iid, []),
        )
        doc_acl_map[did] = (acl_list, deny_list)
        key = (tuple(acl_list), tuple(deny_list))
        doc_groups.setdefault(key, []).append(did)

    # 5. Bulk update documents & chunks per distinct ACL signature
    try:
        for (acl_tup, deny_tup), group_ids in doc_groups.items():
            acl_val = list(acl_tup)
            deny_val = list(deny_tup)
            for i in range(0, len(group_ids), 200):
                batch_ids = group_ids[i:i + 200]
                db.table("coach_uploaded_documents").update({
                    "acl_principals": acl_val,
                    "deny_principals": deny_val,
                }).in_("id", batch_ids).execute()
                db.table("coach_document_chunks").update({
                    "acl_principals": acl_val,
                    "deny_principals": deny_val,
                }).in_("document_id", batch_ids).execute()

        # 6. Fetch & batch-update any spreadsheet rows across all container docs
        all_rows: List[Dict[str, Any]] = []
        for i in range(0, len(doc_ids), 200):
            rr = (
                db.table("coach_spreadsheet_rows")
                .select("id, document_id, target_employee_id")
                .in_("document_id", doc_ids[i:i + 200])
                .execute()
            )
            all_rows.extend(getattr(rr, "data", None) or [])
        _apply_spreadsheet_row_acls(db, all_rows, doc_acl_map)
    except Exception as upd_err:
        print(f"[REBAC] Batch materialize warning for container {cont_id}: {upd_err}")

    return len(docs)


def sync_native_cloud_acls(
    company_id: str,
    provider: str,
    document_id: str,
    acl_emails: Optional[List[str]] = None,
    acl_external_ids: Optional[List[str]] = None,
    owner_email: Optional[str] = None,
    is_restricted_inheritance: bool = False
) -> Tuple[List[str], List[str]]:
    """
    Replaces 'native_cloud' ReBAC tuples for a synced document based on live cloud ACLs
    (Google Drive permissions, OneDrive sharing, Slack channel members, Zoom/Gmail participants)
    and immediately materializes `acl_principals`.
    """
    db = get_service_supabase_client()

    # 1. Remove stale 'native_cloud' tuples for this document
    try:
        (
            db.table("rebac_tuples")
            .delete()
            .eq("company_id", company_id)
            .eq("object_type", "document")
            .eq("object_id", str(document_id))
            .eq("grant_source", "native_cloud")
            .execute()
        )
    except Exception as e:
        print(f"[REBAC] Delete stale native tuples warning: {e}")

    new_tuples: List[Dict[str, Any]] = []

    if is_restricted_inheritance:
        new_tuples.append({
            "company_id": company_id,
            "object_type": "document",
            "object_id": str(document_id),
            "relation": "restrict_inheritance",
            "subject_type": "document",
            "subject_id": str(document_id),
            "subject_relation": None,
            "grant_source": "native_cloud",
        })

    if owner_email:
        owner_uids = resolve_external_principals_to_users(company_id, provider, emails=[owner_email])
        for o_uid in owner_uids:
            new_tuples.append({
                "company_id": company_id,
                "object_type": "document",
                "object_id": str(document_id),
                "relation": "owner",
                "subject_type": "user",
                "subject_id": o_uid,
                "subject_relation": None,
                "grant_source": "native_cloud",
            })

    viewer_uids = resolve_external_principals_to_users(
        company_id=company_id,
        provider=provider,
        emails=acl_emails,
        external_ids=acl_external_ids,
    )
    for v_uid in viewer_uids:
        new_tuples.append({
            "company_id": company_id,
            "object_type": "document",
            "object_id": str(document_id),
            "relation": "viewer",
            "subject_type": "user",
            "subject_id": v_uid,
            "subject_relation": None,
            "grant_source": "native_cloud",
        })

    upsert_rebac_tuples(new_tuples)
    return recompute_document_acl(document_id, company_id=company_id)


def grant_share(
    company_id: str,
    object_type: str,   # 'document' | 'container'
    object_id: str,
    subject_type: str,  # 'user' | 'team' | 'department' | 'company'
    subject_id: str,
    relation: str = "viewer",  # 'viewer' | 'editor' | 'deny_viewer'
    actor_user_id: Optional[str] = None,
    expires_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Grants or denies access on a document or container (e.g. Team A sharing with Team B)."""
    tuple_row = {
        "company_id": company_id,
        "object_type": object_type,
        "object_id": str(object_id),
        "relation": relation,
        "subject_type": subject_type,
        "subject_id": str(subject_id),
        "subject_relation": "member" if subject_type in ("team", "department") else None,
        "grant_source": "lucid_manual",
        "expires_at": expires_at,
        "created_by": actor_user_id,
    }
    upsert_rebac_tuples([tuple_row])

    affected = 0
    if object_type == "document":
        recompute_document_acl(str(object_id), company_id=company_id)
        affected = 1
    elif object_type == "container":
        affected = recompute_container_documents_acl(company_id, str(object_id))

    invalidate_company_security_cache(company_id)
    return {"granted": True, "affected_documents": affected, "tuple": tuple_row}


def revoke_share(
    company_id: str,
    object_type: str,
    object_id: str,
    subject_type: str,
    subject_id: str,
    relation: Optional[str] = None,
) -> Dict[str, Any]:
    db = get_service_supabase_client()
    q = (
        db.table("rebac_tuples")
        .delete()
        .eq("company_id", company_id)
        .eq("object_type", object_type)
        .eq("object_id", str(object_id))
        .eq("subject_type", subject_type)
        .eq("subject_id", str(subject_id))
        .eq("grant_source", "lucid_manual")
    )
    if relation:
        q = q.eq("relation", relation)
    q.execute()

    affected = 0
    if object_type == "document":
        recompute_document_acl(str(object_id), company_id=company_id)
        affected = 1
    elif object_type == "container":
        affected = recompute_container_documents_acl(company_id, str(object_id))

    invalidate_company_security_cache(company_id)
    return {"revoked": True, "affected_documents": affected}


async def explain_access(
    company_id: str,
    actor_user_id: str,
    document_id: str
) -> Dict[str, Any]:
    """Explains exact Zanzibar allow/deny decision for auditing & debugging."""
    ctx = await resolve_user_principals(actor_user_id, company_id, force_refresh=True)
    db = get_service_supabase_client()
    try:
        doc_res = (
            db.table("coach_uploaded_documents")
            .select("id, file_name, company_id, acl_principals, deny_principals, sensitivity_tier, source_container_id, source_integration_id, target_employee_id")
            .eq("id", document_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
        )
    except Exception as e:
        if not is_missing_schema_error(e):
            raise
        doc_res = (
            db.table("coach_uploaded_documents")
            .select("id, file_name, company_id, uploaded_by, target_employee_id")
            .eq("id", document_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
        )
    doc = getattr(doc_res, "data", None)
    if not doc:
        return {"allowed": False, "reason": "Document not found in company."}

    doc_acl = set(doc.get("acl_principals") or [])
    doc_deny = set(doc.get("deny_principals") or [])
    user_p = set(ctx.principals)

    matched_denies = sorted(doc_deny & user_p)
    matched_allows = sorted(doc_acl & user_p)
    tier_ok = doc.get("sensitivity_tier", "internal") in set(ctx.allowed_tiers)

    allowed = (
        ctx.is_active
        and tier_ok
        and not matched_denies
        and (ctx.is_admin or bool(matched_allows))
    )

    return {
        "allowed": allowed,
        "user_id": actor_user_id,
        "role_name": ctx.role_name,
        "role_level": ctx.role_level,
        "document_id": document_id,
        "file_name": doc.get("file_name"),
        "document_sensitivity_tier": doc.get("sensitivity_tier"),
        "tier_permitted": tier_ok,
        "matched_allow_principals": matched_allows,
        "matched_deny_principals": matched_denies,
        "user_principals": ctx.principals,
        "document_acl_principals": sorted(doc_acl),
        "document_deny_principals": sorted(doc_deny),
    }

