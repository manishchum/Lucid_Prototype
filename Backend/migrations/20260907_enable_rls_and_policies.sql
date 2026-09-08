-- ============================================================================
-- Migration: 20260907_enable_rls_and_policies.sql
-- Description: Enable Row Level Security (RLS) & establish tenant isolation
--              and role-based access policies across all public tables.
-- Source Project: Lucid_Prototype (ref: plsvmunofikmedewbved)
-- Generated: 2026-09-07
-- Total Tables: 70 | Total Policies: 153
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. SECURITY DEFINER HELPER FUNCTIONS
-- ============================================================================

-- Function: current_app_user_id()
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    auth.uid(),
    (
      SELECT nullif(
        COALESCE(
          current_setting('request.headers', true)::json ->> 'x-user-id',
          current_setting('request.headers', true)::json ->> 'X-User-ID'
        ),
        ''
      )::uuid
    ),
    (
      SELECT u.user_id
      FROM public.users u
      WHERE lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      LIMIT 1
    )
  );
$function$;

-- Function: current_app_company_id()
CREATE OR REPLACE FUNCTION public.current_app_company_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT nullif(
        COALESCE(
          current_setting('request.headers', true)::json ->> 'x-company-id',
          current_setting('request.headers', true)::json ->> 'X-Company-ID'
        ),
        ''
      )::uuid
    ),
    (
      SELECT u.company_id
      FROM public.users u
      WHERE u.user_id = public.current_app_user_id()
      LIMIT 1
    )
  );
$function$;

-- Function: is_super_admin()
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_role_assignments ura
    JOIN public.roles r ON r.role_id = ura.role_id
    WHERE ura.user_id = public.current_app_user_id()
      AND ura.is_active = true
      AND (ura.expires_at IS NULL OR ura.expires_at > now())
      AND r.name IN ('SUPER_ADMIN', 'DEVELOPER')
  );
$function$;

-- Function: is_company_admin(target_company_id uuid)
CREATE OR REPLACE FUNCTION public.is_company_admin(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_role_assignments ura
    JOIN public.roles r ON r.role_id = ura.role_id
    WHERE ura.user_id = public.current_app_user_id()
      AND ura.is_active = true
      AND (ura.expires_at IS NULL OR ura.expires_at > now())
      AND (
        (ura.scope_type = 'COMPANY' AND ura.scope_id = target_company_id)
        OR r.name IN ('SUPER_ADMIN', 'DEVELOPER')
      )
      AND r.name IN ('CEO', 'SUPER_ADMIN', 'ADMIN', 'DEVELOPER')
  );
$function$;

-- Function: can_access_company(target_company_id uuid)
CREATE OR REPLACE FUNCTION public.can_access_company(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (
    target_company_id = public.current_app_company_id()
    OR public.is_company_admin(target_company_id)
    OR public.is_super_admin()
  );
$function$;

-- Function: can_access_user(target_user_id uuid)
CREATE OR REPLACE FUNCTION public.can_access_user(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.user_id = target_user_id
      AND (
        u.user_id = public.current_app_user_id()
        OR public.can_access_company(u.company_id)
      )
  );
$function$;

-- Function: company_id_for_module(target_module_id uuid)
CREATE OR REPLACE FUNCTION public.company_id_for_module(target_module_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT tm.company_id
  FROM public.training_modules tm
  WHERE tm.module_id = target_module_id
  LIMIT 1;
$function$;

-- Function: company_id_for_processed_module(target_processed_module_id uuid)
CREATE OR REPLACE FUNCTION public.company_id_for_processed_module(target_processed_module_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT tm.company_id
  FROM public.processed_modules pm
  JOIN public.training_modules tm ON tm.module_id = pm.original_module_id
  WHERE pm.processed_module_id = target_processed_module_id
  LIMIT 1;
$function$;

-- Function: company_id_for_assessment(target_assessment_id uuid)
CREATE OR REPLACE FUNCTION public.company_id_for_assessment(target_assessment_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT a.company_id
  FROM public.assessments a
  WHERE a.assessment_id = target_assessment_id
  LIMIT 1;
$function$;

-- Function: company_id_for_lucid_tool_job(target_job_id uuid)
CREATE OR REPLACE FUNCTION public.company_id_for_lucid_tool_job(target_job_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT j.company_id
  FROM public.lucid_tool_jobs j
  WHERE j.id = target_job_id
  LIMIT 1;
$function$;

-- Function: can_access_training_module(target_module_id uuid)
CREATE OR REPLACE FUNCTION public.can_access_training_module(target_module_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_access_company(public.company_id_for_module(target_module_id));
$function$;

-- Function: can_access_processed_module(target_processed_module_id uuid)
CREATE OR REPLACE FUNCTION public.can_access_processed_module(target_processed_module_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_access_company(public.company_id_for_processed_module(target_processed_module_id));
$function$;

-- Function: set_company_context(p_company_id uuid, p_user_id uuid, p_user_role text)
CREATE OR REPLACE FUNCTION public.set_company_context(p_company_id uuid, p_user_id uuid, p_user_role text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM set_config('app.company_id', p_company_id::text, true);  -- true = transaction-scoped
  PERFORM set_config('app.user_id',    p_user_id::text,    true);
  PERFORM set_config('app.user_role',  p_user_role,        true);
END;
$function$;

-- ============================================================================
-- 2. ENABLE RLS & CREATE POLICIES ACROSS ALL PUBLIC TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: public.ai_features
-- ----------------------------------------------------------------------------
ALTER TABLE public.ai_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_ai_features_select" ON public.ai_features;
CREATE POLICY rls_ai_features_select ON public.ai_features AS PERMISSIVE FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "rls_ai_features_write" ON public.ai_features;
CREATE POLICY rls_ai_features_write ON public.ai_features AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ----------------------------------------------------------------------------
-- Table: public.ai_model_configs
-- ----------------------------------------------------------------------------
ALTER TABLE public.ai_model_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_ai_model_configs_select" ON public.ai_model_configs;
CREATE POLICY rls_ai_model_configs_select ON public.ai_model_configs AS PERMISSIVE FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "rls_ai_model_configs_write" ON public.ai_model_configs;
CREATE POLICY rls_ai_model_configs_write ON public.ai_model_configs AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ----------------------------------------------------------------------------
-- Table: public.ai_prompts
-- ----------------------------------------------------------------------------
ALTER TABLE public.ai_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_ai_prompts_select" ON public.ai_prompts;
CREATE POLICY rls_ai_prompts_select ON public.ai_prompts AS PERMISSIVE FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "rls_ai_prompts_write" ON public.ai_prompts;
CREATE POLICY rls_ai_prompts_write ON public.ai_prompts AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ----------------------------------------------------------------------------
-- Table: public.ai_provider_config
-- ----------------------------------------------------------------------------
ALTER TABLE public.ai_provider_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_ai_provider_config_select" ON public.ai_provider_config;
CREATE POLICY rls_ai_provider_config_select ON public.ai_provider_config AS PERMISSIVE FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "rls_ai_provider_config_write" ON public.ai_provider_config;
CREATE POLICY rls_ai_provider_config_write ON public.ai_provider_config AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ----------------------------------------------------------------------------
-- Table: public.ai_usage_logs
-- ----------------------------------------------------------------------------
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_ai_usage_logs_delete" ON public.ai_usage_logs;
CREATE POLICY rls_ai_usage_logs_delete ON public.ai_usage_logs AS PERMISSIVE FOR DELETE TO public USING (is_super_admin());
DROP POLICY IF EXISTS "rls_ai_usage_logs_insert" ON public.ai_usage_logs;
CREATE POLICY rls_ai_usage_logs_insert ON public.ai_usage_logs AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
DROP POLICY IF EXISTS "rls_ai_usage_logs_modify" ON public.ai_usage_logs;
CREATE POLICY rls_ai_usage_logs_modify ON public.ai_usage_logs AS PERMISSIVE FOR UPDATE TO public USING (is_super_admin()) WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "rls_ai_usage_logs_select" ON public.ai_usage_logs;
CREATE POLICY rls_ai_usage_logs_select ON public.ai_usage_logs AS PERMISSIVE FOR SELECT TO public USING (((user_id = current_app_user_id()) OR ((company_id IS NOT NULL) AND can_access_company(company_id)) OR is_super_admin()));

-- ----------------------------------------------------------------------------
-- Table: public.assessments
-- ----------------------------------------------------------------------------
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_assessments_select" ON public.assessments;
CREATE POLICY rls_assessments_select ON public.assessments AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_assessments_write" ON public.assessments;
CREATE POLICY rls_assessments_write ON public.assessments AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.audio_analysis_reports
-- ----------------------------------------------------------------------------
-- ALTER TABLE public.audio_analysis_reports ENABLE ROW LEVEL SECURITY;

-- DROP POLICY IF EXISTS "rls_audio_analysis_reports_select" ON public.audio_analysis_reports;
-- CREATE POLICY rls_audio_analysis_reports_select ON public.audio_analysis_reports AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id))));
-- DROP POLICY IF EXISTS "rls_audio_analysis_reports_write" ON public.audio_analysis_reports;
-- CREATE POLICY rls_audio_analysis_reports_write ON public.audio_analysis_reports AS PERMISSIVE FOR ALL TO public USING ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id)))) WITH CHECK ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id))));

