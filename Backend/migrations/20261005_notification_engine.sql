-- ============================================================================
-- Migration: 20261005_notification_engine.sql
-- Description: Production-grade notification engine for Lucid platform.
--              Creates:
--                * notification_jobs         -- Scheduled/event-driven job registry
--                * notification_deliveries   -- Per-channel delivery audit log
--                * notification_preferences  -- Per-user channel/type opt-in settings
--                * notification_templates    -- Dynamic copy registry with multi-variation support
--                * whatsapp_templates        -- Meta HSM template registry with approval state
--                * module_feedback           -- CN-012 CSAT post-completion feedback
--              Applies RLS policies consistent with existing tenant isolation model.
--              All timestamps stored in UTC (TIMESTAMPTZ).
-- Project: Lucid (ref: fmkikkebrxyzjsffqgex)
-- Created: 2026-10-05
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. NOTIFICATION JOBS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_jobs (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID            NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    user_id             UUID            NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    assignment_id       UUID            NULL,
    notification_type   VARCHAR(64)     NOT NULL,
    scheduled_at        TIMESTAMPTZ     NOT NULL,
    status              VARCHAR(24)     NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','QUEUED','PROCESSING','SENT','FAILED','CANCELLED','SKIPPED')),
    attempts            INTEGER         NOT NULL DEFAULT 0,
    max_attempts        INTEGER         NOT NULL DEFAULT 5,
    locked_at           TIMESTAMPTZ     NULL,
    processed_at        TIMESTAMPTZ     NULL,
    cancelled_at        TIMESTAMPTZ     NULL,
    last_error          TEXT            NULL,
    idempotency_key     VARCHAR(255)    NOT NULL,
    metadata            JSONB           NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_jobs_idempotency_key_unique UNIQUE (idempotency_key)
);

COMMENT ON TABLE  public.notification_jobs IS 'Registry of all scheduled and event-driven notification jobs. PostgreSQL is source of truth; Redis is execution/queue layer only.';
COMMENT ON COLUMN public.notification_jobs.idempotency_key IS 'Deterministic key to prevent duplicate job creation. Example: "lp_uuid:DEADLINE_48H".';
COMMENT ON COLUMN public.notification_jobs.locked_at IS 'Set when an ARQ worker claims this job. Reconciliation detects stuck jobs (locked_at < NOW() - 10 min).';

CREATE INDEX IF NOT EXISTS idx_notification_jobs_status_scheduled
    ON public.notification_jobs (status, scheduled_at)
    WHERE status IN ('PENDING', 'QUEUED');

CREATE INDEX IF NOT EXISTS idx_notification_jobs_user_id
    ON public.notification_jobs (user_id, status);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_company_id
    ON public.notification_jobs (company_id, status);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_assignment_id
    ON public.notification_jobs (assignment_id)
    WHERE assignment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_jobs_processing_locked
    ON public.notification_jobs (locked_at)
    WHERE status = 'PROCESSING';

CREATE OR REPLACE FUNCTION public.touch_notification_jobs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_notification_jobs_updated_at ON public.notification_jobs;
CREATE TRIGGER trg_notification_jobs_updated_at
    BEFORE UPDATE ON public.notification_jobs
    FOR EACH ROW EXECUTE FUNCTION public.touch_notification_jobs_updated_at();


-- ============================================================================
-- 2. NOTIFICATION DELIVERIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_job_id     UUID        NOT NULL REFERENCES public.notification_jobs(id) ON DELETE CASCADE,
    company_id              UUID        NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    user_id                 UUID        NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    channel                 VARCHAR(24) NOT NULL
                                CHECK (channel IN ('IN_APP','PUSH','EMAIL','WHATSAPP')),
    provider                VARCHAR(32) NULL,
    provider_message_id     VARCHAR(255) NULL,
    status                  VARCHAR(24) NOT NULL DEFAULT 'SENT'
                                CHECK (status IN ('SENT','DELIVERED','FAILED','BLOCKED')),
    attempts                INTEGER     NOT NULL DEFAULT 1,
    error_code              VARCHAR(64) NULL,
    error_message           TEXT        NULL,
    blocked_reason          TEXT        NULL,
    sent_at                 TIMESTAMPTZ NULL,
    delivered_at            TIMESTAMPTZ NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.notification_deliveries IS 'Per-channel delivery audit log. Enables full traceability from job to provider.';
