-- ============================================================================
-- Migration: 20261015_clean_notification_redesign.sql
-- Description: Database alignment for unified notification system:
--              1. notification_templates: adds cta_url, fallback_defaults, template_name, ensures channel defaults to 'ALL'.
--              2. notification_workflows: adds rule_mode, secondary_template_id, secondary copy fields.
--              3. notification_dispatch_audit: adds suppression_reason, latency_ms.
-- ============================================================================

BEGIN;

-- 1. notification_templates enhancements
ALTER TABLE public.notification_templates 
    ADD COLUMN IF NOT EXISTS template_name VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS cta_url TEXT NULL,
    ADD COLUMN IF NOT EXISTS fallback_defaults JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.notification_templates 
    ALTER COLUMN channel SET DEFAULT 'ALL';

-- 2. notification_workflows enhancements
ALTER TABLE public.notification_workflows
    ADD COLUMN IF NOT EXISTS rule_mode VARCHAR(30) NOT NULL DEFAULT 'THRESHOLD',
    ADD COLUMN IF NOT EXISTS secondary_template_id UUID NULL REFERENCES public.notification_templates(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS secondary_title_template TEXT NULL,
    ADD COLUMN IF NOT EXISTS secondary_body_template TEXT NULL;

-- 3. notification_dispatch_audit enhancements
ALTER TABLE public.notification_dispatch_audit
    ADD COLUMN IF NOT EXISTS suppression_reason TEXT NULL,
    ADD COLUMN IF NOT EXISTS latency_ms INTEGER NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_dispatch_audit_status ON public.notification_dispatch_audit(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_audit_notification_type ON public.notification_dispatch_audit(notification_type, created_at DESC);

COMMIT;