-- ----------------------------------------------------------------------------
-- Table: public.career_journeys
-- ----------------------------------------------------------------------------
ALTER TABLE public.career_journeys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_career_journeys_select" ON public.career_journeys;
CREATE POLICY rls_career_journeys_select ON public.career_journeys AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_career_journeys_write" ON public.career_journeys;
CREATE POLICY rls_career_journeys_write ON public.career_journeys AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.categories
-- ----------------------------------------------------------------------------
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_categories_admin_write" ON public.categories;
CREATE POLICY rls_categories_admin_write ON public.categories AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "rls_categories_public_read" ON public.categories;
CREATE POLICY rls_categories_public_read ON public.categories AS PERMISSIVE FOR SELECT TO public USING (true);

-- ----------------------------------------------------------------------------
-- Table: public.chatbot_user_interactions
-- ----------------------------------------------------------------------------
ALTER TABLE public.chatbot_user_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_chatbot_user_interactions_select" ON public.chatbot_user_interactions;
CREATE POLICY rls_chatbot_user_interactions_select ON public.chatbot_user_interactions AS PERMISSIVE FOR SELECT TO public USING (can_access_user(user_id));
DROP POLICY IF EXISTS "rls_chatbot_user_interactions_write" ON public.chatbot_user_interactions;
CREATE POLICY rls_chatbot_user_interactions_write ON public.chatbot_user_interactions AS PERMISSIVE FOR ALL TO public USING (can_access_user(user_id)) WITH CHECK (can_access_user(user_id));

-- ----------------------------------------------------------------------------
-- Table: public.child_task_submissions
-- ----------------------------------------------------------------------------
ALTER TABLE public.child_task_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_child_task_submissions_select" ON public.child_task_submissions;
CREATE POLICY rls_child_task_submissions_select ON public.child_task_submissions AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR can_access_company(company_id)));
DROP POLICY IF EXISTS "rls_child_task_submissions_write" ON public.child_task_submissions;
CREATE POLICY rls_child_task_submissions_write ON public.child_task_submissions AS PERMISSIVE FOR ALL TO public USING ((can_access_user(user_id) OR can_access_company(company_id))) WITH CHECK ((can_access_user(user_id) OR can_access_company(company_id)));

-- ----------------------------------------------------------------------------
-- Table: public.child_tasks
-- ----------------------------------------------------------------------------
ALTER TABLE public.child_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_child_tasks_select" ON public.child_tasks;
CREATE POLICY rls_child_tasks_select ON public.child_tasks AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_child_tasks_write" ON public.child_tasks;
CREATE POLICY rls_child_tasks_write ON public.child_tasks AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.companies
-- ----------------------------------------------------------------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_companies_select" ON public.companies;
CREATE POLICY rls_companies_select ON public.companies AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_companies_write" ON public.companies;
CREATE POLICY rls_companies_write ON public.companies AS PERMISSIVE FOR ALL TO public USING ((is_company_admin(company_id) OR is_super_admin())) WITH CHECK ((is_company_admin(company_id) OR is_super_admin()));

