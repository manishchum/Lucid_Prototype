# Backend/coach/tools/sql_tool.py
"""
Text-to-SQL Tool for Performance Coach.
Generates and executes safe, read-only PostgreSQL JSONB queries on coach_spreadsheet_rows
with self-healing error correction support.
"""

import json
import re
from typing import Dict, Any, Optional, List
from config import OPENAI_API_KEY, GEMINI_API_KEY
from utils.supabase_client import supabase_admin


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
2. When querying sheet columns stored in `row_data`:
   - Column names in JSONB are strictly CASE-SENSITIVE. Always check the exact column names from the provided schema (e.g. 'DATE' vs 'Date' vs 'Follow Up Date', 'CASES' vs 'Cases').
   - Numeric aggregations: Clean units/text before casting: `NULLIF(regexp_replace(coalesce(row_data->>'Cases', row_data->>'CASES', ''), '[^0-9.]', '', 'g'), '')::numeric`
   - Text fields: `(row_data->>'Column Name')`
   - Case-insensitive text search: `(row_data->>'Column Name') ILIKE '%term%'`
3. CRITICAL DATE FORMAT RULES:
   - Carefully inspect the 'Sample row_data JSONB' in the schema to see how dates are stored in the table (e.g., DD.MM.YY like '02.04.26', DD/MM/YYYY like '02/04/2026', or YYYY-MM-DD like '2026-04-02').
   - Match the exact date format found in the table. For example, if dates in the table are formatted as DD.MM.YY (like '02.04.26'):
     Match the exact string or multiple variations:
     `coalesce(row_data->>'Date', row_data->>'DATE', row_data->>'Follow Up Date', '') IN ('02.04.26', '2.04.26', '2026-04-02')`
     OR `coalesce(row_data->>'Date', row_data->>'DATE') ILIKE '%02.04.26%'`
   - NEVER use raw `::date = 'YYYY-MM-DD'` on dot-separated dates like '02.04.26' because PostgreSQL's default DateStyle will misinterpret day vs month or fail.
4. If filtering by a specific employee, check both:
   `employee_name ILIKE '%Name%' OR (row_data->>'Employee Name') ILIKE '%Name%' OR (row_data->>'User Name') ILIKE '%Name%'`
5. ENTITY & DIMENSION INQUIRIES ("insights of...", "details of...", "performance of...", "list of..."):
   - When the user asks for insights, details, or breakdown of a specific entity (e.g. account, client, licensee, store, branch, product, employee, or location):
     a) Identify the matching column in the provided schema (e.g., 'Licensee Name', 'Employee Name', 'Store Name', 'Customer Name', 'ASE', 'Depot', etc.).
     b) Robust Text Matching:
        - If the entity contains a numeric code/ID alongside a name (e.g. '2302042 Neemkathana ... -2302042'):
          Filter on the key numeric ID or distinct keyword using ILIKE:
          `((row_data->>'Column') ILIKE '%2302042%' OR (row_data->>'Column') ILIKE '%Neemkathana%')`
          Do NOT search for long exact strings with hyphens or trailing duplicate codes, as formatting differences will result in 0 rows.
        - For multi-word entity names (e.g. 'mandoli manoj kumar'):
          Match key words flexibly:
          `((row_data->>'Column') ILIKE '%mandoli%' AND (row_data->>'Column') ILIKE '%manoj%')`
     c) Columns to SELECT: Select key descriptive columns (e.g. item/product, category, location, date) alongside numeric metrics (e.g. cases, quantities, amounts, totals) so comprehensive insights can be provided. Add `LIMIT 50` if returning itemized records.
6. If the question relates to a specific sheet, include `AND sheet_name = 'Sheet_Name'`.
7. Strictly generate READ-ONLY queries starting with SELECT. NEVER use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, or INTO.
8. Do NOT add trailing semicolons. Only add LIMIT if the user asks for a top-N ranking (e.g., 'top 5') or itemized entity rows (LIMIT 50); otherwise the execution sandbox automatically handles limits.
9. Return ONLY valid JSON with keys:
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

    prompt_parts = [
        schema_prompt,
        "",
        f"User Question: {user_query}"
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

    if target_employee_name:
        prompt_parts.append(f"Target Employee Context: {target_employee_name}")

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


def execute_coach_sql(company_id: str, sql_query: str) -> Dict[str, Any]:
    """
    Executes a generated SQL query via the secure Supabase execute_coach_sql_query RPC.
    Returns structured results: {"success": bool, "rows": list, "error": str, "row_count": int}.
    """
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

    # Pre-flight check: ensure company_id is present
    if company_id not in clean_query:
        # Auto-inject if missing
        if "WHERE" in clean_query.upper():
            clean_query = re.sub(r"(?i)\bWHERE\b", f"WHERE company_id = '{company_id}' AND ", clean_query, count=1)
        else:
            clean_query = f"{clean_query} WHERE company_id = '{company_id}'"

    # Strip any trailing LIMIT clause to avoid syntax error in RPCs that wrap queries with `LIMIT 100`
    sanitized_query = re.sub(r"(?i)\s+LIMIT\s+\d+\s*$", "", clean_query)

    try:
        res = supabase_admin.rpc(
            "execute_coach_sql_query",
            {
                "p_company_id": company_id,
                "p_sql": sanitized_query
            }
        ).execute()

        data = getattr(res, "data", None)
        if isinstance(data, list):
            rows = data
        elif isinstance(data, dict):
            rows = [data]
        else:
            rows = []

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

