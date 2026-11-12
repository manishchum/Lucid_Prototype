# Backend/coach/schema_inspector.py
"""
Dynamic Schema & Document Introspection Engine for the Performance Coach Agent.
Extracts available spreadsheet sheets, column catalogs, sample rows, and document
inventories per company to ground the Text-to-SQL and Vector RAG engines.
"""

import time
from datetime import datetime
from typing import Dict, Any, List, Optional, Set
from utils.supabase_client import supabase_admin
from security.pii_firewall import filter_columns_for_role, mask_spreadsheet_rows_for_role, allowed_tiers_for_role_level
from security.rebac import is_missing_schema_error

# In-memory schema cache: { "company_id:principals_hash": {"expires_at": float, "data": dict} }
_SCHEMA_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 180  # 3 minutes TTL


def _parse_sec_ctx(security_ctx: Any) -> Dict[str, Any]:
    """Normalizes UserSecurityContext dataclass or serialized dict into standard security fields."""
    if security_ctx is None:
        return {
            "user_id": "",
            "email": None,
            "role_level": 1,
            "is_admin": False,
            "is_active": True,
            "principals": [],
            "principals_hash": "anon",
            "team_ids": [],
            "managed_employee_ids": [],
            "allowed_tiers": ["public", "internal"],
            "has_context": False,
        }
    if isinstance(security_ctx, dict):
        rl = int(security_ctx.get("role_level", 1))
        return {
            "user_id": str(security_ctx.get("user_id") or ""),
            "email": security_ctx.get("email"),
            "role_level": rl,
            "is_admin": bool(security_ctx.get("is_admin", rl >= 3)),
            "is_active": bool(security_ctx.get("is_active", True)),
            "principals": list(security_ctx.get("principals") or []),
            "principals_hash": str(security_ctx.get("principals_hash") or "ctx"),
            "team_ids": list(security_ctx.get("team_ids") or []),
            "managed_employee_ids": list(security_ctx.get("managed_employee_ids") or []),
            "allowed_tiers": list(security_ctx.get("allowed_tiers") or allowed_tiers_for_role_level(rl)),
            "has_context": True,
        }
    rl = int(getattr(security_ctx, "role_level", 1))
    return {
        "user_id": str(getattr(security_ctx, "user_id", "")),
        "email": getattr(security_ctx, "email", None),
        "role_level": rl,
        "is_admin": bool(getattr(security_ctx, "is_admin", rl >= 3)),
        "is_active": bool(getattr(security_ctx, "is_active", True)),
        "principals": list(getattr(security_ctx, "principals", [])),
        "principals_hash": str(getattr(security_ctx, "principals_hash", "ctx")),
        "team_ids": list(getattr(security_ctx, "team_ids", [])),
        "managed_employee_ids": list(getattr(security_ctx, "managed_employee_ids", [])),
        "allowed_tiers": list(getattr(security_ctx, "allowed_tiers", allowed_tiers_for_role_level(rl))),
        "has_context": True,
    }


def _record_is_authorized(rec: Dict[str, Any], sec: Dict[str, Any]) -> bool:
    if not sec.get("has_context"):
        return True
    if not sec.get("is_active"):
        return False

    tier = rec.get("sensitivity_tier") or "internal"
    if tier not in set(sec["allowed_tiers"]):
        return False

    user_p = set(sec["principals"])
    deny_p = set(rec.get("deny_principals") or [])
    if deny_p & user_p:
        return False

    if sec["is_admin"]:
        return True

    acl_p = set(rec.get("acl_principals") or [])
    if acl_p & user_p:
        return True

    author_id = str(rec.get("author_user_id") or rec.get("uploaded_by") or "")
    if author_id and author_id == sec["user_id"]:
        return True

    target_emp = str(rec.get("target_employee_id") or "")
    if target_emp and not bool(rec.get("is_private_manager_note")):
        if target_emp == sec["user_id"] or target_emp in set(sec["managed_employee_ids"]):
            return True

    return False