-- ----------------------------------------------------------------------------
-- Table: public.content_categories
-- ----------------------------------------------------------------------------
ALTER TABLE public.content_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_content_categories_select" ON public.content_categories;
CREATE POLICY rls_content_categories_select ON public.content_categories AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_content_categories_write" ON public.content_categories;
CREATE POLICY rls_content_categories_write ON public.content_categories AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.content_generation_history
-- ----------------------------------------------------------------------------
ALTER TABLE public.content_generation_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_content_generation_history_select" ON public.content_generation_history;
CREATE POLICY rls_content_generation_history_select ON public.content_generation_history AS PERMISSIVE FOR SELECT TO public USING ((can_access_training_module(original_module_id) OR can_access_processed_module(processed_module_id)));
DROP POLICY IF EXISTS "rls_content_generation_history_write" ON public.content_generation_history;
CREATE POLICY rls_content_generation_history_write ON public.content_generation_history AS PERMISSIVE FOR ALL TO public USING (can_access_training_module(original_module_id)) WITH CHECK (can_access_training_module(original_module_id));

-- ----------------------------------------------------------------------------
-- Table: public.content_jobs
-- ----------------------------------------------------------------------------
ALTER TABLE public.content_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_content_jobs_select" ON public.content_jobs;
CREATE POLICY rls_content_jobs_select ON public.content_jobs AS PERMISSIVE FOR SELECT TO public USING (can_access_training_module(module_id));
DROP POLICY IF EXISTS "rls_content_jobs_write" ON public.content_jobs;
CREATE POLICY rls_content_jobs_write ON public.content_jobs AS PERMISSIVE FOR ALL TO public USING (can_access_training_module(module_id)) WITH CHECK (can_access_training_module(module_id));

-- ----------------------------------------------------------------------------
-- Table: public.content_library_items
-- ----------------------------------------------------------------------------
ALTER TABLE public.content_library_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_content_library_items_select" ON public.content_library_items;
CREATE POLICY rls_content_library_items_select ON public.content_library_items AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_content_library_items_write" ON public.content_library_items;
CREATE POLICY rls_content_library_items_write ON public.content_library_items AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.courses
-- ----------------------------------------------------------------------------
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_courses_admin_write" ON public.courses;
CREATE POLICY rls_courses_admin_write ON public.courses AS PERMISSIVE FOR ALL TO public USING ((is_company_admin(current_app_company_id()) OR is_super_admin())) WITH CHECK ((is_company_admin(current_app_company_id()) OR is_super_admin()));
DROP POLICY IF EXISTS "rls_courses_public_read" ON public.courses;
CREATE POLICY rls_courses_public_read ON public.courses AS PERMISSIVE FOR SELECT TO public USING (true);

-- ----------------------------------------------------------------------------
-- Table: public.email_dispatch_log
-- ----------------------------------------------------------------------------
ALTER TABLE public.email_dispatch_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_email_dispatch_log_select" ON public.email_dispatch_log;
CREATE POLICY rls_email_dispatch_log_select ON public.email_dispatch_log AS PERMISSIVE FOR SELECT TO public USING (can_access_user(user_id));
DROP POLICY IF EXISTS "rls_email_dispatch_log_write" ON public.email_dispatch_log;
CREATE POLICY rls_email_dispatch_log_write ON public.email_dispatch_log AS PERMISSIVE FOR ALL TO public USING (can_access_user(user_id)) WITH CHECK (can_access_user(user_id));

-- ----------------------------------------------------------------------------
-- Table: public.employee_assessments
-- ----------------------------------------------------------------------------
ALTER TABLE public.employee_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_employee_assessments_select" ON public.employee_assessments;
CREATE POLICY rls_employee_assessments_select ON public.employee_assessments AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR ((assessment_id IS NOT NULL) AND can_access_company(company_id_for_assessment(assessment_id)))));
DROP POLICY IF EXISTS "rls_employee_assessments_write" ON public.employee_assessments;
CREATE POLICY rls_employee_assessments_write ON public.employee_assessments AS PERMISSIVE FOR ALL TO public USING (can_access_user(user_id)) WITH CHECK (can_access_user(user_id));

-- ----------------------------------------------------------------------------
-- Table: public.employee_kpi
-- ----------------------------------------------------------------------------
ALTER TABLE public.employee_kpi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_employee_kpi_select" ON public.employee_kpi;
CREATE POLICY rls_employee_kpi_select ON public.employee_kpi AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_employee_kpi_write" ON public.employee_kpi;
CREATE POLICY rls_employee_kpi_write ON public.employee_kpi AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.employee_kpi_history
-- ----------------------------------------------------------------------------
ALTER TABLE public.employee_kpi_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_employee_kpi_history_select" ON public.employee_kpi_history;
CREATE POLICY rls_employee_kpi_history_select ON public.employee_kpi_history AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR is_company_admin(current_app_company_id())));
DROP POLICY IF EXISTS "rls_employee_kpi_history_write" ON public.employee_kpi_history;
CREATE POLICY rls_employee_kpi_history_write ON public.employee_kpi_history AS PERMISSIVE FOR ALL TO public USING ((can_access_user(user_id) OR is_company_admin(current_app_company_id()))) WITH CHECK ((can_access_user(user_id) OR is_company_admin(current_app_company_id())));

-- ----------------------------------------------------------------------------
-- Table: public.employee_learning_style
-- ----------------------------------------------------------------------------
ALTER TABLE public.employee_learning_style ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_employee_learning_style_select" ON public.employee_learning_style;
CREATE POLICY rls_employee_learning_style_select ON public.employee_learning_style AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR is_company_admin(current_app_company_id())));
DROP POLICY IF EXISTS "rls_employee_learning_style_write" ON public.employee_learning_style;
CREATE POLICY rls_employee_learning_style_write ON public.employee_learning_style AS PERMISSIVE FOR ALL TO public USING (can_access_user(user_id)) WITH CHECK (can_access_user(user_id));

