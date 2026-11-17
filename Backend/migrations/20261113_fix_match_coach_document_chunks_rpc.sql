-- ============================================================================
-- Fix: ReBAC RPC Compatibility & Bug Remediation
-- Fixes match_coach_document_chunks & execute_coach_sql_query after
-- migration 20261112_create_rebac_and_multi_connector_rbac.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. FIX VECTOR SEARCH RPC: match_coach_document_chunks
-- ============================================================================
DROP FUNCTION IF EXISTS public.match_coach_document_chunks(vector(1024), uuid, text[], boolean, text[], uuid[], int, float);
DROP FUNCTION IF EXISTS public.match_coach_document_chunks(vector(1024), uuid, uuid[], int, float);
DROP FUNCTION IF EXISTS public.match_coach_document_chunks;

CREATE OR REPLACE FUNCTION public.match_coach_document_chunks(
    query_embedding vector(1024),
    p_company_id uuid,
    p_user_principals text[] DEFAULT '{}'::text[],
    p_is_admin boolean DEFAULT false,
    p_allowed_sensitivity_tiers text[] DEFAULT ARRAY['public', 'internal', 'confidential', 'restricted'],
    p_allowed_employee_ids uuid[] DEFAULT NULL,
    match_count int DEFAULT 8,
    match_threshold float DEFAULT 0.0
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    company_id uuid,
    target_employee_id uuid,
    chunk_index int,
    chunk_type text,
    content text,
    citation jsonb,
    sensitivity_tier text,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
    -- Increase HNSW search depth for filtered company multi-tenancy
    SET LOCAL hnsw.ef_search = 100;
    
    -- Enable iterative HNSW scan when supported (pgvector >= 0.8.0)
    BEGIN
        EXECUTE 'SET LOCAL hnsw.iterative_scan = relaxed_order';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN QUERY
    SELECT
        c.id,
        c.document_id,
        c.company_id,
        c.target_employee_id,
        c.chunk_index,
        c.chunk_type,
        c.content,
        c.citation,
        c.sensitivity_tier,
        (1 - (c.embedding <=> query_embedding))::float AS similarity
    FROM public.coach_document_chunks c
    WHERE c.company_id = p_company_id
      AND c.sensitivity_tier = ANY(p_allowed_sensitivity_tiers)
      AND NOT (c.deny_principals && COALESCE(p_user_principals, '{}'::text[]))
      AND (
          -- Allow if admin OR if no user principals restricted OR if matching principal overlap
          p_is_admin = true
          OR cardinality(COALESCE(p_user_principals, '{}'::text[])) = 0
          OR c.acl_principals && p_user_principals
      )
      AND (
          -- Allow team/general docs (target_employee_id IS NULL) OR matching employee
          p_allowed_employee_ids IS NULL
          OR cardinality(p_allowed_employee_ids) = 0
          OR array_length(p_allowed_employee_ids, 1) IS NULL
          OR c.target_employee_id IS NULL
          OR c.target_employee_id = ANY(p_allowed_employee_ids)
      )
      AND (1 - (c.embedding <=> query_embedding)) >= match_threshold
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

REVOKE ALL ON FUNCTION public.match_coach_document_chunks(vector(1024), uuid, text[], boolean, text[], uuid[], int, float) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_coach_document_chunks(vector(1024), uuid, text[], boolean, text[], uuid[], int, float) TO authenticated, service_role;


-- ============================================================================
-- 2. FIX TEXT-TO-SQL SANDBOX RPC: execute_coach_sql_query
-- ============================================================================
DROP FUNCTION IF EXISTS public.execute_coach_sql_query(uuid, text, text[], boolean, text[]);
DROP FUNCTION IF EXISTS public.execute_coach_sql_query(uuid, text);
DROP FUNCTION IF EXISTS public.execute_coach_sql_query;

CREATE OR REPLACE FUNCTION public.execute_coach_sql_query(
    p_company_id uuid,
    p_sql text,
    p_user_principals text[] DEFAULT '{}'::text[],
    p_is_admin boolean DEFAULT false,
    p_allowed_sensitivity_tiers text[] DEFAULT ARRAY['public', 'internal', 'confidential', 'restricted']
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_clean_sql text;
    v_wrapped_sql text;
    v_result jsonb;
    v_company_str text;
BEGIN
    IF p_company_id IS NULL THEN
        RAISE EXCEPTION 'company_id parameter is required.';
    END IF;

    v_clean_sql := trim(p_sql);
    v_company_str := p_company_id::text;

    -- 1. Reject stacked queries / internal semicolons
    IF v_clean_sql LIKE '%;%_%' THEN
        RAISE EXCEPTION 'Multiple SQL statements or embedded semicolons are strictly prohibited.';
    END IF;
    WHILE right(v_clean_sql, 1) = ';' LOOP
        v_clean_sql := trim(left(v_clean_sql, length(v_clean_sql) - 1));
    END LOOP;

    -- 2. Strictly read-only SELECT or WITH
    IF NOT (v_clean_sql ~* '^(SELECT|WITH)\s+') THEN
        RAISE EXCEPTION 'Only read-only SELECT or WITH statements are allowed.';
    END IF;

    -- 3. Reject DDL/DML keywords & restricted table/schema references
    IF v_clean_sql ~* '\m(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXECUTE|COPY|INTO)\M' THEN
        RAISE EXCEPTION 'Forbidden SQL keyword detected. Data or schema mutation is strictly prohibited.';
    END IF;
    IF v_clean_sql ~* '(FROM|JOIN)\s+([a-zA-Z0-9_]+\.)?(users|rebac_tuples|audit_logs|company_integrations|user_role_assignments|user_external_identities|coach_uploaded_documents|coach_document_chunks)\M'
       OR v_clean_sql ~* '\m(pg_catalog|information_schema|vault)\.' THEN
        RAISE EXCEPTION 'Access to restricted database tables or schemas is strictly prohibited.';
    END IF;

    -- 4. Mandatory Tenant Check
    IF position(v_company_str in v_clean_sql) = 0 THEN
        RAISE EXCEPTION 'Query must include the tenant company_id filter: %', v_company_str;
    END IF;

    -- 5. Rewrite references to coach_spreadsheet_rows to query the authorized CTE
    v_clean_sql := regexp_replace(
        v_clean_sql,
        '\m(public\.)?coach_spreadsheet_rows\M',
        '_authorized_spreadsheet_rows',
        'gi'
    );

    -- Build wrapped query with authorized CTE
    IF v_clean_sql ~* '^WITH\s+' THEN
        v_clean_sql := regexp_replace(v_clean_sql, '^WITH\s+', '', 'i');
        v_wrapped_sql := format(
            'WITH _authorized_spreadsheet_rows AS ('
            '  SELECT id, document_id, company_id, sheet_name, row_index, target_employee_id, employee_name, row_data, sensitivity_tier, created_at '
            '  FROM public.coach_spreadsheet_rows '
            '  WHERE company_id = %L::uuid '
            '    AND sensitivity_tier = ANY(%L::text[]) '
            '    AND NOT (deny_principals && COALESCE(%L::text[], ''{}''::text[])) '
            '    AND (%L::boolean = true OR cardinality(COALESCE(%L::text[], ''{}''::text[])) = 0 OR acl_principals && %L::text[])'
            '), %s',
            p_company_id, p_allowed_sensitivity_tiers, p_user_principals, p_is_admin, p_user_principals, p_user_principals,
            v_clean_sql
        );
    ELSE
        v_wrapped_sql := format(
            'WITH _authorized_spreadsheet_rows AS ('
            '  SELECT id, document_id, company_id, sheet_name, row_index, target_employee_id, employee_name, row_data, sensitivity_tier, created_at '
            '  FROM public.coach_spreadsheet_rows '
            '  WHERE company_id = %L::uuid '
            '    AND sensitivity_tier = ANY(%L::text[]) '
            '    AND NOT (deny_principals && COALESCE(%L::text[], ''{}''::text[])) '
            '    AND (%L::boolean = true OR cardinality(COALESCE(%L::text[], ''{}''::text[])) = 0 OR acl_principals && %L::text[])'
            ') %s',
            p_company_id, p_allowed_sensitivity_tiers, p_user_principals, p_is_admin, p_user_principals, p_user_principals,
            v_clean_sql
        );
    END IF;

    PERFORM set_config('statement_timeout', '4000', true);

    EXECUTE format(
        'SELECT coalesce(jsonb_agg(sub), ''[]''::jsonb) FROM ( SELECT * FROM ( %s ) _coach_inner LIMIT 100 ) sub',
        v_wrapped_sql
    ) INTO v_result;

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'SQL Execution Error: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_coach_sql_query(uuid, text, text[], boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_coach_sql_query(uuid, text, text[], boolean, text[]) TO authenticated, service_role;

COMMIT;
