-- ============================================================================
-- Migration: 20261013_create_notification_workflows.sql
-- Description: Dynamic Event Trigger Workflows and Smart Personalization Variables.
--              1. Creates public.notification_workflows for no-code event triggers.
--              2. Seeds VARK, Gamification, Assessment, and Curriculum smart tags.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_workflows (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    trigger_lifecycle   VARCHAR(100) NOT NULL DEFAULT 'CUSTOM',
    category            VARCHAR(50) NOT NULL DEFAULT 'CUSTOM',
    filter_rules        JSONB NOT NULL DEFAULT '[]'::jsonb,
    filter_match_type   VARCHAR(10) NOT NULL DEFAULT 'ALL',
    notification_type   VARCHAR(100) NOT NULL DEFAULT 'CUSTOM_EVENT',
    channels            TEXT[] NOT NULL DEFAULT ARRAY['IN_APP', 'PUSH']::TEXT[],
    title_template      VARCHAR(255) NOT NULL DEFAULT '',
    body_template       TEXT NOT NULL DEFAULT '',
    cooldown_seconds    INT NOT NULL DEFAULT 3600,
    priority            VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          VARCHAR(255),
    company_id          UUID NULL,
    execution_count     INT NOT NULL DEFAULT 0,
    last_triggered_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_workflows_trigger ON public.notification_workflows(trigger_lifecycle, is_active);
CREATE INDEX IF NOT EXISTS idx_notification_workflows_company ON public.notification_workflows(company_id);

ALTER TABLE public.notification_workflows ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'notification_workflows' AND policyname = 'rls_notification_workflows_all'
    ) THEN 
        CREATE POLICY "rls_notification_workflows_all" 
        ON public.notification_workflows 
        FOR ALL TO public 
        USING (true) 
        WITH CHECK (true); 
    END IF; 
END $$;

COMMIT;
