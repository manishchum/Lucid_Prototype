-- ============================================================================
-- Migration: 20261112_create_rebac_and_multi_connector_rbac.sql
-- Description: Enterprise Connector RBAC, Multi-Instance Integrations,
--              Zanzibar-style ReBAC Tuple Graph, Pre-Retrieval ACL Arrays,
--              Hardened Text-to-SQL Authorized CTE Sandbox, and External Identity Mapping.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. MULTI-INSTANCE CONNECTORS: company_integrations
--    Removes 1-per-company-per-provider limit so Admin (org-wide) and
--    Managers (team/personal) can connect independent cloud accounts.
-- ============================================================================
ALTER TABLE public.company_integrations
    DROP CONSTRAINT IF EXISTS uq_company_provider;

ALTER TABLE public.company_integrations
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS connection_scope TEXT NOT NULL DEFAULT 'org',
    ADD COLUMN IF NOT EXISTS assigned_team_type TEXT,
    ADD COLUMN IF NOT EXISTS assigned_team_id UUID,
    ADD COLUMN IF NOT EXISTS visibility_mode TEXT NOT NULL DEFAULT 'acl_sync';

-- Backfill owner_user_id from connected_by for existing records
UPDATE public.company_integrations
SET owner_user_id = connected_by
WHERE owner_user_id IS NULL AND connected_by IS NOT NULL;

-- Enforce uniqueness per (company, provider, owner, external account)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_company_provider_owner_account'
    ) THEN
        ALTER TABLE public.company_integrations
            ADD CONSTRAINT uq_company_provider_owner_account
            UNIQUE NULLS NOT DISTINCT (company_id, provider, owner_user_id, account_identifier);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_company_integrations_owner
    ON public.company_integrations(company_id, owner_user_id, provider);

