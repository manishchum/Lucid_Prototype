# Backend/coach/schema_inspector.py
"""
Dynamic Schema & Document Introspection Engine for the Performance Coach Agent.
Extracts available spreadsheet sheets, column catalogs, sample rows, and document
inventories per company to ground the Text-to-SQL and Vector RAG engines.
"""

import time
from typing import Dict, Any, List, Optional
from utils.supabase_client import supabase_admin

# In-memory schema cache: { company_id: {"expires_at": float, "data": dict} }
_SCHEMA_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 180  # 3 minutes TTL


def get_company_spreadsheet_schema(company_id: str, force_refresh: bool = False) -> Dict[str, Any]:
    """
    Introspects all completed spreadsheet documents and rows for a company.
    Returns a structured dictionary of sheet names, columns, data types, and sample rows.
    """
    now = time.time()
    if not force_refresh and company_id in _SCHEMA_CACHE:
        cache_entry = _SCHEMA_CACHE[company_id]
        if cache_entry["expires_at"] > now:
            return cache_entry["data"]

    try:
        # 1. Fetch completed spreadsheet documents
        docs_res = (
            supabase_admin.table("coach_uploaded_documents")
            .select("id, file_name, file_type, document_period, description, parsed_metadata")
            .eq("company_id", company_id)
            .in_("status", ["completed", "embedding", "COMPLETED"])
            .in_("file_type", ["xlsx", "xls", "csv"])
            .execute()
        )
        spreadsheet_docs = getattr(docs_res, "data", None) or []

        sheets_meta: Dict[str, Any] = {}
        all_columns: set = set()

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
                if sheet_name not in sheets_meta:
                    sheets_meta[sheet_name] = {
                        "sheet_name": sheet_name,
                        "file_name": file_name,
                        "document_id": doc_id,
                        "document_period": period,
                        "columns": list(cols),
                        "sample_rows": []
                    }
                    all_columns.update(cols)

        # Discover any additional sheets directly from coach_spreadsheet_rows
        extra_sheets_res = (
            supabase_admin.table("coach_spreadsheet_rows")
            .select("sheet_name")
            .eq("company_id", company_id)
            .limit(100)
            .execute()
        )
        for r_s in (getattr(extra_sheets_res, "data", None) or []):
            sn = r_s.get("sheet_name")
            if sn and sn not in sheets_meta:
                sheets_meta[sn] = {
                    "sheet_name": sn,
                    "file_name": "Spreadsheet Record",
                    "columns": [],
                    "sample_rows": []
                }

        # 2. Fetch sample rows from coach_spreadsheet_rows for each sheet and enrich columns
        if sheets_meta:
            for sheet_name, sheet_info in sheets_meta.items():
                rows_res = (
                    supabase_admin.table("coach_spreadsheet_rows")
                    .select("employee_name, row_data")
                    .eq("company_id", company_id)
                    .eq("sheet_name", sheet_name)
                    .limit(2)
                    .execute()
                )
                sample_data = getattr(rows_res, "data", None) or []
                for r in sample_data:
                    row_dict = r.get("row_data") or {}
                    if r.get("employee_name") and "employee_name" not in row_dict:
                        row_dict["employee_name"] = r["employee_name"]
                    sheet_info["sample_rows"].append(row_dict)
                    # Enrich columns list directly from actual row keys
                    for k in row_dict.keys():
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

        # Cache result
        _SCHEMA_CACHE[company_id] = {
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


def get_company_document_catalog(company_id: str) -> List[Dict[str, Any]]:
    """
    Returns an inventory of all active coach documents (PDFs, DOCX, Spreadsheets, PPTX)
    so the router and synthesizer know what files exist.
    """
    try:
        res = (
            supabase_admin.table("coach_uploaded_documents")
            .select("id, file_name, file_type, document_period, description, target_employee_id, parsed_metadata")
            .eq("company_id", company_id)
            .in_("status", ["completed", "embedding", "COMPLETED"])
            .order("created_at", desc=True)
            .execute()
        )
        raw_docs = getattr(res, "data", None) or []
        catalog = []
        for d in raw_docs:
            meta = d.get("parsed_metadata") or {}
            catalog.append({
                "document_id": d["id"],
                "file_name": d["file_name"],
                "file_type": d["file_type"],
                "document_period": d.get("document_period"),
                "category": meta.get("category", "General Performance Record"),
                "key_topics": meta.get("key_topics", []),
                "summary": d.get("description") or "",
                "target_employee_id": d.get("target_employee_id")
            })
        return catalog
    except Exception as e:
        print(f"[COACH SCHEMA INSPECTOR] Error fetching document catalog: {e}")
        return []


def get_company_active_integrations(company_id: str) -> List[Dict[str, Any]]:
    """
    Returns an inventory of active cloud integrations (Google Drive, Gmail,
    Zoom, Teams, Slack, OneDrive) and their monitored folders/channels.
    Used by introspect_node and router_node to include connected workplace streams
    in the semantic whitelist.
    """
    try:
        res = (
            supabase_admin.table("company_integrations")
            .select("id, provider, account_identifier, status, config, last_synced_at")
            .eq("company_id", company_id)
            .eq("status", "active")
            .execute()
        )
        integrations = getattr(res, "data", None) or []
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
