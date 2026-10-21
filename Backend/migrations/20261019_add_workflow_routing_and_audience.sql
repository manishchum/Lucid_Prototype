-- ============================================================================
-- Migration: 20261019_add_workflow_routing_and_audience.sql
-- Description: Adds recipient_routing ('LEARNER', 'MANAGER', 'BOTH') and
--              audience_filter JSONB (departments, roles, module_ids) to workflows.
-- ============================================================================

BEGIN;

ALTER TABLE public.notification_workflows 
ADD COLUMN IF NOT EXISTS recipient_routing VARCHAR(20) NOT NULL DEFAULT 'LEARNER',
ADD COLUMN IF NOT EXISTS audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.notification_workflow_versions 
ADD COLUMN IF NOT EXISTS recipient_routing VARCHAR(20) NOT NULL DEFAULT 'LEARNER',
ADD COLUMN IF NOT EXISTS audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