-- ----------------------------------------------------------------------------
-- Table: public.error_logs
-- ----------------------------------------------------------------------------
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_error_logs_insert" ON public.error_logs;
CREATE POLICY rls_error_logs_insert ON public.error_logs AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
DROP POLICY IF EXISTS "rls_error_logs_read" ON public.error_logs;
CREATE POLICY rls_error_logs_read ON public.error_logs AS PERMISSIVE FOR SELECT TO public USING (is_super_admin());
DROP POLICY IF EXISTS "rls_error_logs_write" ON public.error_logs;
CREATE POLICY rls_error_logs_write ON public.error_logs AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ----------------------------------------------------------------------------
-- Table: public.function
-- ----------------------------------------------------------------------------
ALTER TABLE public.function ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_function_select" ON public.function;
CREATE POLICY rls_function_select ON public.function AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_function_write" ON public.function;
CREATE POLICY rls_function_write ON public.function AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.gamification_drills
-- ----------------------------------------------------------------------------
ALTER TABLE public.gamification_drills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drills_tenant_isolation_delete" ON public.gamification_drills;
CREATE POLICY drills_tenant_isolation_delete ON public.gamification_drills AS PERMISSIVE FOR DELETE TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "drills_tenant_isolation_insert" ON public.gamification_drills;
CREATE POLICY drills_tenant_isolation_insert ON public.gamification_drills AS PERMISSIVE FOR INSERT TO public WITH CHECK ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "drills_tenant_isolation_select" ON public.gamification_drills;
CREATE POLICY drills_tenant_isolation_select ON public.gamification_drills AS PERMISSIVE FOR SELECT TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "drills_tenant_isolation_update" ON public.gamification_drills;
CREATE POLICY drills_tenant_isolation_update ON public.gamification_drills AS PERMISSIVE FOR UPDATE TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));

-- ----------------------------------------------------------------------------
-- Table: public.gamification_sprints
-- ----------------------------------------------------------------------------
ALTER TABLE public.gamification_sprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sprints_tenant_isolation_delete" ON public.gamification_sprints;
CREATE POLICY sprints_tenant_isolation_delete ON public.gamification_sprints AS PERMISSIVE FOR DELETE TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "sprints_tenant_isolation_insert" ON public.gamification_sprints;
CREATE POLICY sprints_tenant_isolation_insert ON public.gamification_sprints AS PERMISSIVE FOR INSERT TO public WITH CHECK ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "sprints_tenant_isolation_select" ON public.gamification_sprints;
CREATE POLICY sprints_tenant_isolation_select ON public.gamification_sprints AS PERMISSIVE FOR SELECT TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "sprints_tenant_isolation_update" ON public.gamification_sprints;
CREATE POLICY sprints_tenant_isolation_update ON public.gamification_sprints AS PERMISSIVE FOR UPDATE TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));

-- ----------------------------------------------------------------------------
-- Table: public.interactive_video_courses
-- ----------------------------------------------------------------------------
ALTER TABLE public.interactive_video_courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_interactive_video_courses_select" ON public.interactive_video_courses;
CREATE POLICY rls_interactive_video_courses_select ON public.interactive_video_courses AS PERMISSIVE FOR SELECT TO public USING (((processed_module_id IS NOT NULL) AND can_access_processed_module((processed_module_id)::uuid)));
DROP POLICY IF EXISTS "rls_interactive_video_courses_write" ON public.interactive_video_courses;
CREATE POLICY rls_interactive_video_courses_write ON public.interactive_video_courses AS PERMISSIVE FOR ALL TO public USING (((processed_module_id IS NOT NULL) AND can_access_processed_module((processed_module_id)::uuid))) WITH CHECK (((processed_module_id IS NOT NULL) AND can_access_processed_module((processed_module_id)::uuid)));

-- ----------------------------------------------------------------------------
-- Table: public.interactive_video_jobs
-- ----------------------------------------------------------------------------
ALTER TABLE public.interactive_video_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_interactive_video_jobs_select" ON public.interactive_video_jobs;
CREATE POLICY rls_interactive_video_jobs_select ON public.interactive_video_jobs AS PERMISSIVE FOR SELECT TO public USING (((processed_module_id IS NOT NULL) AND can_access_processed_module((processed_module_id)::uuid)));
DROP POLICY IF EXISTS "rls_interactive_video_jobs_write" ON public.interactive_video_jobs;
CREATE POLICY rls_interactive_video_jobs_write ON public.interactive_video_jobs AS PERMISSIVE FOR ALL TO public USING (((processed_module_id IS NOT NULL) AND can_access_processed_module((processed_module_id)::uuid))) WITH CHECK (((processed_module_id IS NOT NULL) AND can_access_processed_module((processed_module_id)::uuid)));

-- ----------------------------------------------------------------------------
-- Table: public.kpis
-- ----------------------------------------------------------------------------
ALTER TABLE public.kpis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_kpis_select" ON public.kpis;
CREATE POLICY rls_kpis_select ON public.kpis AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_kpis_write" ON public.kpis;
CREATE POLICY rls_kpis_write ON public.kpis AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.learning_plan
-- ----------------------------------------------------------------------------
ALTER TABLE public.learning_plan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_learning_plan_select" ON public.learning_plan;
CREATE POLICY rls_learning_plan_select ON public.learning_plan AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR ((module_id IS NOT NULL) AND can_access_training_module(module_id))));
DROP POLICY IF EXISTS "rls_learning_plan_write" ON public.learning_plan;
CREATE POLICY rls_learning_plan_write ON public.learning_plan AS PERMISSIVE FOR ALL TO public USING ((can_access_user(user_id) OR ((module_id IS NOT NULL) AND can_access_training_module(module_id)))) WITH CHECK ((can_access_user(user_id) AND ((module_id IS NULL) OR can_access_training_module(module_id))));

