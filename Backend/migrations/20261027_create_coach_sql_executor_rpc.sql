-- ============================================================================
-- Migration: 20261027_create_coach_sql_executor_rpc.sql
-- Description: Creates a secure, read-only SQL execution sandbox RPC for the 
--              Performance Coach Text-to-SQL Agent.
-- Features:
--   1. Strict Read-Only: Rejects any DDL / DML write keywords (INSERT, UPDATE, DELETE, etc.).
--   2. Multi-Statement Injection Prevention: Prohibits internal semicolons.
--   3. Tenant Isolation Guard: Enforces company_id presence in the query.
--   4. Dynamic JSON Output: Serializes arbitrary query results directly into a JSONB array.
--   5. Execution Timeout: 4-second maximum execution safeguard.
--   6. Hard Limit: Caps result rows at 100 to prevent LLM context overflow.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.execute_coach_sql_query(
    p_company_id uuid,
    p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_sql text;
    v_result jsonb;
    v_company_str text;
BEGIN
    -- 1. Validate mandatory tenant context
    IF p_company_id IS NULL THEN
        RAISE EXCEPTION 'company_id parameter is required.';
    END IF;

    v_clean_sql := trim(p_sql);
    v_company_str := p_company_id::text;

    -- 2. Reject multi-statement / stacked query injection
    IF v_clean_sql LIKE '%;%_%' THEN
        RAISE EXCEPTION 'Multiple SQL statements or embedded semicolons are strictly prohibited.';
    END IF;
    -- Strip trailing semicolons if present
    WHILE right(v_clean_sql, 1) = ';' LOOP
        v_clean_sql := trim(left(v_clean_sql, length(v_clean_sql) - 1));
    END LOOP;

    -- 3. Strict Read-Only Query Validation
    -- Query MUST begin with SELECT or WITH
    IF NOT (v_clean_sql ~* '^(SELECT|WITH)\s+') THEN
        RAISE EXCEPTION 'Only read-only SELECT or WITH statements are allowed.';
    END IF;

    -- Check for forbidden DDL / DML keywords as whole words
    IF v_clean_sql ~* '\m(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXECUTE|COPY|INTO)\M' THEN
        RAISE EXCEPTION 'Forbidden keyword detected. Data or schema mutation is strictly prohibited.';
    END IF;

    -- 4. Mandatory Tenant-Isolation Check
    -- The query MUST explicitly contain the caller''s company_id uuid to prevent cross-tenant queries
    IF position(v_company_str in v_clean_sql) = 0 THEN
        RAISE EXCEPTION 'Query must include the tenant company_id filter: %', v_company_str;
    END IF;

    -- 5. Safe Execution with Timeout & Limit (max 100 rows)
    -- Using nested subquery (SELECT * FROM ( %s ) _coach_inner LIMIT 100) ensures that queries
    -- with their own LIMIT (e.g. LIMIT 5) or without LIMIT never produce a syntax error.
    PERFORM set_config('statement_timeout', '4000', true);

    EXECUTE format(
        'SELECT coalesce(jsonb_agg(sub), ''[]''::jsonb) FROM ( SELECT * FROM ( %s ) _coach_inner LIMIT 100 ) sub',
        v_clean_sql
    ) INTO v_result;

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        -- Re-raise with exact SQLSTATE and error message to support LangGraph self-healing retry
        RAISE EXCEPTION 'SQL Execution Error: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.execute_coach_sql_query(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_coach_sql_query(uuid, text) TO service_role;

COMMIT;
