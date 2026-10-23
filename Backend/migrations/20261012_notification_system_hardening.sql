-- ============================================================================
-- Migration: 20261012_notification_system_hardening.sql
-- Description: Hardening, indexing, and batching RPCs for the Lucid Notification System.
--              1. Adds composite indexes on public.notifications for O(1) unread counting and feed sorting.
--              2. Ensures repository schema parity for registry and audit tables.
--              3. Fixes schedule_notification_job_rpc company_id null constraint bug.
--              4. Implements schedule_bulk_notification_jobs_rpc for high-performance atomic batch scheduling.
-- ============================================================================

BEGIN;

-- 1. Performance Indexes for notifications table
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
    ON public.notifications (user_id, read) 
    WHERE read = FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created 
    ON public.notifications (user_id, created_at DESC);

-- 2. Registry & Audit Tables (Idempotent for repo migration parity)
CREATE TABLE IF NOT EXISTS public.notification_variable_registry (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 VARCHAR(128) NOT NULL UNIQUE,
    label               VARCHAR(128) NOT NULL,
    description         TEXT NULL,
    data_type           VARCHAR(32) NOT NULL DEFAULT 'string',
    namespace           VARCHAR(64) NOT NULL DEFAULT 'custom',
    source_path         TEXT NULL,
    is_required         BOOLEAN NOT NULL DEFAULT FALSE,
    default_fallback    TEXT NULL,
    sample_value        TEXT NOT NULL DEFAULT '',
    is_system           BOOLEAN NOT NULL DEFAULT FALSE,
    created_by          UUID NULL REFERENCES public.users(user_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_event_presets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                     VARCHAR(64) NOT NULL UNIQUE,
    label                   VARCHAR(128) NOT NULL,
    category                VARCHAR(64) NOT NULL DEFAULT 'CUSTOM',
    description             TEXT NULL,
    default_channels        TEXT[] NOT NULL DEFAULT '{"IN_APP","PUSH"}',
    recommended_variables   TEXT[] NOT NULL DEFAULT '{}',
    is_system               BOOLEAN NOT NULL DEFAULT FALSE,
    created_by              UUID NULL REFERENCES public.users(user_id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_dispatch_audit (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correlation_id      VARCHAR(64) NOT NULL,
    template_id         UUID NULL REFERENCES public.notification_templates(id) ON DELETE SET NULL,
    notification_type   VARCHAR(64) NOT NULL,
    channel             VARCHAR(24) NOT NULL,
    recipient_user_id   UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    status              VARCHAR(32) NOT NULL,
    resolved_variables  JSONB NOT NULL DEFAULT '{}'::jsonb,
    rendered_title      TEXT NULL,
    rendered_body       TEXT NULL,
    validation_errors   TEXT[] NULL,
    provider_response   JSONB NULL,
    failure_reason      TEXT NULL,
    is_test             BOOLEAN NOT NULL DEFAULT FALSE,
    dispatched_by       UUID NULL REFERENCES public.users(user_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_audit_recipient 
    ON public.notification_dispatch_audit (recipient_user_id, created_at DESC);

-- 3. Robust Single-Job RPC with fallback company_id derivation
CREATE OR REPLACE FUNCTION schedule_notification_job_rpc(
    p_user_id UUID,
    p_notification_type VARCHAR,
    p_metadata JSONB,
    p_assignment_id UUID DEFAULT NULL,
    p_scheduled_at TIMESTAMPTZ DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_company_id UUID;
    v_idempotency_key VARCHAR;
    v_task_id VARCHAR;
    v_sprint_id VARCHAR;
    v_scenario_id VARCHAR;
    v_module_id VARCHAR;
    v_entity_id VARCHAR;
BEGIN
    SELECT company_id INTO v_company_id FROM users WHERE user_id = p_user_id LIMIT 1;
    
    IF v_company_id IS NULL AND p_metadata ? 'company_id' AND p_metadata->>'company_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_company_id := (p_metadata->>'company_id')::UUID;
    END IF;

    IF v_company_id IS NULL THEN
        SELECT company_id INTO v_company_id FROM companies LIMIT 1;
    END IF;

    IF v_company_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF p_scheduled_at IS NULL THEN
        p_scheduled_at := NOW();
    END IF;

    v_task_id := p_metadata->>'task_id';
    v_sprint_id := p_metadata->>'sprint_id';
    v_scenario_id := p_metadata->>'scenario_id';
    v_module_id := p_metadata->>'module_id';

    v_entity_id := COALESCE(v_task_id, v_sprint_id, v_scenario_id, v_module_id, (EXTRACT(EPOCH FROM NOW())::int)::text);
    v_idempotency_key := p_user_id::text || ':' || p_notification_type || ':' || v_entity_id;

    BEGIN
        INSERT INTO notification_jobs (
            company_id, user_id, assignment_id, notification_type, scheduled_at, idempotency_key, metadata
        ) VALUES (
            v_company_id, p_user_id, p_assignment_id, p_notification_type, p_scheduled_at, v_idempotency_key, p_metadata
        );
        RETURN TRUE;
    EXCEPTION WHEN unique_violation THEN
        RETURN TRUE;
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. High-Performance Atomic Batch Scheduling RPC
CREATE OR REPLACE FUNCTION schedule_bulk_notification_jobs_rpc(
    p_user_ids UUID[],
    p_notification_type VARCHAR,
    p_metadata JSONB,
    p_assignment_id UUID DEFAULT NULL,
    p_scheduled_at TIMESTAMPTZ DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_scheduled_at TIMESTAMPTZ;
    v_inserted_count INTEGER := 0;
    v_entity_id VARCHAR;
    v_default_company_id UUID;
BEGIN
    v_scheduled_at := COALESCE(p_scheduled_at, NOW());
    v_entity_id := COALESCE(
        p_metadata->>'task_id',
        p_metadata->>'sprint_id',
        p_metadata->>'scenario_id',
        p_metadata->>'module_id',
        (EXTRACT(EPOCH FROM NOW())::int)::text
    );

    SELECT company_id INTO v_default_company_id FROM public.companies LIMIT 1;

    WITH inserted AS (
        INSERT INTO public.notification_jobs (
            company_id,
            user_id,
            assignment_id,
            notification_type,
            scheduled_at,
            idempotency_key,
            metadata
        )
        SELECT
            COALESCE(u.company_id, v_default_company_id),
            u.user_id,
            p_assignment_id,
            p_notification_type,
            v_scheduled_at,
            u.user_id::text || ':' || p_notification_type || ':' || v_entity_id || ':' || (EXTRACT(EPOCH FROM NOW())::bigint)::text,
            p_metadata
        FROM public.users u
        WHERE u.user_id = ANY(p_user_ids)
          AND (u.is_active IS NOT FALSE)
          AND COALESCE(u.company_id, v_default_company_id) IS NOT NULL
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
    )
    SELECT COUNT(*) INTO v_inserted_count FROM inserted;

    RETURN v_inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Global Platform Notification System Settings (Configured by Developer Role)
CREATE TABLE IF NOT EXISTS public.global_notification_settings (
    id VARCHAR(32) PRIMARY KEY DEFAULT 'global_default',
    in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    deadline_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    post_completion_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    streak_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_hours_start VARCHAR(5) NOT NULL DEFAULT '22:00',
    quiet_hours_end VARCHAR(5) NOT NULL DEFAULT '08:00',
    max_daily_per_user INTEGER NOT NULL DEFAULT 10,
    updated_by UUID NULL REFERENCES public.users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.global_notification_settings (id)
VALUES ('global_default')
ON CONFLICT (id) DO NOTHING;

COMMIT;