def get_company_spreadsheet_schema(
    company_id: str,
    force_refresh: bool = False,
    security_ctx: Any = None,
) -> Dict[str, Any]:
    """
    Introspects all completed spreadsheet documents and rows accessible to the caller's security context.
    Returns a structured dictionary of sheet names, non-PII-filtered columns, data types, and masked sample rows.
    """
    sec = _parse_sec_ctx(security_ctx)
    if sec["has_context"] and not sec["is_active"]:
        return {"has_spreadsheet_data": False, "sheets_count": 0, "sheets": {}, "all_sheet_names": [], "all_columns": []}

    cache_key = f"{company_id}:{sec['principals_hash']}"
    now = time.time()
    if not force_refresh and cache_key in _SCHEMA_CACHE:
        cache_entry = _SCHEMA_CACHE[cache_key]
        if cache_entry["expires_at"] > now:
            return cache_entry["data"]

    try:
        # 1. Fetch completed spreadsheet documents with ACL columns (with legacy schema fallback)
        try:
            docs_res = (
                supabase_admin.table("coach_uploaded_documents")
                .select(
                    "id, file_name, file_type, document_period, description, parsed_metadata, "
                    "target_employee_id, uploaded_by, author_user_id, is_private_manager_note, "
                    "acl_principals, deny_principals, sensitivity_tier"
                )
                .eq("company_id", company_id)
                .in_("status", ["completed", "embedding", "COMPLETED"])
                .in_("file_type", ["xlsx", "xls", "csv"])
                .execute()
            )
        except Exception as e:
            if not is_missing_schema_error(e):
                raise
            docs_res = (
                supabase_admin.table("coach_uploaded_documents")
                .select(
                    "id, file_name, file_type, document_period, description, parsed_metadata, "
                    "target_employee_id, uploaded_by"
                )
                .eq("company_id", company_id)
                .in_("status", ["completed", "embedding", "COMPLETED"])
                .in_("file_type", ["xlsx", "xls", "csv"])
                .execute()
            )
        all_spreadsheet_docs = getattr(docs_res, "data", None) or []
        spreadsheet_docs = [d for d in all_spreadsheet_docs if _record_is_authorized(d, sec)]
        authorized_doc_ids = [str(d["id"]) for d in spreadsheet_docs]

        if sec["has_context"] and not sec["is_admin"] and not authorized_doc_ids:
            empty_result = {
                "has_spreadsheet_data": False,
                "sheets_count": 0,
                "sheets": {},
                "all_sheet_names": [],
                "all_columns": [],
            }
            _SCHEMA_CACHE[cache_key] = {"expires_at": now + CACHE_TTL_SECONDS, "data": empty_result}
            return empty_result

        sheets_meta: Dict[str, Any] = {}
        all_columns: set = set()
        role_level = sec["role_level"] if sec["has_context"] else 3

        for doc in spreadsheet_docs:
            doc_id = doc["id"]
            file_name = doc["file_name"]
            period = doc.get("document_period")
            metadata = doc.get("parsed_metadata") or {}
            columns_by_sheet = metadata.get("columns_by_sheet") or {}

            # If columns_by_sheet is empty, fallback to columns_detected
            if not columns_by_sheet:
                cols = metadata.get("columns_detected") or []
                sheet_names = metadata.get("sheet_names") or ["CSV_Data"]
                for s in sheet_names:
                    columns_by_sheet[s] = cols

            for sheet_name, cols in columns_by_sheet.items():
                visible_cols = filter_columns_for_role(list(cols), role_level)
                if sheet_name not in sheets_meta:
                    sheets_meta[sheet_name] = {
                        "sheet_name": sheet_name,
                        "file_name": file_name,
                        "document_id": doc_id,
                        "document_period": period,
                        "columns": list(visible_cols),
                        "sample_rows": []
                    }
                    all_columns.update(visible_cols)

        # Discover additional sheets strictly from authorized documents (or all if admin)
        extra_q = (
            supabase_admin.table("coach_spreadsheet_rows")
            .select("sheet_name, document_id")
            .eq("company_id", company_id)
        )
        if not sec["is_admin"] and authorized_doc_ids:
            extra_q = extra_q.in_("document_id", authorized_doc_ids)
        extra_sheets_res = extra_q.limit(100).execute()
        for r_s in (getattr(extra_sheets_res, "data", None) or []):
            sn = r_s.get("sheet_name")
            if sn and sn not in sheets_meta:
                sheets_meta[sn] = {
                    "sheet_name": sn,
                    "file_name": "Spreadsheet Record",
                    "columns": [],
                    "sample_rows": []
                }

        # 2. Fetch authorized sample rows for each sheet, filter columns & mask PII
        if sheets_meta:
            for sheet_name, sheet_info in sheets_meta.items():
                try:
                    rq = (
                        supabase_admin.table("coach_spreadsheet_rows")
                        .select("employee_name, row_data, target_employee_id, acl_principals, deny_principals, sensitivity_tier")
                        .eq("company_id", company_id)
                        .eq("sheet_name", sheet_name)
                    )
                    if not sec["is_admin"] and authorized_doc_ids:
                        rq = rq.in_("document_id", authorized_doc_ids)
                    rows_res = rq.limit(10).execute()
                except Exception as row_err:
                    if not is_missing_schema_error(row_err):
                        raise
                    rq = (
                        supabase_admin.table("coach_spreadsheet_rows")
                        .select("employee_name, row_data, target_employee_id")
                        .eq("company_id", company_id)
                        .eq("sheet_name", sheet_name)
                    )
                    if not sec["is_admin"] and authorized_doc_ids:
                        rq = rq.in_("document_id", authorized_doc_ids)
                    rows_res = rq.limit(10).execute()
                raw_sample_rows = [
                    r for r in (getattr(rows_res, "data", None) or [])
                    if _record_is_authorized(r, sec)
                ][:2]

                raw_dicts: List[Dict[str, Any]] = []
                for r in raw_sample_rows:
                    row_dict = dict(r.get("row_data") or {})
                    if r.get("employee_name") and "employee_name" not in row_dict:
                        row_dict["employee_name"] = r["employee_name"]
                    if r.get("target_employee_id") and "target_employee_id" not in row_dict:
                        row_dict["target_employee_id"] = r["target_employee_id"]
                    raw_dicts.append(row_dict)

                if sec["has_context"]:
                    masked_dicts = mask_spreadsheet_rows_for_role(
                        raw_dicts,
                        caller_user_id=sec["user_id"],
                        role_level=sec["role_level"],
                    )
                else:
                    masked_dicts = raw_dicts

                for row_dict in masked_dicts:
                    sheet_info["sample_rows"].append(row_dict)
                    for k in filter_columns_for_role(list(row_dict.keys()), role_level):
                        if k not in sheet_info["columns"]:
                            sheet_info["columns"].append(k)
                            all_columns.add(k)

        result = {
            "has_spreadsheet_data": len(sheets_meta) > 0,
            "sheets_count": len(sheets_meta),
            "sheets": sheets_meta,
            "all_sheet_names": list(sheets_meta.keys()),
            "all_columns": sorted(list(all_columns))
        }

        # Cache result scoped by company_id + principals_hash
        _SCHEMA_CACHE[cache_key] = {
            "expires_at": now + CACHE_TTL_SECONDS,
            "data": result
        }
        return result

    except Exception as e:
        print(f"[COACH SCHEMA INSPECTOR] Error introspecting spreadsheet schema: {e}")
        return {
            "has_spreadsheet_data": False,
            "sheets_count": 0,
            "sheets": {},
            "all_sheet_names": [],
            "all_columns": []
        }