-- ============================================================================
-- 2. MULTI-INSTANCE VAULT RPCs (Keyed by integration_id with legacy fallback)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.store_integration_tokens(
    p_company_id UUID,
    p_provider TEXT,
    p_access_token TEXT,
    p_refresh_token TEXT,
    p_token_expires_at TIMESTAMPTZ,
    p_integration_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
    v_access_secret_id UUID;
    v_refresh_secret_id UUID;
    v_key_suffix TEXT;
    v_access_name TEXT;
    v_refresh_name TEXT;
BEGIN
    v_key_suffix := COALESCE(p_integration_id::text, p_company_id::text);
    v_access_name := p_provider || '_access_token_' || v_key_suffix;
    v_refresh_name := p_provider || '_refresh_token_' || v_key_suffix;

    SELECT id INTO v_access_secret_id
    FROM vault.secrets
    WHERE name = v_access_name
    LIMIT 1;

    IF v_access_secret_id IS NOT NULL THEN
        PERFORM vault.update_secret(v_access_secret_id, p_access_token);
    ELSE
        v_access_secret_id := vault.create_secret(
            p_access_token,
            v_access_name,
            p_provider || ' OAuth access token (' || v_key_suffix || ')'
        );
    END IF;

    SELECT id INTO v_refresh_secret_id
    FROM vault.secrets
    WHERE name = v_refresh_name
    LIMIT 1;

    IF p_refresh_token IS NOT NULL AND p_refresh_token <> '' THEN
        IF v_refresh_secret_id IS NOT NULL THEN
            PERFORM vault.update_secret(v_refresh_secret_id, p_refresh_token);
        ELSE
            v_refresh_secret_id := vault.create_secret(
                p_refresh_token,
                v_refresh_name,
                p_provider || ' OAuth refresh token (' || v_key_suffix || ')'
            );
        END IF;
    END IF;

    IF p_integration_id IS NOT NULL THEN
        UPDATE public.company_integrations
        SET
            access_token_secret_id = v_access_secret_id,
            refresh_token_secret_id = COALESCE(v_refresh_secret_id, refresh_token_secret_id),
            token_expires_at = p_token_expires_at,
            updated_at = timezone('utc'::text, now())
        WHERE id = p_integration_id AND company_id = p_company_id;
    ELSE
        UPDATE public.company_integrations
        SET
            access_token_secret_id = v_access_secret_id,
            refresh_token_secret_id = COALESCE(v_refresh_secret_id, refresh_token_secret_id),
            token_expires_at = p_token_expires_at,
            updated_at = timezone('utc'::text, now())
        WHERE company_id = p_company_id AND provider = p_provider;
    END IF;

    RETURN jsonb_build_object(
        'access_token_secret_id', v_access_secret_id,
        'refresh_token_secret_id', v_refresh_secret_id,
        'success', true
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_integration_tokens(
    p_company_id UUID,
    p_provider TEXT,
    p_integration_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
    v_access_secret_id UUID;
    v_refresh_secret_id UUID;
    v_token_expires_at TIMESTAMPTZ;
    v_access_token TEXT;
    v_refresh_token TEXT;
    v_key_suffix TEXT;
BEGIN
    IF p_integration_id IS NOT NULL THEN
        SELECT access_token_secret_id, refresh_token_secret_id, token_expires_at
        INTO v_access_secret_id, v_refresh_secret_id, v_token_expires_at
        FROM public.company_integrations
        WHERE id = p_integration_id AND company_id = p_company_id
        LIMIT 1;
        v_key_suffix := p_integration_id::text;
    ELSE
        SELECT access_token_secret_id, refresh_token_secret_id, token_expires_at
        INTO v_access_secret_id, v_refresh_secret_id, v_token_expires_at
        FROM public.company_integrations
        WHERE company_id = p_company_id AND provider = p_provider
        ORDER BY updated_at DESC
        LIMIT 1;
        v_key_suffix := p_company_id::text;
    END IF;

    IF v_access_secret_id IS NOT NULL THEN
        SELECT decrypted_secret INTO v_access_token
        FROM vault.decrypted_secrets
        WHERE id = v_access_secret_id;
    ELSE
        SELECT decrypted_secret INTO v_access_token
        FROM vault.decrypted_secrets
        WHERE name = p_provider || '_access_token_' || v_key_suffix
        LIMIT 1;
    END IF;

    IF v_refresh_secret_id IS NOT NULL THEN
        SELECT decrypted_secret INTO v_refresh_token
        FROM vault.decrypted_secrets
        WHERE id = v_refresh_secret_id;
    ELSE
        SELECT decrypted_secret INTO v_refresh_token
        FROM vault.decrypted_secrets
        WHERE name = p_provider || '_refresh_token_' || v_key_suffix
        LIMIT 1;
    END IF;

    RETURN jsonb_build_object(
        'access_token', v_access_token,
        'refresh_token', v_refresh_token,
        'token_expires_at', v_token_expires_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_integration_tokens(
    p_company_id UUID,
    p_provider TEXT,
    p_integration_id UUID DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
    v_access_secret_id UUID;
    v_refresh_secret_id UUID;
BEGIN
    IF p_integration_id IS NOT NULL THEN
        SELECT access_token_secret_id, refresh_token_secret_id
        INTO v_access_secret_id, v_refresh_secret_id
        FROM public.company_integrations
        WHERE id = p_integration_id AND company_id = p_company_id;

        DELETE FROM vault.secrets
        WHERE id IN (v_access_secret_id, v_refresh_secret_id)
           OR name IN (
               p_provider || '_access_token_' || p_integration_id::text,
               p_provider || '_refresh_token_' || p_integration_id::text
           );

        UPDATE public.company_integrations
        SET access_token_secret_id = NULL,
            refresh_token_secret_id = NULL,
            updated_at = timezone('utc'::text, now())
        WHERE id = p_integration_id AND company_id = p_company_id;
    ELSE
        DELETE FROM vault.secrets
        WHERE name IN (
            p_provider || '_access_token_' || p_company_id::text,
            p_provider || '_refresh_token_' || p_company_id::text
        );

        UPDATE public.company_integrations
        SET access_token_secret_id = NULL,
            refresh_token_secret_id = NULL,
            updated_at = timezone('utc'::text, now())
        WHERE company_id = p_company_id AND provider = p_provider;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.store_integration_tokens(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_integration_tokens(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.get_integration_tokens(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_integration_tokens(UUID, TEXT, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.delete_integration_tokens(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_integration_tokens(UUID, TEXT, UUID) TO service_role;

-- ============================================================================
-- 3. EXTERNAL IDENTITY ALIASING TABLE (Cloud Email/ID -> Lucid user_id)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_external_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    provider TEXT NOT NULL,                  -- 'google_drive', 'onedrive', 'slack', 'teams', 'gmail', 'zoom', 'google_meet'
    external_email TEXT,
    external_user_id TEXT,
    verified BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_user_ext_identity UNIQUE NULLS NOT DISTINCT (company_id, provider, user_id, external_email, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_ext_identities_lookup
    ON public.user_external_identities(company_id, provider, lower(external_email));
CREATE INDEX IF NOT EXISTS idx_user_ext_identities_ext_id
    ON public.user_external_identities(company_id, provider, external_user_id);

-- ============================================================================
-- 4. ZANZIBAR-STYLE REBAC TUPLE GRAPH: rebac_tuples
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.rebac_tuples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    object_type TEXT NOT NULL,               -- 'document' | 'container' | 'integration' | 'team' | 'department' | 'company'
    object_id TEXT NOT NULL,                 -- UUID or external container_id
    relation TEXT NOT NULL,                  -- 'owner' | 'parent' | 'viewer' | 'editor' | 'member' | 'manager' | 'scoped_subject' | 'deny_viewer'
    subject_type TEXT NOT NULL,              -- 'user' | 'team' | 'department' | 'role' | 'company' | 'container' | 'mgr_tree'
    subject_id TEXT NOT NULL,
    subject_relation TEXT,                   -- e.g. 'member' for team:A#member
    grant_source TEXT NOT NULL DEFAULT 'lucid_manual', -- 'org_hierarchy' | 'native_cloud' | 'lucid_manual' | 'ingestion_rule'
    expires_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_rebac_tuple UNIQUE NULLS NOT DISTINCT (
        company_id, object_type, object_id, relation, subject_type, subject_id, subject_relation, grant_source
    )
);

CREATE INDEX IF NOT EXISTS idx_rebac_object
    ON public.rebac_tuples(company_id, object_type, object_id, relation);
CREATE INDEX IF NOT EXISTS idx_rebac_subject
    ON public.rebac_tuples(company_id, subject_type, subject_id, relation);
CREATE INDEX IF NOT EXISTS idx_rebac_source
    ON public.rebac_tuples(company_id, grant_source, object_type, object_id);

ALTER TABLE public.rebac_tuples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_rebac_tuples" ON public.rebac_tuples;
CREATE POLICY "service_role_rebac_tuples" ON public.rebac_tuples
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "rls_rebac_tuples_company_select" ON public.rebac_tuples;
CREATE POLICY "rls_rebac_tuples_company_select" ON public.rebac_tuples
    FOR SELECT TO authenticated USING (public.can_access_company(company_id));

-- ============================================================================
-- 5. MATERIALIZED PRE-RETRIEVAL ACL ARRAYS & SENSITIVITY TIERS
-- ============================================================================
ALTER TABLE public.coach_uploaded_documents
    ADD COLUMN IF NOT EXISTS acl_principals TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS deny_principals TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS sensitivity_tier TEXT NOT NULL DEFAULT 'internal',
    ADD COLUMN IF NOT EXISTS source_integration_id UUID REFERENCES public.company_integrations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_container_id TEXT,
    ADD COLUMN IF NOT EXISTS author_user_id UUID,
    ADD COLUMN IF NOT EXISTS is_private_manager_note BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pii_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.coach_document_chunks
    ADD COLUMN IF NOT EXISTS acl_principals TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS deny_principals TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS sensitivity_tier TEXT NOT NULL DEFAULT 'internal';

ALTER TABLE public.coach_spreadsheet_rows
    ADD COLUMN IF NOT EXISTS acl_principals TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS deny_principals TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS sensitivity_tier TEXT NOT NULL DEFAULT 'internal';

-- Backfill legacy records deterministically (fail-safe: admin + target employee or uploader)
UPDATE public.coach_uploaded_documents
SET
    author_user_id = COALESCE(author_user_id, uploaded_by),
    acl_principals = ARRAY[
        'role:' || company_id::text || ':admin_plus',
        'user:' || uploaded_by::text
    ] || CASE
        WHEN target_employee_id IS NOT NULL THEN ARRAY['scoped_emp:' || target_employee_id::text]
        ELSE ARRAY[]::text[]
    END
WHERE acl_principals = '{}'::text[];

UPDATE public.coach_document_chunks c
SET
    acl_principals = d.acl_principals,
    deny_principals = d.deny_principals,
    sensitivity_tier = d.sensitivity_tier
FROM public.coach_uploaded_documents d
WHERE c.document_id = d.id
  AND c.acl_principals = '{}'::text[];

UPDATE public.coach_spreadsheet_rows r
SET
    acl_principals = CASE
        WHEN r.target_employee_id IS NOT NULL THEN
            ARRAY['role:' || r.company_id::text || ':admin_plus', 'scoped_emp:' || r.target_employee_id::text]
        ELSE d.acl_principals
    END,
    deny_principals = d.deny_principals,
    sensitivity_tier = d.sensitivity_tier
FROM public.coach_uploaded_documents d
WHERE r.document_id = d.id
  AND r.acl_principals = '{}'::text[];

-- GIN Indexes for sub-15ms Pre-Retrieval Array Overlap (&&)
CREATE INDEX IF NOT EXISTS idx_coach_docs_acl_gin
    ON public.coach_uploaded_documents USING gin (acl_principals);
CREATE INDEX IF NOT EXISTS idx_coach_docs_deny_gin
    ON public.coach_uploaded_documents USING gin (deny_principals);
CREATE INDEX IF NOT EXISTS idx_coach_chunks_acl_gin
    ON public.coach_document_chunks USING gin (acl_principals);
CREATE INDEX IF NOT EXISTS idx_coach_chunks_deny_gin
    ON public.coach_document_chunks USING gin (deny_principals);
CREATE INDEX IF NOT EXISTS idx_coach_chunks_sensitivity
    ON public.coach_document_chunks(company_id, sensitivity_tier);
CREATE INDEX IF NOT EXISTS idx_coach_rows_acl_gin
    ON public.coach_spreadsheet_rows USING gin (acl_principals);
CREATE INDEX IF NOT EXISTS idx_coach_rows_deny_gin
    ON public.coach_spreadsheet_rows USING gin (deny_principals);

-- ============================================================================
-- 6. PRE-RETRIEVAL VECTOR SEARCH RPC: match_coach_document_chunks
--    Enforces Zanzibar materialized ACLs & Sensitivity Tiers BEFORE HNSW limit.
-- ============================================================================
DROP FUNCTION IF EXISTS public.match_coach_document_chunks(vector(1024), uuid, uuid[], int, float);
DROP FUNCTION IF EXISTS public.match_coach_document_chunks(vector(1024), uuid, text[], boolean, text[], uuid[], int, float);

CREATE OR REPLACE FUNCTION public.match_coach_document_chunks(
    query_embedding vector(1024),
    p_company_id uuid,
    p_user_principals text[] DEFAULT '{}'::text[],
    p_is_admin boolean DEFAULT false,
    p_allowed_sensitivity_tiers text[] DEFAULT ARRAY['public', 'internal'],
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
SET search_path TO 'public'
AS $$
BEGIN
    -- Enable iterative HNSW scan when supported (pgvector >= 0.8.0) to prevent top-k starvation
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
          p_is_admin = true
          OR c.acl_principals && COALESCE(p_user_principals, '{}'::text[])
      )
      AND (
          p_allowed_employee_ids IS NULL
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
-- 7. HARDENED PRE-RETRIEVAL TEXT-TO-SQL SANDBOX RPC: execute_coach_sql_query
--    Injects an authorized _authorized_spreadsheet_rows CTE and rejects direct
--    table access to prevent cross-team aggregation leaks & unauthorized reads.
-- ============================================================================
DROP FUNCTION IF EXISTS public.execute_coach_sql_query(uuid, text);
DROP FUNCTION IF EXISTS public.execute_coach_sql_query(uuid, text, text[], boolean, text[]);

CREATE OR REPLACE FUNCTION public.execute_coach_sql_query(
    p_company_id uuid,
    p_sql text,
    p_user_principals text[] DEFAULT '{}'::text[],
    p_is_admin boolean DEFAULT false,
    p_allowed_sensitivity_tiers text[] DEFAULT ARRAY['public', 'internal']
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    -- 5. Rewrite any reference to public.coach_spreadsheet_rows / coach_spreadsheet_rows
    --    to query the pre-filtered _authorized_spreadsheet_rows CTE instead.
    v_clean_sql := regexp_replace(
        v_clean_sql,
        '\m(public\.)?coach_spreadsheet_rows\M',
        '_authorized_spreadsheet_rows',
        'gi'
    );

    -- If the query starts with WITH, merge into a single WITH block cleanly
    IF v_clean_sql ~* '^WITH\s+' THEN
        v_clean_sql := regexp_replace(v_clean_sql, '^WITH\s+', '', 'i');
        v_wrapped_sql := format(
            'WITH _authorized_spreadsheet_rows AS ('
            '  SELECT id, document_id, company_id, sheet_name, row_index, target_employee_id, employee_name, row_data, sensitivity_tier, created_at '
            '  FROM public.coach_spreadsheet_rows '
            '  WHERE company_id = %L::uuid '
            '    AND sensitivity_tier = ANY(%L::text[]) '
            '    AND NOT (deny_principals && COALESCE(%L::text[], ''{}''::text[])) '
            '    AND (%L::boolean = true OR acl_principals && COALESCE(%L::text[], ''{}''::text[]))'
            '), %s',
            p_company_id, p_allowed_sensitivity_tiers, p_user_principals, p_is_admin, p_user_principals,
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
            '    AND (%L::boolean = true OR acl_principals && COALESCE(%L::text[], ''{}''::text[]))'
            ') %s',
            p_company_id, p_allowed_sensitivity_tiers, p_user_principals, p_is_admin, p_user_principals,
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