-- ----------------------------------------------------------------------------
-- Table: public.lucid_tool_content_jobs
-- ----------------------------------------------------------------------------
ALTER TABLE public.lucid_tool_content_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_lucid_tool_content_jobs_select" ON public.lucid_tool_content_jobs;
CREATE POLICY rls_lucid_tool_content_jobs_select ON public.lucid_tool_content_jobs AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id_for_lucid_tool_job(lucid_tool_job_id)));
DROP POLICY IF EXISTS "rls_lucid_tool_content_jobs_write" ON public.lucid_tool_content_jobs;
CREATE POLICY rls_lucid_tool_content_jobs_write ON public.lucid_tool_content_jobs AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id_for_lucid_tool_job(lucid_tool_job_id))) WITH CHECK (can_access_company(company_id_for_lucid_tool_job(lucid_tool_job_id)));

-- ----------------------------------------------------------------------------
-- Table: public.lucid_tool_jobs
-- ----------------------------------------------------------------------------
ALTER TABLE public.lucid_tool_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_lucid_tool_jobs_select" ON public.lucid_tool_jobs;
CREATE POLICY rls_lucid_tool_jobs_select ON public.lucid_tool_jobs AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_lucid_tool_jobs_write" ON public.lucid_tool_jobs;
CREATE POLICY rls_lucid_tool_jobs_write ON public.lucid_tool_jobs AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.module_chat_conversations
-- ----------------------------------------------------------------------------
ALTER TABLE public.module_chat_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_module_chat_conversations_select" ON public.module_chat_conversations;
CREATE POLICY rls_module_chat_conversations_select ON public.module_chat_conversations AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id))));
DROP POLICY IF EXISTS "rls_module_chat_conversations_write" ON public.module_chat_conversations;
CREATE POLICY rls_module_chat_conversations_write ON public.module_chat_conversations AS PERMISSIVE FOR ALL TO public USING (can_access_user(user_id)) WITH CHECK (can_access_user(user_id));

-- ----------------------------------------------------------------------------
-- Table: public.module_embeddings
-- ----------------------------------------------------------------------------
ALTER TABLE public.module_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_module_embeddings_select" ON public.module_embeddings;
CREATE POLICY rls_module_embeddings_select ON public.module_embeddings AS PERMISSIVE FOR SELECT TO public USING (can_access_training_module(module_id));
DROP POLICY IF EXISTS "rls_module_embeddings_write" ON public.module_embeddings;
CREATE POLICY rls_module_embeddings_write ON public.module_embeddings AS PERMISSIVE FOR ALL TO public USING (can_access_training_module(module_id)) WITH CHECK (can_access_training_module(module_id));

-- ----------------------------------------------------------------------------
-- Table: public.module_progress
-- ----------------------------------------------------------------------------
ALTER TABLE public.module_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_module_progress_select" ON public.module_progress;
CREATE POLICY rls_module_progress_select ON public.module_progress AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR can_access_company(( SELECT u.company_id
   FROM users u
  WHERE (u.user_id = module_progress.user_id)))));
DROP POLICY IF EXISTS "rls_module_progress_write" ON public.module_progress;
CREATE POLICY rls_module_progress_write ON public.module_progress AS PERMISSIVE FOR ALL TO public USING (can_access_user(user_id)) WITH CHECK (can_access_user(user_id));

-- ----------------------------------------------------------------------------
-- Table: public.notifications
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_notifications_select" ON public.notifications;
CREATE POLICY rls_notifications_select ON public.notifications AS PERMISSIVE FOR SELECT TO public USING (can_access_user(user_id));
DROP POLICY IF EXISTS "rls_notifications_write" ON public.notifications;
CREATE POLICY rls_notifications_write ON public.notifications AS PERMISSIVE FOR ALL TO public USING (can_access_user(user_id)) WITH CHECK (can_access_user(user_id));

-- ----------------------------------------------------------------------------
-- Table: public.nudges
-- ----------------------------------------------------------------------------
ALTER TABLE public.nudges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_nudges_select" ON public.nudges;
CREATE POLICY rls_nudges_select ON public.nudges AS PERMISSIVE FOR SELECT TO public USING (can_access_user(user_id));
DROP POLICY IF EXISTS "rls_nudges_write" ON public.nudges;
CREATE POLICY rls_nudges_write ON public.nudges AS PERMISSIVE FOR ALL TO public USING (can_access_user(user_id)) WITH CHECK (can_access_user(user_id));

-- ----------------------------------------------------------------------------
-- Table: public.processed_lucid_tools
-- ----------------------------------------------------------------------------
ALTER TABLE public.processed_lucid_tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_processed_lucid_tools_select" ON public.processed_lucid_tools;
CREATE POLICY rls_processed_lucid_tools_select ON public.processed_lucid_tools AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id_for_lucid_tool_job(lucid_tool_job_id)));
DROP POLICY IF EXISTS "rls_processed_lucid_tools_write" ON public.processed_lucid_tools;
CREATE POLICY rls_processed_lucid_tools_write ON public.processed_lucid_tools AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id_for_lucid_tool_job(lucid_tool_job_id))) WITH CHECK (can_access_company(company_id_for_lucid_tool_job(lucid_tool_job_id)));

-- ----------------------------------------------------------------------------
-- Table: public.processed_modules
-- ----------------------------------------------------------------------------
ALTER TABLE public.processed_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_processed_modules_delete" ON public.processed_modules;
CREATE POLICY rls_processed_modules_delete ON public.processed_modules AS PERMISSIVE FOR DELETE TO public USING (can_access_processed_module(processed_module_id));
DROP POLICY IF EXISTS "rls_processed_modules_insert" ON public.processed_modules;
CREATE POLICY rls_processed_modules_insert ON public.processed_modules AS PERMISSIVE FOR INSERT TO public WITH CHECK (can_access_training_module(original_module_id));
DROP POLICY IF EXISTS "rls_processed_modules_select" ON public.processed_modules;
CREATE POLICY rls_processed_modules_select ON public.processed_modules AS PERMISSIVE FOR SELECT TO public USING (can_access_processed_module(processed_module_id));
DROP POLICY IF EXISTS "rls_processed_modules_update" ON public.processed_modules;
CREATE POLICY rls_processed_modules_update ON public.processed_modules AS PERMISSIVE FOR UPDATE TO public USING (can_access_processed_module(processed_module_id)) WITH CHECK (can_access_training_module(original_module_id));