def get_company_document_catalog(
    company_id: str,
    security_ctx: Any = None,
) -> List[Dict[str, Any]]:
    """
    Returns an inventory of active coach documents authorized for the caller's security context.
    """
    sec = _parse_sec_ctx(security_ctx)
    if sec["has_context"] and not sec["is_active"]:
        return []

    try:
        try:
            res = (
                supabase_admin.table("coach_uploaded_documents")
                .select(
                    "id, file_name, file_type, document_period, description, target_employee_id, "
                    "uploaded_by, author_user_id, is_private_manager_note, acl_principals, deny_principals, "
                    "sensitivity_tier, parsed_metadata"
                )
                .eq("company_id", company_id)
                .in_("status", ["completed", "embedding", "COMPLETED"])
                .order("created_at", desc=True)
                .execute()
            )
        except Exception as col_err:
            if not is_missing_schema_error(col_err):
                raise
            res = (
                supabase_admin.table("coach_uploaded_documents")
                .select(
                    "id, file_name, file_type, document_period, description, target_employee_id, "
                    "uploaded_by, parsed_metadata"
                )
                .eq("company_id", company_id)
                .in_("status", ["completed", "embedding", "COMPLETED"])
                .order("created_at", desc=True)
                .execute()
            )
        raw_docs = getattr(res, "data", None) or []
        catalog = []
        for d in raw_docs:
            if not _record_is_authorized(d, sec):
                continue
            meta = d.get("parsed_metadata") or {}
            catalog.append({
                "document_id": d["id"],
                "file_name": d["file_name"],
                "file_type": d["file_type"],
                "document_period": d.get("document_period"),
                "category": meta.get("category", "General Performance Record"),
                "key_topics": meta.get("key_topics", []),
                "summary": d.get("description") or "",
                "target_employee_id": d.get("target_employee_id"),
                "sensitivity_tier": d.get("sensitivity_tier", "internal"),
            })
        return catalog
    except Exception as e:
        print(f"[COACH SCHEMA INSPECTOR] Error fetching document catalog: {e}")
        return []


