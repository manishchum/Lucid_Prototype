-- ============================================================================
-- 20261012_notification_contracts_and_governance.sql
-- Migration: Dynamic Event Matrix, Contract Schemas, and Dead-Letter Queue (DLQ)
-- ============================================================================

-- 1. Upgrade notification_event_presets
ALTER TABLE public.notification_event_presets
    ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'DEFAULT'
        CHECK (priority IN ('CRITICAL', 'HIGH', 'DEFAULT', 'LOW')),
    ADD COLUMN IF NOT EXISTS quiet_hours_bypass BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS throttle_window_seconds INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS parameter_schema JSONB NOT NULL DEFAULT '{
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "required": [],
        "properties": {}
    }'::jsonb,
    ADD COLUMN IF NOT EXISTS metadata_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.notification_event_presets.is_enabled IS 'Global master switch for this specific event preset.';
COMMENT ON COLUMN public.notification_event_presets.priority IS 'Execution priority: CRITICAL, HIGH, DEFAULT, LOW.';
COMMENT ON COLUMN public.notification_event_presets.quiet_hours_bypass IS 'If TRUE, critical notifications under this event bypass quiet hours.';
COMMENT ON COLUMN public.notification_event_presets.parameter_schema IS 'JSON Schema contract defining required parameters, types, and validation rules.';

-- 2. Upgrade global_notification_settings
ALTER TABLE public.global_notification_settings
    ADD COLUMN IF NOT EXISTS disabled_event_keys TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS event_policies JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Upgrade notification_jobs for DLQ and Failure Categorization
ALTER TABLE public.notification_jobs
    ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS failure_category VARCHAR(32) NULL
        CHECK (failure_category IN (
            'PERMANENT_SCHEMA_VIOLATION',
            'PERMANENT_TEMPLATE_ERROR',
            'CHANNEL_CONSTRAINT_VIOLATION',
            'TRANSIENT_NETWORK_ERROR',
            'TRANSIENT_PROVIDER_RATE_LIMIT'
        )),
    ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_notification_jobs_dlq
    ON public.notification_jobs (dead_lettered_at)
    WHERE dead_lettered_at IS NOT NULL;