-- ----------------------------------------------------------------------------
-- Table: public.roleplay_assessments
-- ----------------------------------------------------------------------------
ALTER TABLE public.roleplay_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_roleplay_assessments_select" ON public.roleplay_assessments;
CREATE POLICY rls_roleplay_assessments_select ON public.roleplay_assessments AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(employee_id) OR is_company_admin(current_app_company_id())));
DROP POLICY IF EXISTS "rls_roleplay_assessments_write" ON public.roleplay_assessments;
CREATE POLICY rls_roleplay_assessments_write ON public.roleplay_assessments AS PERMISSIVE FOR ALL TO public USING ((can_access_user(employee_id) OR is_company_admin(current_app_company_id()))) WITH CHECK ((can_access_user(employee_id) OR is_company_admin(current_app_company_id())));

-- ----------------------------------------------------------------------------
-- Table: public.roleplay_sessions
-- ----------------------------------------------------------------------------
ALTER TABLE public.roleplay_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_roleplay_sessions_select" ON public.roleplay_sessions;
CREATE POLICY rls_roleplay_sessions_select ON public.roleplay_sessions AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(employee_id) OR is_company_admin(current_app_company_id())));
DROP POLICY IF EXISTS "rls_roleplay_sessions_write" ON public.roleplay_sessions;
CREATE POLICY rls_roleplay_sessions_write ON public.roleplay_sessions AS PERMISSIVE FOR ALL TO public USING ((can_access_user(employee_id) OR is_company_admin(current_app_company_id()))) WITH CHECK ((can_access_user(employee_id) OR is_company_admin(current_app_company_id())));

-- ----------------------------------------------------------------------------
-- Table: public.roles
-- ----------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_roles_select" ON public.roles;
CREATE POLICY rls_roles_select ON public.roles AS PERMISSIVE FOR SELECT TO public USING ((current_app_user_id() IS NOT NULL));
DROP POLICY IF EXISTS "rls_roles_write" ON public.roles;
CREATE POLICY rls_roles_write ON public.roles AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ----------------------------------------------------------------------------
-- Table: public.sales_tool_documents
-- ----------------------------------------------------------------------------
ALTER TABLE public.sales_tool_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_sales_tool_documents_select" ON public.sales_tool_documents;
CREATE POLICY rls_sales_tool_documents_select ON public.sales_tool_documents AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_sales_tool_documents_write" ON public.sales_tool_documents;
CREATE POLICY rls_sales_tool_documents_write ON public.sales_tool_documents AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.salestool_categories
-- ----------------------------------------------------------------------------
ALTER TABLE public.salestool_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_salestool_categories_select" ON public.salestool_categories;
CREATE POLICY rls_salestool_categories_select ON public.salestool_categories AS PERMISSIVE FOR SELECT TO public USING ((current_app_user_id() IS NOT NULL));
DROP POLICY IF EXISTS "rls_salestool_categories_write" ON public.salestool_categories;
CREATE POLICY rls_salestool_categories_write ON public.salestool_categories AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ----------------------------------------------------------------------------
-- Table: public.scenario_assignments
-- ----------------------------------------------------------------------------
ALTER TABLE public.scenario_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_scenario_assignments_select" ON public.scenario_assignments;
CREATE POLICY rls_scenario_assignments_select ON public.scenario_assignments AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_scenario_assignments_write" ON public.scenario_assignments;
CREATE POLICY rls_scenario_assignments_write ON public.scenario_assignments AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.scenarios
-- ----------------------------------------------------------------------------
ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_scenarios_select" ON public.scenarios;
CREATE POLICY rls_scenarios_select ON public.scenarios AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_scenarios_write" ON public.scenarios;
CREATE POLICY rls_scenarios_write ON public.scenarios AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.scheduled_emails
-- ----------------------------------------------------------------------------
ALTER TABLE public.scheduled_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_scheduled_emails_select" ON public.scheduled_emails;
CREATE POLICY rls_scheduled_emails_select ON public.scheduled_emails AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_scheduled_emails_write" ON public.scheduled_emails;
CREATE POLICY rls_scheduled_emails_write ON public.scheduled_emails AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.scheduled_jobs
-- ----------------------------------------------------------------------------
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_scheduled_jobs_select" ON public.scheduled_jobs;
CREATE POLICY rls_scheduled_jobs_select ON public.scheduled_jobs AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_scheduled_jobs_write" ON public.scheduled_jobs;
CREATE POLICY rls_scheduled_jobs_write ON public.scheduled_jobs AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.scheduled_whatsapp
-- ----------------------------------------------------------------------------
ALTER TABLE public.scheduled_whatsapp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_scheduled_whatsapp_select" ON public.scheduled_whatsapp;
CREATE POLICY rls_scheduled_whatsapp_select ON public.scheduled_whatsapp AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_scheduled_whatsapp_write" ON public.scheduled_whatsapp;
CREATE POLICY rls_scheduled_whatsapp_write ON public.scheduled_whatsapp AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.sub_function
-- ----------------------------------------------------------------------------
ALTER TABLE public.sub_function ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_sub_function_select" ON public.sub_function;
CREATE POLICY rls_sub_function_select ON public.sub_function AS PERMISSIVE FOR SELECT TO public USING (can_access_company(( SELECT f.company_id
   FROM function f
  WHERE (f.function_id = sub_function.function_id)
 LIMIT 1)));
DROP POLICY IF EXISTS "rls_sub_function_write" ON public.sub_function;
CREATE POLICY rls_sub_function_write ON public.sub_function AS PERMISSIVE FOR ALL TO public USING (can_access_company(( SELECT f.company_id
   FROM function f
  WHERE (f.function_id = sub_function.function_id)
 LIMIT 1))) WITH CHECK (can_access_company(( SELECT f.company_id
   FROM function f
  WHERE (f.function_id = sub_function.function_id)
 LIMIT 1)));