def get_company_active_integrations(
    company_id: str,
    security_ctx: Any = None,
) -> List[Dict[str, Any]]:
    """
    Returns active cloud integrations visible to the caller's security context.
    """
    sec = _parse_sec_ctx(security_ctx)
    if sec["has_context"] and not sec["is_active"]:
        return []

    try:
        try:
            res = (
                supabase_admin.table("company_integrations")
                .select("id, provider, account_identifier, status, config, last_synced_at, owner_user_id, connection_scope, assigned_team_id, visibility_mode")
                .eq("company_id", company_id)
                .eq("status", "active")
                .execute()
            )
        except Exception as col_err:
            if not is_missing_schema_error(col_err):
                raise
            res = (
                supabase_admin.table("company_integrations")
                .select("id, provider, account_identifier, status, config, last_synced_at, connected_by")
                .eq("company_id", company_id)
                .eq("status", "active")
                .execute()
            )
        all_integrations = getattr(res, "data", None) or []
        integrations = []
        team_set = set(sec["team_ids"])
        for it in all_integrations:
            owner_id = str(it.get("owner_user_id") or it.get("connected_by") or "")
            if not sec["has_context"] or sec["is_admin"]:
                integrations.append(it)
            elif owner_id == sec["user_id"]:
                integrations.append(it)
            elif (it.get("connection_scope") or "org") == "org" or it.get("visibility_mode") == "company_wide":
                integrations.append(it)
            elif it.get("assigned_team_id") and str(it["assigned_team_id"]) in team_set:
                integrations.append(it)

        if not integrations:
            return []

        integration_ids = [it["id"] for it in integrations]
        sources_res = (
            supabase_admin.table("integration_monitored_sources")
            .select("integration_id, source_id, source_name, source_type")
            .in_("integration_id", integration_ids)
            .execute()
        )
        sources = getattr(sources_res, "data", None) or []
        sources_by_integration: Dict[str, List[Dict[str, Any]]] = {}
        for s in sources:
            iid = s.get("integration_id")
            if iid not in sources_by_integration:
                sources_by_integration[iid] = []
            sources_by_integration[iid].append(s)

        summary_list = []
        for it in integrations:
            monitored = sources_by_integration.get(it["id"], [])
            config = it.get("config") or {}
            source_names = [m.get("source_name") for m in monitored if m.get("source_name")]
            if not source_names and config.get("folder_name"):
                source_names = [config.get("folder_name")]

            summary_list.append({
                "provider": it.get("provider", ""),
                "account_identifier": it.get("account_identifier", ""),
                "monitored_sources": source_names,
                "last_synced_at": it.get("last_synced_at")
            })
        return summary_list
    except Exception as e:
        print(f"[COACH SCHEMA INSPECTOR] Error fetching integrations catalog: {e}")
        return []


