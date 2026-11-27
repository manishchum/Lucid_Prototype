# Backend/coach/tools/sql_tool.py
"""
Text-to-SQL Tool for Performance Coach.
Generates and executes safe, read-only PostgreSQL JSONB queries on coach_spreadsheet_rows
with self-healing error correction support.
"""

import json
import re
from datetime import datetime
from typing import Dict, Any, Optional, List
from config import OPENAI_API_KEY, GEMINI_API_KEY
from utils.supabase_client import supabase_admin
from security.pii_firewall import mask_spreadsheet_rows_for_role, allowed_tiers_for_role_level
from security.rebac import is_missing_schema_error

_RESTRICTED_TABLE_PATTERN = re.compile(
    r"(?i)\b(FROM|JOIN)\s+([a-zA-Z0-9_]+\.)?(users|roles|user_role_assignments|rebac_tuples|"
    r"company_integrations|coach_document_chunks|coach_uploaded_documents|audit_logs|user_external_identities|"
    r"vault|pg_catalog|information_schema)\b"
)


def _extract_sql_sec(security_ctx: Any) -> Dict[str, Any]:
    if not security_ctx:
        return {
            "has_context": False,
            "is_active": True,
            "is_admin": False,
            "role_level": 1,
            "user_id": "",
            "email": None,
            "principals": [],
            "allowed_tiers": ["public", "internal"],
            "managed_employee_ids": [],
        }
    if isinstance(security_ctx, dict):
        rl = int(security_ctx.get("role_level", 1))
        return {
            "has_context": True,
            "is_active": bool(security_ctx.get("is_active", True)),
            "is_admin": bool(security_ctx.get("is_admin", rl >= 3)),
            "role_level": rl,
            "user_id": str(security_ctx.get("user_id") or ""),
            "email": security_ctx.get("email"),
            "principals": list(security_ctx.get("principals") or []),
            "allowed_tiers": list(security_ctx.get("allowed_tiers") or allowed_tiers_for_role_level(rl)),
            "managed_employee_ids": list(security_ctx.get("managed_employee_ids") or []),
        }
    rl = int(getattr(security_ctx, "role_level", 1))
    return {
        "has_context": True,
        "is_active": bool(getattr(security_ctx, "is_active", True)),
        "is_admin": bool(getattr(security_ctx, "is_admin", rl >= 3)),
        "role_level": rl,
        "user_id": str(getattr(security_ctx, "user_id", "")),
        "email": getattr(security_ctx, "email", None),
        "principals": list(getattr(security_ctx, "principals", [])),
        "allowed_tiers": list(getattr(security_ctx, "allowed_tiers", allowed_tiers_for_role_level(rl))),
        "managed_employee_ids": list(getattr(security_ctx, "managed_employee_ids", [])),
    }