-- ----------------------------------------------------------------------------
-- Table: public.task_assignments
-- ----------------------------------------------------------------------------
ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_task_assignments_select" ON public.task_assignments;
CREATE POLICY rls_task_assignments_select ON public.task_assignments AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_task_assignments_write" ON public.task_assignments;
CREATE POLICY rls_task_assignments_write ON public.task_assignments AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.task_report_summaries
-- ----------------------------------------------------------------------------
ALTER TABLE public.task_report_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_task_report_summaries_select" ON public.task_report_summaries;
CREATE POLICY rls_task_report_summaries_select ON public.task_report_summaries AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_task_report_summaries_write" ON public.task_report_summaries;
CREATE POLICY rls_task_report_summaries_write ON public.task_report_summaries AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.task_submissions
-- ----------------------------------------------------------------------------
ALTER TABLE public.task_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_task_submissions_select" ON public.task_submissions;
CREATE POLICY rls_task_submissions_select ON public.task_submissions AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR can_access_company(company_id)));
DROP POLICY IF EXISTS "rls_task_submissions_write" ON public.task_submissions;
CREATE POLICY rls_task_submissions_write ON public.task_submissions AS PERMISSIVE FOR ALL TO public USING ((can_access_user(user_id) OR can_access_company(company_id))) WITH CHECK ((can_access_user(user_id) OR can_access_company(company_id)));

-- ----------------------------------------------------------------------------
-- Table: public.tasks
-- ----------------------------------------------------------------------------
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_tasks_select" ON public.tasks;
CREATE POLICY rls_tasks_select ON public.tasks AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_tasks_write" ON public.tasks;
CREATE POLICY rls_tasks_write ON public.tasks AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.titles
-- ----------------------------------------------------------------------------
ALTER TABLE public.titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_titles_select" ON public.titles;
CREATE POLICY rls_titles_select ON public.titles AS PERMISSIVE FOR SELECT TO public USING (can_access_company(( SELECT f.company_id
   FROM (sub_function sf
     JOIN function f ON ((f.function_id = sf.function_id)))
  WHERE (sf.sub_function_id = titles.sub_function_id)
 LIMIT 1)));
DROP POLICY IF EXISTS "rls_titles_write" ON public.titles;
CREATE POLICY rls_titles_write ON public.titles AS PERMISSIVE FOR ALL TO public USING (can_access_company(( SELECT f.company_id
   FROM (sub_function sf
     JOIN function f ON ((f.function_id = sf.function_id)))
  WHERE (sf.sub_function_id = titles.sub_function_id)
 LIMIT 1))) WITH CHECK (can_access_company(( SELECT f.company_id
   FROM (sub_function sf
     JOIN function f ON ((f.function_id = sf.function_id)))
  WHERE (sf.sub_function_id = titles.sub_function_id)
 LIMIT 1)));

-- ----------------------------------------------------------------------------
-- Table: public.tools
-- ----------------------------------------------------------------------------
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_tools_select" ON public.tools;
CREATE POLICY rls_tools_select ON public.tools AS PERMISSIVE FOR SELECT TO public USING ((current_app_user_id() IS NOT NULL));
DROP POLICY IF EXISTS "rls_tools_write" ON public.tools;
CREATE POLICY rls_tools_write ON public.tools AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ----------------------------------------------------------------------------
-- Table: public.training_modules
-- ----------------------------------------------------------------------------
ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_training_modules_select" ON public.training_modules;
CREATE POLICY rls_training_modules_select ON public.training_modules AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_training_modules_write" ON public.training_modules;
CREATE POLICY rls_training_modules_write ON public.training_modules AS PERMISSIVE FOR ALL TO public USING ((is_company_admin(company_id) OR (uploaded_by = current_app_user_id()))) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.user_badges
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "badges_tenant_isolation_insert" ON public.user_badges;
CREATE POLICY badges_tenant_isolation_insert ON public.user_badges AS PERMISSIVE FOR INSERT TO public WITH CHECK ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "badges_tenant_isolation_select" ON public.user_badges;
CREATE POLICY badges_tenant_isolation_select ON public.user_badges AS PERMISSIVE FOR SELECT TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));

-- ----------------------------------------------------------------------------
-- Table: public.user_firebase_uids
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_firebase_uids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_user_firebase_uids_select" ON public.user_firebase_uids;
CREATE POLICY rls_user_firebase_uids_select ON public.user_firebase_uids AS PERMISSIVE FOR SELECT TO public USING (can_access_user(user_id));
DROP POLICY IF EXISTS "rls_user_firebase_uids_write" ON public.user_firebase_uids;
CREATE POLICY rls_user_firebase_uids_write ON public.user_firebase_uids AS PERMISSIVE FOR ALL TO public USING (can_access_user(user_id)) WITH CHECK (can_access_user(user_id));

-- ----------------------------------------------------------------------------
-- Table: public.user_gamification_profiles
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_gamification_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_tenant_isolation_insert" ON public.user_gamification_profiles;
CREATE POLICY profiles_tenant_isolation_insert ON public.user_gamification_profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "profiles_tenant_isolation_select" ON public.user_gamification_profiles;
CREATE POLICY profiles_tenant_isolation_select ON public.user_gamification_profiles AS PERMISSIVE FOR SELECT TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "profiles_tenant_isolation_update" ON public.user_gamification_profiles;
CREATE POLICY profiles_tenant_isolation_update ON public.user_gamification_profiles AS PERMISSIVE FOR UPDATE TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));

-- ----------------------------------------------------------------------------
-- Table: public.user_gamification_progress
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_gamification_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "progress_tenant_isolation_insert" ON public.user_gamification_progress;
CREATE POLICY progress_tenant_isolation_insert ON public.user_gamification_progress AS PERMISSIVE FOR INSERT TO public WITH CHECK ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "progress_tenant_isolation_select" ON public.user_gamification_progress;
CREATE POLICY progress_tenant_isolation_select ON public.user_gamification_progress AS PERMISSIVE FOR SELECT TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));
DROP POLICY IF EXISTS "progress_tenant_isolation_update" ON public.user_gamification_progress;
CREATE POLICY progress_tenant_isolation_update ON public.user_gamification_progress AS PERMISSIVE FOR UPDATE TO public USING ((company_id = ((auth.jwt() ->> 'company_id'::text))::uuid));

