-- ============================================================================
-- Migration: 20261027_create_audit_logs_table.sql
-- Description: Immutable Audit Trail for Sensitive Operations (SOC 2 & GDPR compliant).
--              Tracks actor, action, target entity, tenant company, diffs, IP, 
--              User-Agent, and timestamps.
--              Enforces append-only immutability via PostgreSQL trigger and RLS.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    actor_id            UUID NULL,
    actor_email         TEXT NULL,
    actor_role          TEXT NULL,
    company_id          UUID NULL,
    action              TEXT NOT NULL,
    action_category     TEXT NOT NULL DEFAULT 'IAM', -- 'IAM', 'TENANT', 'SECURITY', 'DISPATCH', 'EXPORT'
    target_type         TEXT NOT NULL,               -- 'user', 'role_assignment', 'company', 'dispatch', 'auth', 'export'
    target_id           TEXT NULL,
    target_name         TEXT NULL,
    changes             JSONB NULL,                  -- Diffs e.g. {"old": {...}, "new": {...}}
    details             JSONB NULL,                  -- Metadata e.g. {"recipient_count": 50}
    ip_address          TEXT NULL,
    user_agent          TEXT NULL,
    status              TEXT NOT NULL DEFAULT 'SUCCESS', -- 'SUCCESS', 'FAILED'
    error_message       TEXT NULL
);

-- ==================== INDEXES FOR HIGH-THROUGHPUT FILTERING ====================
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created ON public.audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON public.audit_logs(action_category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs(target_type, target_id);

-- ==================== IMMUTABILITY TRIGGER (SOC 2 / GDPR) ====================
-- Strictly forbid any UPDATE or DELETE operations on audit_logs.
CREATE OR REPLACE FUNCTION public.prevent_audit_log_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are immutable. UPDATE and DELETE operations are prohibited for compliance (SOC 2 / GDPR).'
        USING ERRCODE = '28000'; -- invalid_authorization_specification
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_tampering ON public.audit_logs;
CREATE TRIGGER trg_prevent_audit_log_tampering
    BEFORE UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_audit_log_tampering();

-- ==================== ROW LEVEL SECURITY (RLS) ====================
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. Service role has full insert and select capability (trigger still blocks update/delete)
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'audit_logs' AND policyname = 'service_role_audit_logs'
    ) THEN 
        CREATE POLICY "service_role_audit_logs" 
        ON public.audit_logs 
        FOR ALL TO service_role 
        USING (true) 
        WITH CHECK (true); 
    END IF; 
END $$;

-- 2. Authenticated users can insert audit records
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'audit_logs' AND policyname = 'authenticated_insert_audit_logs'
    ) THEN 
        CREATE POLICY "authenticated_insert_audit_logs" 
        ON public.audit_logs 
        FOR INSERT TO authenticated 
        WITH CHECK (true); 
    END IF; 
END $$;

-- 3. Authenticated users can select audit records belonging to their company or if super admin
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'audit_logs' AND policyname = 'authenticated_select_audit_logs'
    ) THEN 
        CREATE POLICY "authenticated_select_audit_logs" 
        ON public.audit_logs 
        FOR SELECT TO authenticated 
        USING (
            (company_id IS NOT NULL AND public.can_access_company(company_id))
            OR public.is_super_admin()
        ); 
    END IF; 
END $$;

COMMIT;