SQL_SYSTEM_PROMPT = """You are an expert PostgreSQL Data Engineer and Sales Analytics specialist.
Your task is to write a single, read-only PostgreSQL SELECT query to answer the user's question using the provided spreadsheet schema.

DATABASE SCHEMA:
- Table: public.coach_spreadsheet_rows
- Columns:
  - id: UUID
  - company_id: UUID (MANDATORY filter: company_id = '{company_id}')
  - sheet_name: TEXT (The sheet tab name)
  - employee_name: TEXT (Employee full name)
  - target_employee_id: UUID (Nullable)
  - row_index: INTEGER (Row number from original spreadsheet)
  - row_data: JSONB (Contains all columns from the spreadsheet)

CRITICAL RULES:
1. ALWAYS include the mandatory tenant filter: `WHERE company_id = '{company_id}'`.

2. MULTI-SHEET AGGREGATION & SHEET FILTER RULE (CRITICAL):
   - By default, do NOT filter by `sheet_name`! Data for employees, clients, accounts, or products often spans multiple sheets, months, or uploaded files.
   - ONLY include `AND sheet_name = '...'` if the user's question EXPLICITLY asks for a specific sheet or document by name (e.g., "in sheet 1", "from the May upload", "in Rural Territory Performance").
   - When the user asks general entity or aggregation questions (e.g. "total cases sold by licensee X", "who is the ase of Y", "list top performers"), OMIT the `sheet_name` filter so your query aggregates across ALL relevant rows in the company.

3. ROBUST COLUMN COALESCING (CRITICAL):
   - Different sheets may format column headers slightly differently (e.g., 'LICENSEE_NAME' vs 'LICENSEE NAME', 'TOTAL_CASE' vs 'TOTAL CASE' vs 'Cases', 'ASE' vs 'Assigned_ASM').
   - ALWAYS COALESCE possible header variations across detected sheets:
     * Entity matching: `coalesce(row_data->>'LICENSEE_NAME', row_data->>'LICENSEE NAME', row_data->>'Customer Name', row_data->>'Account Name', '')`
     * Metric aggregations: `NULLIF(regexp_replace(coalesce(row_data->>'TOTAL_CASE', row_data->>'TOTAL CASE', row_data->>'Cases', row_data->>'cases', ''), '[^0-9.]', '', 'g'), '')::numeric`
     * Executive/Person matching: `coalesce(row_data->>'ASE', row_data->>'Assigned_ASM', row_data->>'Salesperson', row_data->>'Employee Name', '')`
     * Location matching: `coalesce(row_data->>'H.Q.', row_data->>'HQ', row_data->>'DEPOT_NAME', row_data->>'DEO_OFFICE_NAME', row_data->>'District_Name', '')`
   - Numeric aggregations: Clean units/text before casting using the regexp_replace pattern above.
   - Text fields: Use case-insensitive search: `coalesce(...) ILIKE '%term%'`

4. GEOGRAPHIC & LOCATION QUERIES (e.g., cities, districts, headquarters, depots like Jaipur, Alwar, Behror):
   - Locations may be stored under various column names depending on the sheet: e.g. `H.Q.`, `HQ`, `DEPOT_NAME`, `DEO_OFFICE_NAME`, `CIRCLE_OFFICE_NAME`, `District_Name`, `State`, `City`, `Area`.
   - Inspect the columns of the sheet that has the requested entity/metric.
   - When matching a location (e.g. 'Jaipur' or 'Alwar'):
     Search across ALL relevant geographic columns of that sheet using ILIKE:
     For example, if the sheet has `H.Q.`, `DEPOT_NAME`, `DEO_OFFICE_NAME`:
     `AND (coalesce(row_data->>'H.Q.', row_data->>'DEPOT_NAME', row_data->>'DEO_OFFICE_NAME', '') ILIKE '%Jaipur%')`
   - If the user asks for multiple locations (e.g. "Jaipur and Alwar"):
     Match ANY of those locations:
     `AND (coalesce(row_data->>'H.Q.', row_data->>'DEPOT_NAME', row_data->>'DEO_OFFICE_NAME', '') ILIKE '%Jaipur%' OR coalesce(row_data->>'H.Q.', row_data->>'DEPOT_NAME', row_data->>'DEO_OFFICE_NAME', '') ILIKE '%Alwar%')`

5. CRITICAL DATE FORMAT RULES:
   - Only add a DATE filter (e.g. `Date = ...` or `to_date(...)`) if the user's question EXPLICITLY asks for a specific date, month, or time period (e.g. "on October 15", "last month", "in Q3").
   - NEVER invent or add a date filter for general questions like "how am I doing", "what is my performance", or "who are the top performers".
   - When a specific date is requested, carefully inspect the 'Sample row_data JSONB' in the schema to see how dates are stored in the table (e.g., DD.MM.YY like '02.04.26', DD/MM/YYYY like '02/04/2026', or YYYY-MM-DD like '2026-04-02').
   - Match the exact date format found in the table. For example, if dates in the table are formatted as DD.MM.YY (like '02.04.26'):
     Match the exact string or multiple variations:
     `coalesce(row_data->>'Date', row_data->>'DATE', row_data->>'Follow Up Date', '') IN ('02.04.26', '2.04.26', '2026-04-02')`
     OR `coalesce(row_data->>'Date', row_data->>'DATE') ILIKE '%02.04.26%'`
   - If user asks for a month (e.g. "month of april" or "in April"):
     Check if the sheet is already an April sheet or period, or if there is a Date/Month column:
     If the sheet period/filename is April and there's no specific day asked, do not over-filter dates. If there is a Date column with format DD.MM.YY, April dates match `ILIKE '%.04.%'` or `ILIKE '%-04-%'`.
   - NEVER use raw `::date = 'YYYY-MM-DD'` on dot-separated dates like '02.04.26' because PostgreSQL's default DateStyle will misinterpret day vs month or fail.

6. EMPLOYEE & PERSON NAME FILTERING (CRITICAL):
   - When filtering for an employee or salesperson (e.g. 'Riya', 'Riya Jhamb', 'Arjun Mehta'):
   - Spreadsheets very frequently store employees by FIRST NAME ONLY (e.g. 'Riya'), or first name + initial ('Riya J'), or full name ('Riya Jhamb').
   - If a full name is provided or asked (e.g. 'Riya Jhamb'), ALWAYS filter using the FIRST NAME: `ILIKE '%Riya%'` (or `(col ILIKE '%Riya Jhamb%' OR col ILIKE '%Riya%')`).
   - Check all likely employee columns:
     `employee_name ILIKE '%<FirstName>%' OR (row_data->>'Salesperson') ILIKE '%<FirstName>%' OR (row_data->>'Employee Name') ILIKE '%<FirstName>%' OR (row_data->>'Name') ILIKE '%<FirstName>%' OR (row_data->>'Employee') ILIKE '%<FirstName>%'`
   - NEVER filter strictly on the full multi-word string (`ILIKE '%Riya Jhamb%'`) alone, because if the spreadsheet stores only 'Riya', a full-name filter will return 0 rows! Matching on the first name `ILIKE '%Riya%'` safely matches both 'Riya' and 'Riya Jhamb'.
   - CRITICAL - NO UNPROMPTED EMPLOYEE FILTERING:
     If the user's query asks about a depot, headquarters, district, licensee, product, or general total (e.g., 'give me total sales of sikar depot', 'top 5 products', 'sales in Jaipur'):
     DO NOT add any condition filtering by the user's name or employee_name (e.g., DO NOT inject `(employee_name ILIKE '%Riya%' OR ...)`). Aggregate across ALL records for the requested depot or entity! Only filter by employee when the query explicitly asks for personal performance ('my sales') or names a specific salesperson.

7. ENTITY & DIMENSION INQUIRIES ("insights of...", "details of...", "performance of...", "list of..."):
   - When the user asks for insights, details, or breakdown of a specific entity (e.g. account, client, licensee, store, branch, product, employee, or location):
     a) Identify the matching column in the provided schema (e.g., 'Licensee Name', 'LICENSEE_NAME', 'Employee Name', 'Store Name', 'Customer Name', 'ASE', 'Depot', etc.).
     b) Robust Text Matching:
        - If the entity contains a numeric code/ID alongside a name (e.g. 'Arvind Gupta -1407010' or '2302042 Neemkathana ... -2302042'):
          Filter on the key numeric ID or distinct keyword using OR with ILIKE:
          `((row_data->>'LICENSEE_NAME') ILIKE '%1407010%' OR (row_data->>'LICENSEE_NAME') ILIKE '%Arvind%')`
          Do NOT search for long exact strings with hyphens or trailing duplicate codes, as formatting differences will result in 0 rows.
        - For multi-word entity names (e.g. 'mandoli manoj kumar'):
          Match key words flexibly:
          `((row_data->>'Column') ILIKE '%mandoli%' AND (row_data->>'Column') ILIKE '%manoj%')`
     c) Columns to SELECT: Select key descriptive columns (e.g. item/product, category, location, date, licensee, ASE) alongside numeric metrics (e.g. cases, quantities, amounts, totals) so comprehensive insights can be provided. Add `LIMIT 50` if returning itemized records.

8. SHEET NAME RULES:
   - Remember Rule 2: DO NOT filter by `sheet_name` unless the user explicitly named the sheet in their question.
   - If the user explicitly asks for a sheet, match the exact sheet name shown in `--- Sheet: '<Sheet_Name>' ---`.

9. Strictly generate READ-ONLY queries starting with SELECT on `public.coach_spreadsheet_rows` ONLY. NEVER query system or identity/permission tables (`users`, `roles`, `user_role_assignments`, `rebac_tuples`, `company_integrations`, `coach_document_chunks`, `coach_uploaded_documents`, `audit_logs`, `pg_catalog`, `information_schema`). NEVER use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, or INTO.

10. Do NOT add trailing semicolons. Only add LIMIT if the user asks for a top-N ranking (e.g., 'top 5') or itemized entity rows (LIMIT 50); otherwise the execution sandbox automatically handles limits.

11. Return ONLY valid JSON with keys:
   {
     "sql_query": "SELECT ...",
     "explanation": "Brief explanation of what this query aggregates."
   }
"""