-- ----------------------------------------------------------------------------
-- Table: public.user_role_assignments
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_role_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_user_role_assignments_select" ON public.user_role_assignments;
CREATE POLICY rls_user_role_assignments_select ON public.user_role_assignments AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR (assigned_by = current_app_user_id()) OR is_super_admin()));
DROP POLICY IF EXISTS "rls_user_role_assignments_write" ON public.user_role_assignments;
CREATE POLICY rls_user_role_assignments_write ON public.user_role_assignments AS PERMISSIVE FOR ALL TO public USING ((is_super_admin() OR (((scope_type)::text = 'COMPANY'::text) AND is_company_admin(scope_id)))) WITH CHECK ((is_super_admin() OR (((scope_type)::text = 'COMPANY'::text) AND is_company_admin(scope_id))));

-- ----------------------------------------------------------------------------
-- Table: public.users
-- ----------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_users_delete" ON public.users;
CREATE POLICY rls_users_delete ON public.users AS PERMISSIVE FOR DELETE TO public USING ((is_company_admin(company_id) OR is_super_admin()));
DROP POLICY IF EXISTS "rls_users_insert" ON public.users;
CREATE POLICY rls_users_insert ON public.users AS PERMISSIVE FOR INSERT TO public WITH CHECK ((can_access_company(company_id) OR is_super_admin()));
DROP POLICY IF EXISTS "rls_users_select" ON public.users;
CREATE POLICY rls_users_select ON public.users AS PERMISSIVE FOR SELECT TO public USING (can_access_user(user_id));
DROP POLICY IF EXISTS "rls_users_update" ON public.users;
CREATE POLICY rls_users_update ON public.users AS PERMISSIVE FOR UPDATE TO public USING (can_access_user(user_id)) WITH CHECK ((can_access_company(company_id) OR (user_id = current_app_user_id())));

-- ----------------------------------------------------------------------------
-- Table: public.vectordb_chunks
-- ----------------------------------------------------------------------------
ALTER TABLE public.vectordb_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_vectordb_chunks_select" ON public.vectordb_chunks;
CREATE POLICY rls_vectordb_chunks_select ON public.vectordb_chunks AS PERMISSIVE FOR SELECT TO public USING (can_access_company(company_id));
DROP POLICY IF EXISTS "rls_vectordb_chunks_write" ON public.vectordb_chunks;
CREATE POLICY rls_vectordb_chunks_write ON public.vectordb_chunks AS PERMISSIVE FOR ALL TO public USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));

-- ----------------------------------------------------------------------------
-- Table: public.vectordb_images
-- ----------------------------------------------------------------------------
ALTER TABLE public.vectordb_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_vectordb_images_select" ON public.vectordb_images;
CREATE POLICY rls_vectordb_images_select ON public.vectordb_images AS PERMISSIVE FOR SELECT TO public USING ((can_access_training_module(module_id) OR can_access_company(( SELECT vc.company_id
   FROM vectordb_chunks vc
  WHERE (vc.chunk_id = vectordb_images.chunk_id)
 LIMIT 1))));
DROP POLICY IF EXISTS "rls_vectordb_images_write" ON public.vectordb_images;
CREATE POLICY rls_vectordb_images_write ON public.vectordb_images AS PERMISSIVE FOR ALL TO public USING (can_access_training_module(module_id)) WITH CHECK (can_access_training_module(module_id));

-- ----------------------------------------------------------------------------
-- Table: public.voice_daily_reports
-- ----------------------------------------------------------------------------
ALTER TABLE public.voice_daily_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_voice_daily_reports_select" ON public.voice_daily_reports;
CREATE POLICY rls_voice_daily_reports_select ON public.voice_daily_reports AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id))));
DROP POLICY IF EXISTS "rls_voice_daily_reports_write" ON public.voice_daily_reports;
CREATE POLICY rls_voice_daily_reports_write ON public.voice_daily_reports AS PERMISSIVE FOR ALL TO public USING ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id)))) WITH CHECK ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id))));

-- ----------------------------------------------------------------------------
-- Table: public.voice_documents
-- ----------------------------------------------------------------------------
ALTER TABLE public.voice_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_voice_documents_select" ON public.voice_documents;
CREATE POLICY rls_voice_documents_select ON public.voice_documents AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id))));
DROP POLICY IF EXISTS "rls_voice_documents_write" ON public.voice_documents;
CREATE POLICY rls_voice_documents_write ON public.voice_documents AS PERMISSIVE FOR ALL TO public USING ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id)))) WITH CHECK ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id))));

-- ----------------------------------------------------------------------------
-- Table: public.voice_transcripts
-- ----------------------------------------------------------------------------
ALTER TABLE public.voice_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_voice_transcripts_select" ON public.voice_transcripts;
CREATE POLICY rls_voice_transcripts_select ON public.voice_transcripts AS PERMISSIVE FOR SELECT TO public USING ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id))));
DROP POLICY IF EXISTS "rls_voice_transcripts_write" ON public.voice_transcripts;
CREATE POLICY rls_voice_transcripts_write ON public.voice_transcripts AS PERMISSIVE FOR ALL TO public USING ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id)))) WITH CHECK ((can_access_user(user_id) OR ((company_id IS NOT NULL) AND can_access_company(company_id))));

-- ----------------------------------------------------------------------------
-- Table: public.whatsapp_dispatch
-- ----------------------------------------------------------------------------
ALTER TABLE public.whatsapp_dispatch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_whatsapp_dispatch_select" ON public.whatsapp_dispatch;
CREATE POLICY rls_whatsapp_dispatch_select ON public.whatsapp_dispatch AS PERMISSIVE FOR SELECT TO public USING (can_access_user(user_id));
DROP POLICY IF EXISTS "rls_whatsapp_dispatch_write" ON public.whatsapp_dispatch;
CREATE POLICY rls_whatsapp_dispatch_write ON public.whatsapp_dispatch AS PERMISSIVE FOR ALL TO public USING (can_access_user(user_id)) WITH CHECK (can_access_user(user_id));

COMMIT;