COMMENT ON COLUMN public.notification_deliveries.blocked_reason IS 'Populated when status=BLOCKED. Example: Meta WhatsApp template not approved.';

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_job_id
    ON public.notification_deliveries (notification_job_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user_id
    ON public.notification_deliveries (user_id, channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_company_id
    ON public.notification_deliveries (company_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_notification_deliveries_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_notification_deliveries_updated_at ON public.notification_deliveries;
CREATE TRIGGER trg_notification_deliveries_updated_at
    BEFORE UPDATE ON public.notification_deliveries
    FOR EACH ROW EXECUTE FUNCTION public.touch_notification_deliveries_updated_at();


-- ============================================================================
-- 3. NOTIFICATION PREFERENCES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    user_id                     UUID        PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
    push_enabled                BOOLEAN     NOT NULL DEFAULT TRUE,
    email_enabled               BOOLEAN     NOT NULL DEFAULT TRUE,
    in_app_enabled              BOOLEAN     NOT NULL DEFAULT TRUE,
    whatsapp_enabled            BOOLEAN     NOT NULL DEFAULT TRUE,
    deadline_reminders_enabled  BOOLEAN     NOT NULL DEFAULT TRUE,
    post_completion_enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    streak_notifications_enabled BOOLEAN   NOT NULL DEFAULT TRUE,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.notification_preferences IS 'Per-user channel and notification-type opt-in settings. Checked by workers at execution time.';

CREATE OR REPLACE FUNCTION public.create_default_notification_preferences()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.notification_preferences (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_create_notification_prefs ON public.users;
CREATE TRIGGER trg_users_create_notification_prefs
    AFTER INSERT ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.create_default_notification_preferences();

INSERT INTO public.notification_preferences (user_id)
SELECT user_id FROM public.users
ON CONFLICT (user_id) DO NOTHING;


-- ============================================================================
-- 4. NOTIFICATION TEMPLATES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_templates (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_type   VARCHAR(64) NOT NULL,
    channel             VARCHAR(24) NOT NULL
                            CHECK (channel IN ('IN_APP','PUSH','EMAIL','WHATSAPP','ALL')),
    variation_index     SMALLINT    NOT NULL DEFAULT 0,
    title_template      TEXT        NULL,
    body_template       TEXT        NOT NULL,
    cta_label           TEXT        NULL,
    language            VARCHAR(8)  NOT NULL DEFAULT 'en',
    version             INTEGER     NOT NULL DEFAULT 1,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_templates_type_channel_variation_lang_version_unique
        UNIQUE (notification_type, channel, variation_index, language, version)
);

COMMENT ON TABLE public.notification_templates IS 'Dynamic copy registry. Workers pick a random variation_index for multi-variation types.';

CREATE INDEX IF NOT EXISTS idx_notification_templates_type_channel
    ON public.notification_templates (notification_type, channel, is_active);

CREATE OR REPLACE FUNCTION public.touch_notification_templates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_notification_templates_updated_at ON public.notification_templates;
CREATE TRIGGER trg_notification_templates_updated_at
    BEFORE UPDATE ON public.notification_templates
    FOR EACH ROW EXECUTE FUNCTION public.touch_notification_templates_updated_at();


-- ============================================================================
-- 5. WHATSAPP TEMPLATES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                VARCHAR(64) NOT NULL UNIQUE,
    meta_template_name  VARCHAR(255) NOT NULL,
    language            VARCHAR(8)  NOT NULL DEFAULT 'en',
    version             INTEGER     NOT NULL DEFAULT 1,
    parameter_schema    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    is_approved         BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN     NOT NULL DEFAULT FALSE,
    approved_at         TIMESTAMPTZ NULL,
    notes               TEXT        NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.whatsapp_templates IS 'Meta WhatsApp HSM template registry. Workers must validate is_approved AND is_active before sending.';
COMMENT ON COLUMN public.whatsapp_templates.parameter_schema IS 'Ordered array of parameter definitions. Example: [{"name":"first_name","token":"{{first_name}}"}]';

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_slug
    ON public.whatsapp_templates (slug, is_approved, is_active);

CREATE OR REPLACE FUNCTION public.touch_whatsapp_templates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_templates_updated_at ON public.whatsapp_templates;
CREATE TRIGGER trg_whatsapp_templates_updated_at
    BEFORE UPDATE ON public.whatsapp_templates
    FOR EACH ROW EXECUTE FUNCTION public.touch_whatsapp_templates_updated_at();


-- ============================================================================
-- 6. MODULE FEEDBACK (CN-012)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.module_feedback (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              UUID        NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    user_id                 UUID        NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    assignment_id           UUID        NULL,
    module_id               VARCHAR(255) NOT NULL,
    completion_event_id     VARCHAR(255) NOT NULL,
    rating                  SMALLINT    NULL CHECK (rating BETWEEN 1 AND 5),
    feedback_tags           TEXT[]      NOT NULL DEFAULT '{}',
    comment                 TEXT        NULL,
    status                  VARCHAR(24) NOT NULL DEFAULT 'PENDING'
                                CHECK (status IN ('PENDING','SUBMITTED','DISMISSED')),
    submitted_at            TIMESTAMPTZ NULL,
    dismissed_at            TIMESTAMPTZ NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT module_feedback_completion_event_unique UNIQUE (completion_event_id)
);

COMMENT ON TABLE  public.module_feedback IS 'CN-012 CSAT post-completion feedback. completion_event_id enforces one-feedback-per-completion idempotency.';
COMMENT ON COLUMN public.module_feedback.completion_event_id IS 'Deterministic idempotency key. Format: "<learning_plan_id>:<completed_at_utc_iso>".';

CREATE INDEX IF NOT EXISTS idx_module_feedback_user_id
    ON public.module_feedback (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_module_feedback_company_id
    ON public.module_feedback (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_module_feedback_module_id
    ON public.module_feedback (module_id);

CREATE OR REPLACE FUNCTION public.touch_module_feedback_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_module_feedback_updated_at ON public.module_feedback;
CREATE TRIGGER trg_module_feedback_updated_at
    BEFORE UPDATE ON public.module_feedback
    FOR EACH ROW EXECUTE FUNCTION public.touch_module_feedback_updated_at();


-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_jobs_user_select" ON public.notification_jobs;
CREATE POLICY "notification_jobs_user_select" ON public.notification_jobs FOR SELECT
    USING (user_id = public.current_app_user_id());

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_deliveries_user_select" ON public.notification_deliveries;
CREATE POLICY "notification_deliveries_user_select" ON public.notification_deliveries FOR SELECT
    USING (user_id = public.current_app_user_id());

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_preferences_user_select" ON public.notification_preferences;
CREATE POLICY "notification_preferences_user_select" ON public.notification_preferences FOR SELECT
    USING (user_id = public.current_app_user_id());
DROP POLICY IF EXISTS "notification_preferences_user_update" ON public.notification_preferences;
CREATE POLICY "notification_preferences_user_update" ON public.notification_preferences FOR UPDATE
    USING (user_id = public.current_app_user_id());

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_templates_authenticated_select" ON public.notification_templates;
CREATE POLICY "notification_templates_authenticated_select" ON public.notification_templates FOR SELECT
    TO authenticated USING (is_active = TRUE);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_templates_authenticated_select" ON public.whatsapp_templates;
CREATE POLICY "whatsapp_templates_authenticated_select" ON public.whatsapp_templates FOR SELECT
    TO authenticated USING (TRUE);

ALTER TABLE public.module_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "module_feedback_user_select" ON public.module_feedback;
CREATE POLICY "module_feedback_user_select" ON public.module_feedback FOR SELECT
    USING (user_id = public.current_app_user_id());
DROP POLICY IF EXISTS "module_feedback_user_insert" ON public.module_feedback;
CREATE POLICY "module_feedback_user_insert" ON public.module_feedback FOR INSERT
    WITH CHECK (user_id = public.current_app_user_id());
DROP POLICY IF EXISTS "module_feedback_user_update" ON public.module_feedback;
CREATE POLICY "module_feedback_user_update" ON public.module_feedback FOR UPDATE
    USING (user_id = public.current_app_user_id());


-- ============================================================================
-- 8. SEED: NOTIFICATION TEMPLATES (Sheet 2 copy variations)
-- ============================================================================

-- MODULE_ASSIGNED (CN-001)
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES ('MODULE_ASSIGNED', 'ALL', 0, 'New module just dropped', 'Hey {{first_name}}, new module just dropped {{module_name}} is waiting for you. No pressure except the {{due_date}} part.', 'Start Learning')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- REENGAGEMENT (Continue Learning / Re-engagement)
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES
    ('REENGAGEMENT', 'ALL', 0, 'You left something behind', '{{first_name}}, remember this? You left {{module_name}} at {{progress}}%. It has been waiting patiently. Unlike us.', 'Continue Learning'),
    ('REENGAGEMENT', 'ALL', 1, 'We miss you', 'Hey {{first_name}} remember us? {{module_name}} is still sitting at {{progress}}%. We are not saying you ghosted us, but you kinda ghosted us.', 'Pick Up Where You Left Off'),
    ('REENGAGEMENT', 'ALL', 2, 'Come finish what you started', 'We miss you, {{first_name}}. Your {{progress}}% completed {{module_name}} misses you too. Come finish what you started.', 'Continue Now')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- DEADLINE_48H (CN-008)
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES
    ('DEADLINE_48H', 'ALL', 0, 'Deadline in 48 hours', 'Hey {{first_name}}, tiny reminder before we get dramatic. {{module_name}} is due in {{time_remaining}}. You are already {{progress}}% done. Might as well finish it.', 'Start Now'),
    ('DEADLINE_48H', 'ALL', 1, 'Deadline approaching fast', '{{first_name}}, your deadline is approaching faster than your motivation. {{module_name}} is due in {{time_remaining}}. You are {{progress}}% done. Finish the job.', 'Finish Now')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- DEADLINE_24H (CN-009)
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES
    ('DEADLINE_24H', 'ALL', 0, 'Final 24 hours', 'Hey {{first_name}}, tiny reminder before we get dramatic. {{module_name}} is due in {{time_remaining}}. You are {{progress}}% done. Might as well finish it.', 'Complete Now'),
    ('DEADLINE_24H', 'ALL', 1, 'Last chance due today', '{{first_name}}, your deadline is approaching faster than your motivation. {{module_name}} is due in {{time_remaining}}. You are {{progress}}% done. Now or never.', 'Complete Now')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- DEADLINE_MISSED (CN-010)
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES
    ('DEADLINE_MISSED', 'ALL', 0, 'About that deadline', 'Sooo about that deadline, {{first_name}}. {{module_name}} was due on {{due_date}}. We are not judging. Much.', 'Complete Now'),
    ('DEADLINE_MISSED', 'ALL', 1, 'The deadline came and went', 'The deadline came. The deadline went. {{module_name}} is still waiting for you, {{first_name}}. Maybe today is the day?', 'Complete Now')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- MODULE_COMPLETED (CN-004)
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES
    ('MODULE_COMPLETED', 'ALL', 0, 'Module complete!', 'Look who actually finished something! Nice one, {{first_name}}. {{module_name}} is officially done with a {{score}}% score. Go ahead, take the win.', 'View Certificate'),
    ('MODULE_COMPLETED', 'ALL', 1, 'Plot twist: You finished it', 'Plot twist: You actually finished it. Nice work, {{first_name}}! {{module_name}} is officially complete with {{score}}%.', 'View Certificate'),
    ('MODULE_COMPLETED', 'ALL', 2, 'Look who finished!', 'Look who actually finished something!', 'View Certificate')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- QUIZ_PASSED (CN-005) and QUIZ_FAILED (CN-006)
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES
    ('QUIZ_PASSED', 'ALL', 0, 'Quiz results in!', '{{first_name}}, the results are in. You scored {{score}}% on {{assessment_name}}. {{result_message}} Not bad. Not bad at all.', 'Continue to Next'),
    ('QUIZ_FAILED', 'ALL', 0, 'Quiz results in retry available', '{{first_name}}, the results are in. You scored {{score}}% on {{assessment_name}}. {{result_message}} You have got another shot. Make it count.', 'Retry Quiz')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- STREAK_MILESTONE (CN-007)
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES
    ('STREAK_MILESTONE', 'ALL', 0, '{{streak_days}}-day streak!', '{{streak_days}} days. Zero excuses. {{first_name}}, you are on a {{streak_days}}-day streak. Do not break it now. We would hate to see all that drama for nothing.', 'Share Achievement'),
    ('STREAK_MILESTONE', 'ALL', 1, '{{first_name}} is on a roll!', 'Breaking news: {{first_name}} is on a roll. {{streak_days}} days of learning and counting. Please continue before we have to make this emotional.', 'Keep Going')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- MILESTONE_MODULES
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES ('MILESTONE_MODULES', 'ALL', 0, '{{completed_count}} modules done!', 'Okay {{first_name}}, we see you. You have completed {{completed_count}} modules. At this rate, you might actually become the person who finishes their learning goals.', 'Keep Learning')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- RECOMMENDED_CONTENT
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES ('RECOMMENDED_CONTENT', 'ALL', 0, 'We found something for you', 'We have been watching your learning choices, {{first_name}}. And we found something you might actually like: {{content_name}}. Give it a shot. We have a feeling.', 'Explore Now')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- CERTIFICATE_ISSUED (CN-011)
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES ('CERTIFICATE_ISSUED', 'ALL', 0, 'Your certificate is ready!', 'Congratulations, {{first_name}}! You have completed the full learning path for {{module_name}}. Your certificate is ready to download.', 'Download Certificate')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;

-- POST_COMPLETION_FEEDBACK (CN-012)
INSERT INTO public.notification_templates (notification_type, channel, variation_index, title_template, body_template, cta_label)
VALUES ('POST_COMPLETION_FEEDBACK', 'IN_APP', 0, 'Module Completed', 'How was {{module_name}}? Your feedback helps us make Lucid better for you.', 'Give Feedback')
ON CONFLICT (notification_type, channel, variation_index, language, version) DO NOTHING;


-- ============================================================================
-- 9. SEED: WHATSAPP TEMPLATES
--    is_approved=FALSE by default. Product must submit to Meta Business Manager.
-- ============================================================================
INSERT INTO public.whatsapp_templates (slug, meta_template_name, language, parameter_schema, notes)
VALUES
    ('module_assigned', 'lucid_module_assigned', 'en',
     '[{"name":"first_name","token":"{{first_name}}"},{"name":"module_name","token":"{{module_name}}"},{"name":"due_date","token":"{{due_date}}"}]'::jsonb,
     'CN-001: Submit to Meta for approval before going live.'),
    ('due_reminder_48h', 'lucid_due_reminder_48h', 'en',
     '[{"name":"first_name","token":"{{first_name}}"},{"name":"module_name","token":"{{module_name}}"},{"name":"time_remaining","token":"{{time_remaining}}"},{"name":"progress","token":"{{progress}}"}]'::jsonb,
     'CN-008: 48-hour deadline reminder.'),
    ('due_reminder_24h', 'lucid_due_reminder_24h', 'en',
     '[{"name":"first_name","token":"{{first_name}}"},{"name":"module_name","token":"{{module_name}}"},{"name":"time_remaining","token":"{{time_remaining}}"},{"name":"progress","token":"{{progress}}"}]'::jsonb,
     'CN-009: 24-hour deadline reminder.'),
    ('deadline_missed', 'lucid_deadline_missed', 'en',
     '[{"name":"first_name","token":"{{first_name}}"},{"name":"module_name","token":"{{module_name}}"},{"name":"due_date","token":"{{due_date}}"}]'::jsonb,
     'CN-010: Missed deadline notification.'),
    ('welcome_to_lucid', 'lucid_welcome', 'en',
     '[{"name":"first_name","token":"{{first_name}}"},{"name":"company_name","token":"{{company_name}}"},{"name":"login_url","token":"{{login_url}}"}]'::jsonb,
     'CN-002: Welcome notification for new learner accounts.')
ON CONFLICT (slug) DO NOTHING;


COMMIT;