def get_user_coach_profile(user_id: str, company_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetches the personalized coaching onboarding profile directly from users.coach_profile.
    Returns None if the user has not completed onboarding yet or record not found.
    """
    if not user_id:
        return None
    try:
        # 1. Lookup by user_id
        res = (
            supabase_admin.table("users")
            .select("coach_profile")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        data = getattr(res, "data", None) or []
        if not data:
            # Fallback by id
            res = (
                supabase_admin.table("users")
                .select("coach_profile")
                .eq("id", user_id)
                .limit(1)
                .execute()
            )
            data = getattr(res, "data", None) or []

        if data:
            raw_profile = data[0].get("coach_profile")
            if isinstance(raw_profile, dict) and bool(raw_profile):
                return raw_profile
        return None
    except Exception as e:
        print(f"[COACH PROFILE] Note fetching user coach profile from users table: {e}")
        return None


def save_user_coach_profile(user_id: str, company_id: str, profile_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Saves or updates the personalized coaching profile directly in users.coach_profile JSONB column.
    Supports dynamic, extensible onboarding questions without requiring future schema changes.
    """
    if not user_id:
        return profile_data

    # Retrieve existing coach_profile or default to empty dict
    existing = get_user_coach_profile(user_id=user_id, company_id=company_id) or {}
    updated_profile = {**existing, **profile_data}
    updated_profile["onboarded"] = True
    updated_profile["updated_at"] = datetime.utcnow().isoformat()

    try:
        # Update matching user_id
        res = (
            supabase_admin.table("users")
            .update({"coach_profile": updated_profile})
            .eq("user_id", user_id)
            .execute()
        )
        data = getattr(res, "data", None) or []
        if not data:
            # Fallback update matching id
            supabase_admin.table("users").update({"coach_profile": updated_profile}).eq("id", user_id).execute()

        return updated_profile
    except Exception as e:
        print(f"[COACH PROFILE] Error saving coach profile into users table: {e}")
        return updated_profile


def format_schema_for_sql_prompt(schema_dict: Dict[str, Any], company_id: str) -> str:
    """
    Formats the introspected schema and sample rows into a clear, strict Markdown
    specification for the Text-to-SQL LLM prompt.
    """
    if not schema_dict.get("has_spreadsheet_data"):
        return "No spreadsheet tables are currently uploaded for this company."

    lines = [
        "### AVAILABLE DATABASE SCHEMA & TABULAR DATA",
        "Target Table: public.coach_spreadsheet_rows",
        f"Tenant Scope: company_id = '{company_id}' (MANDATORY IN EVERY QUERY)",
        "",
        "Table Columns in coach_spreadsheet_rows:",
        "  - id: UUID",
        "  - company_id: UUID (Must filter by: company_id = '" + company_id + "')",
        "  - sheet_name: TEXT (Filter by sheet_name)",
        "  - employee_name: TEXT (Full employee name, e.g. 'Rahul Sharma')",
        "  - target_employee_id: UUID (Optional employee user ID)",
        "  - row_index: INTEGER (Row number from original sheet)",
        "  - row_data: JSONB (Contains key-value pairs of all sheet columns)",
        "",
        "Available Sheet Tabs & Detected Fields:"
    ]

    for sheet_name, info in schema_dict.get("sheets", {}).items():
        doc_info = f"File: {info['file_name']}"
        if info.get("document_period"):
            doc_info += f" | Period: {info['document_period']}"

        lines.append(f"\n--- Sheet: '{sheet_name}' ({doc_info}) ---")
        cols = info.get("columns", [])
        lines.append(f"Columns: {', '.join(cols)}")

        samples = info.get("sample_rows", [])
        if samples:
            lines.append("Sample row_data JSONB:")
            for s in samples[:2]:
                lines.append(f"  {s}")

    lines.append("\nSQL JSONB Syntax & Date Rules:")
    lines.append("  1. Access JSONB text: (row_data->>'Column Name') (strictly case-sensitive; check exact names and sample rows above)")
    lines.append("  2. Access JSONB number: NULLIF(regexp_replace(coalesce(row_data->>'Cases', row_data->>'CASES', ''), '[^0-9.]', '', 'g'), '')::numeric")
    lines.append("  3. DATE MATCHING: Carefully inspect how dates are formatted in 'Sample row_data JSONB' above (e.g. '02.04.26' is DD.MM.YY).")
    lines.append("     - Match the table format directly: coalesce(row_data->>'Date', row_data->>'DATE') = '02.04.26' OR coalesce(row_data->>'Date', row_data->>'DATE') ILIKE '%02.04.26%'")
    lines.append("     - Or use to_date with matching format: to_date(coalesce(row_data->>'Date', row_data->>'DATE'), 'DD.MM.YY') = '2026-04-02'")
    lines.append("     - Do NOT use raw ::date = 'YYYY-MM-DD' on dot-separated dates like '02.04.26' because PostgreSQL will misparse day vs month.")
    lines.append(f"  4. ALWAYS include: WHERE company_id = '{company_id}'")

    return "\n".join(lines)
