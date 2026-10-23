-- ============================================================================
-- Migration: 20261013_notification_versioning_and_reliability.sql
-- Description: Additive schema for immutable template and workflow versioning,
--              content fingerprinting, delivery fallback policy, and rollback.
-- ============================================================================

-- 1. Additive columns for notification_templates
ALTER TABLE public.notification_templates
  ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_notification_templates_hash
  ON public.notification_templates (content_hash);

-- 2. Immutable Template Versions table
CREATE TABLE IF NOT EXISTS public.notification_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.notification_templates(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  notification_type VARCHAR NOT NULL,
  channel VARCHAR NOT NULL,
  title_template TEXT,
  body_template TEXT NOT NULL,
  cta_label TEXT,
  content_hash VARCHAR(64) NOT NULL,
  published_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_template_version UNIQUE (template_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_template_versions_lookup
  ON public.notification_template_versions (template_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_template_versions_hash
  ON public.notification_template_versions (content_hash);

-- 3. Additive columns for notification_workflows
ALTER TABLE public.notification_workflows
  ADD COLUMN IF NOT EXISTS delivery_policy VARCHAR NOT NULL DEFAULT 'PARALLEL',
  ADD COLUMN IF NOT EXISTS pinned_template_id UUID,
  ADD COLUMN IF NOT EXISTS pinned_template_version_id UUID,
  ADD COLUMN IF NOT EXISTS version_number INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_fingerprint VARCHAR(64);

-- 4. Immutable Workflow Versions table
CREATE TABLE IF NOT EXISTS public.notification_workflow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.notification_workflows(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  trigger_lifecycle VARCHAR NOT NULL,
  category VARCHAR NOT NULL,
  filter_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  filter_match_type VARCHAR NOT NULL DEFAULT 'ALL',
  notification_type VARCHAR NOT NULL,
  channels TEXT[] NOT NULL DEFAULT ARRAY['IN_APP', 'PUSH']::text[],
  delivery_policy VARCHAR NOT NULL DEFAULT 'PARALLEL',
  pinned_template_id UUID,
  pinned_template_version_id UUID,
  title_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  cooldown_seconds INT NOT NULL DEFAULT 3600,
  priority VARCHAR NOT NULL DEFAULT 'NORMAL',
  content_fingerprint VARCHAR(64) NOT NULL,
  published_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workflow_version UNIQUE (workflow_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_lookup
  ON public.notification_workflow_versions (workflow_id, version_number DESC);

-- Enable RLS
ALTER TABLE public.notification_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_workflow_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read template versions"
  ON public.notification_template_versions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow service role manage template versions"
  ON public.notification_template_versions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated read workflow versions"
  ON public.notification_workflow_versions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow service role manage workflow versions"
  ON public.notification_workflow_versions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