def generate_coach_sql(
    user_query: str,
    company_id: str,
    schema_prompt: str,
    target_employee_name: Optional[str] = None,
    previous_error: Optional[str] = None,
    previous_query: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generates a PostgreSQL JSONB query from natural language using gpt-4o-mini or gemini-1.5-flash.
    Supports self-healing retry if previous_error is provided.
    """
    system_instruction = SQL_SYSTEM_PROMPT.replace("{company_id}", company_id)

    current_dt = datetime.utcnow()
    today_str = current_dt.strftime("%A, %B %d, %Y")
    current_month_str = current_dt.strftime("%B %Y")

    prompt_parts = [
        schema_prompt,
        "",
        f"User Question: {user_query}",
        f"\nTEMPORAL CONTEXT: Today's real-world date is {today_str} (Current Month: {current_month_str})."
    ]

    # Detect date patterns in user query (e.g. "02.04.26", "2026-04-02", "02/04/2026")
    date_matches = re.findall(r"\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b", user_query)
    if date_matches:
        detected_dates = ", ".join([f"'{d}'" for d in date_matches])
        prompt_parts.append(
            f"\nIMPORTANT DATE MATCHING GUIDANCE:\n"
            f"The user query references date: {detected_dates}.\n"
            "Carefully check the 'Sample row_data JSONB' in the schema above to see the exact column name (e.g. 'DATE', 'Date', 'Follow Up Date') and how date values are formatted (e.g. '02.04.26' in DD.MM.YY format).\n"
            "In your WHERE clause, match the exact format used in the table (e.g. coalesce(row_data->>'DATE', row_data->>'Date') = '02.04.26' OR ... ILIKE '%02.04.26%'). Do NOT use raw ::date = 'YYYY-MM-DD'."
        )

    if target_employee_name and target_employee_name.strip():
        clean_emp = target_employee_name.strip()
        name_parts = clean_emp.split()
        first_name = name_parts[0] if name_parts else clean_emp
        # Match explicit first-person requests like "my sales", "what did I sell", "total sales by me"
        is_first_person = bool(re.search(r"\b(my|mine|myself)\b|\b(i|me)\s+(sold|closed|did|generated|achieved)\b|\bby\s+(me|myself)\b", user_query, re.IGNORECASE))
        mentions_user_name = bool(re.search(rf"\b(by|for|of)\s+({re.escape(first_name)}|{re.escape(clean_emp)})\b", user_query, re.IGNORECASE))

        if is_first_person or mentions_user_name:
            prompt_parts.append(
                f"\nAUTHENTICATED USER / EMPLOYEE CONTEXT:\n"
                f"- User Asking the Question: '{clean_emp}' (First Name: '{first_name}')\n"
                f"- The user is explicitly asking about their own personal performance ('{clean_emp}' / '{first_name}').\n"
                f"- FILTER THE SPREADSHEET FOR THIS EMPLOYEE using flexible first-name matching ('{first_name}'):\n"
                f"  `WHERE company_id = '{company_id}' AND (\n"
                f"     employee_name ILIKE '%{first_name}%' OR\n"
                f"     (row_data->>'Salesperson') ILIKE '%{first_name}%' OR\n"
                f"     (row_data->>'Employee Name') ILIKE '%{first_name}%' OR\n"
                f"     (row_data->>'Employee') ILIKE '%{first_name}%' OR\n"
                f"     (row_data->>'Name') ILIKE '%{first_name}%'\n"
                f"   )`\n"
            )
        else:
            prompt_parts.append(
                f"\nAUTHENTICATED USER CONTEXT:\n"
                f"- User asking the query: '{clean_emp}'.\n"
                f"- CRITICAL SCOPING RULE: The user is asking a GENERAL or ENTITY-SPECIFIC question (e.g. for a depot, territory, licensee, product, or entire company), NOT about their own personal records!\n"
                f"- STRICT REQUIREMENT: DO NOT filter by employee_name, salesperson, or '{clean_emp}' / '{first_name}'! Do NOT add any WHERE conditions matching '{first_name}' or '{clean_emp}'. Query and aggregate across ALL relevant records in the dataset matching the requested entity/depot/location."
            )

    if previous_error and previous_query:
        prompt_parts.extend([
            "",
            "CRITICAL: YOUR PREVIOUS SQL QUERY FAILED WITH THE FOLLOWING DATABASE ERROR.",
            f"Failed SQL: {previous_query}",
            f"Postgres Error: {previous_error}",
            "Analyze the error carefully (e.g. invalid type cast, missing column, wrong sheet name, or invalid syntax) and generate a corrected SQL query."
        ])

    full_user_prompt = "\n".join(prompt_parts)

    # 1. Try OpenAI (gpt-4o-mini)
    if OPENAI_API_KEY:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": full_user_prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.0,
                max_tokens=400
            )
            raw = response.choices[0].message.content or "{}"
            data = json.loads(raw.strip())
            if data.get("sql_query"):
                return {
                    "sql_query": data["sql_query"].strip(),
                    "explanation": data.get("explanation", ""),
                    "provider": "openai"
                }
        except Exception as e:
            print(f"[COACH SQL TOOL] OpenAI generation failed: {e}")

    # 2. Try Gemini (gemini-1.5-flash)
    if GEMINI_API_KEY:
        try:
            from google import genai
            from google.genai.types import GenerateContentConfig

            client = genai.Client(api_key=GEMINI_API_KEY)
            config = GenerateContentConfig(
                temperature=0.0,
                max_output_tokens=400,
                response_mime_type="application/json"
            )
            gemini_prompt = f"{system_instruction}\n\n{full_user_prompt}"
            res = client.models.generate_content(
                model="gemini-1.5-flash",
                contents=gemini_prompt,
                config=config
            )
            raw = res.text or "{}"
            data = json.loads(raw.strip())
            if data.get("sql_query"):
                return {
                    "sql_query": data["sql_query"].strip(),
                    "explanation": data.get("explanation", ""),
                    "provider": "gemini"
                }
        except Exception as e:
            print(f"[COACH SQL TOOL] Gemini generation failed: {e}")

    return {
        "sql_query": None,
        "explanation": "Unable to generate SQL: LLM API key not configured or unreachable.",
        "provider": None
    }


def execute_coach_sql(
    company_id: str,
    sql_query: str,
    security_ctx: Any = None,
) -> Dict[str, Any]:
    """
    Executes a generated SQL query via the secure Supabase execute_coach_sql_query RPC
    with Pre-Retrieval ACL filtering and Layer 2 column/row masking.
    Returns structured results: {"success": bool, "rows": list, "error": str, "row_count": int}.
    """
    sec = _extract_sql_sec(security_ctx)
    if sec["has_context"] and not sec["is_active"]:
        return {
            "success": False,
            "rows": [],
            "error": "Access denied: inactive user cannot execute spreadsheet queries.",
            "row_count": 0
        }

    if not sql_query or not sql_query.strip():
        return {
            "success": False,
            "rows": [],
            "error": "Empty SQL query.",
            "row_count": 0
        }

    clean_query = sql_query.strip()
    # Strip any trailing semicolons
    clean_query = clean_query.rstrip(";").strip()

    # Pre-flight block on unauthorized/system tables (allows JSONB keys like row_data->>'Users')
    restricted_match = _RESTRICTED_TABLE_PATTERN.search(clean_query)
    if restricted_match:
        return {
            "success": False,
            "rows": [],
            "error": f"Security Policy Violation: querying restricted table '{restricted_match.group(3)}' is not permitted.",
            "row_count": 0
        }

    # Pre-flight check: ensure company_id is present
    if company_id not in clean_query:
        # Auto-inject if missing
        if "WHERE" in clean_query.upper():
            clean_query = re.sub(r"(?i)\bWHERE\b", f"WHERE company_id = '{company_id}' AND ", clean_query, count=1)
        else:
            clean_query = f"{clean_query} WHERE company_id = '{company_id}'"

    # Strip any trailing LIMIT clause to avoid syntax error in RPCs that wrap queries with `LIMIT 100`
    sanitized_query = re.sub(r"(?i)\s+LIMIT\s+\d+\s*$", "", clean_query)

    rpc_payload: Dict[str, Any] = {
        "p_company_id": company_id,
        "p_sql": sanitized_query,
    }
    if sec["has_context"]:
        rpc_payload["p_user_principals"] = sec["principals"]
        rpc_payload["p_is_admin"] = sec["is_admin"]
        rpc_payload["p_allowed_sensitivity_tiers"] = sec["allowed_tiers"]

    try:
        try:
            res = supabase_admin.rpc(
                "execute_coach_sql_query",
                rpc_payload
            ).execute()
        except Exception as rpc_err:
            if not is_missing_schema_error(rpc_err):
                raise
            # Legacy RPC signature fallback when 20261112 migration hasn't been applied yet
            legacy_sql = sanitized_query
            if sec["has_context"] and not sec["is_admin"]:
                allowed_ids = [sec["user_id"], *sec["managed_employee_ids"]]
                safe_ids = ", ".join(f"'{eid}'" for eid in allowed_ids if re.fullmatch(r"[0-9a-fA-F\-]{8,}", str(eid)))
                emp_filter = f"(target_employee_id IS NULL OR target_employee_id IN ({safe_ids}))" if safe_ids else "target_employee_id IS NULL"
                if "WHERE" in legacy_sql.upper():
                    legacy_sql = re.sub(r"(?i)\bWHERE\b", f"WHERE {emp_filter} AND ", legacy_sql, count=1)
                else:
                    legacy_sql = f"{legacy_sql} WHERE {emp_filter}"
            res = supabase_admin.rpc(
                "execute_coach_sql_query",
                {"p_company_id": company_id, "p_sql": legacy_sql}
            ).execute()

        data = getattr(res, "data", None)
        if isinstance(data, list):
            rows = data
        elif isinstance(data, dict):
            rows = [data]
        else:
            rows = []

        if sec["has_context"] and rows:
            rows = mask_spreadsheet_rows_for_role(
                rows,
                caller_user_id=sec["user_id"],
                role_level=sec["role_level"],
            )

        return {
            "success": True,
            "rows": rows,
            "row_count": len(rows),
            "executed_sql": sanitized_query,
            "error": None
        }

    except Exception as e:
        err_msg = str(e)
        print(f"[COACH SQL TOOL] Execution failed: {err_msg}")
        return {
            "success": False,
            "rows": [],
            "row_count": 0,
            "executed_sql": sanitized_query,
            "error": err_msg
        }

