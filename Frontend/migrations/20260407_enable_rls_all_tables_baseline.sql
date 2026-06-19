-- Migration: Enable baseline RLS on all core tables
-- Created: 2026-04-07
-- Purpose: Apply tenant-safe defaults across the full schema, then iterate app compatibility

BEGIN;

-- =====================================================
-- Helper functions (JWT -> app user / tenant resolution)
-- =====================================================

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    auth.uid(),
    (
      SELECT u.user_id
      FROM public.users u
      WHERE lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      LIMIT 1
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.current_app_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.company_id
  FROM public.users u
  WHERE u.user_id = public.current_app_user_id()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_role_assignments ura
    JOIN public.roles r ON r.role_id = ura.role_id
    WHERE ura.user_id = public.current_app_user_id()
      AND ura.is_active = true
      AND (ura.expires_at IS NULL OR ura.expires_at > now())
      AND r.name = 'SUPER_ADMIN'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_role_assignments ura
    JOIN public.roles r ON r.role_id = ura.role_id
    WHERE ura.user_id = public.current_app_user_id()
      AND ura.is_active = true
      AND (ura.expires_at IS NULL OR ura.expires_at > now())
      AND (
        (ura.scope_type = 'COMPANY' AND ura.scope_id = target_company_id)
        OR r.name = 'SUPER_ADMIN'
      )
      AND r.name IN ('CEO', 'SUPER_ADMIN', 'ADMIN')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_company(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    target_company_id = public.current_app_company_id()
    OR public.is_company_admin(target_company_id)
    OR public.is_super_admin()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_user(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.user_id = target_user_id
      AND (
        u.user_id = public.current_app_user_id()
        OR public.can_access_company(u.company_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.company_id_for_module(target_module_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tm.company_id
  FROM public.training_modules tm
  WHERE tm.module_id = target_module_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.company_id_for_processed_module(target_processed_module_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tm.company_id
  FROM public.processed_modules pm
  JOIN public.training_modules tm ON tm.module_id = pm.original_module_id
  WHERE pm.processed_module_id = target_processed_module_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.company_id_for_assessment(target_assessment_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.company_id
  FROM public.assessments a
  WHERE a.assessment_id = target_assessment_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_access_training_module(target_module_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_company(public.company_id_for_module(target_module_id));
$$;

CREATE OR REPLACE FUNCTION public.can_access_processed_module(target_processed_module_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_company(public.company_id_for_processed_module(target_processed_module_id));
$$;

-- =====================================================
-- Enable RLS everywhere
-- =====================================================

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_user_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_generation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_dispatch_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_kpi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_kpi_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_learning_style ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."function" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nudges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roleplay_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roleplay_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_department ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_function ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vectordb_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vectordb_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_dispatch ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Policy cleanup for this migration's policy names
-- =====================================================

-- Users
DROP POLICY IF EXISTS rls_users_select ON public.users;
DROP POLICY IF EXISTS rls_users_insert ON public.users;
DROP POLICY IF EXISTS rls_users_update ON public.users;
DROP POLICY IF EXISTS rls_users_delete ON public.users;

CREATE POLICY rls_users_select ON public.users
FOR SELECT USING (public.can_access_user(user_id));

CREATE POLICY rls_users_insert ON public.users
FOR INSERT WITH CHECK (
  public.can_access_company(company_id)
  OR public.is_super_admin()
);

CREATE POLICY rls_users_update ON public.users
FOR UPDATE USING (public.can_access_user(user_id))
WITH CHECK (
  public.can_access_company(company_id)
  OR user_id = public.current_app_user_id()
);

CREATE POLICY rls_users_delete ON public.users
FOR DELETE USING (
  public.is_company_admin(company_id)
  OR public.is_super_admin()
);

-- Companies
DROP POLICY IF EXISTS rls_companies_select ON public.companies;
DROP POLICY IF EXISTS rls_companies_write ON public.companies;

CREATE POLICY rls_companies_select ON public.companies
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_companies_write ON public.companies
FOR ALL USING (
  public.is_company_admin(company_id)
  OR public.is_super_admin()
)
WITH CHECK (
  public.is_company_admin(company_id)
  OR public.is_super_admin()
);

-- Roles and assignments
DROP POLICY IF EXISTS rls_roles_select ON public.roles;
DROP POLICY IF EXISTS rls_roles_write ON public.roles;

CREATE POLICY rls_roles_select ON public.roles
FOR SELECT USING (public.current_app_user_id() IS NOT NULL);

CREATE POLICY rls_roles_write ON public.roles
FOR ALL USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS rls_user_role_assignments_select ON public.user_role_assignments;
DROP POLICY IF EXISTS rls_user_role_assignments_write ON public.user_role_assignments;

CREATE POLICY rls_user_role_assignments_select ON public.user_role_assignments
FOR SELECT USING (
  public.can_access_user(user_id)
  OR assigned_by = public.current_app_user_id()
);

CREATE POLICY rls_user_role_assignments_write ON public.user_role_assignments
FOR ALL USING (
  public.is_super_admin()
  OR (
    scope_type = 'COMPANY'
    AND public.is_company_admin(scope_id)
  )
)
WITH CHECK (
  public.is_super_admin()
  OR (
    scope_type = 'COMPANY'
    AND public.is_company_admin(scope_id)
  )
);

-- Training modules
DROP POLICY IF EXISTS rls_training_modules_select ON public.training_modules;
DROP POLICY IF EXISTS rls_training_modules_write ON public.training_modules;

CREATE POLICY rls_training_modules_select ON public.training_modules
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_training_modules_write ON public.training_modules
FOR ALL USING (
  public.is_company_admin(company_id)
  OR uploaded_by = public.current_app_user_id()
)
WITH CHECK (public.can_access_company(company_id));

-- Processed modules
DROP POLICY IF EXISTS rls_processed_modules_select ON public.processed_modules;
DROP POLICY IF EXISTS rls_processed_modules_write ON public.processed_modules;

CREATE POLICY rls_processed_modules_select ON public.processed_modules
FOR SELECT USING (public.can_access_processed_module(processed_module_id));

CREATE POLICY rls_processed_modules_write ON public.processed_modules
FOR ALL USING (
  public.can_access_processed_module(processed_module_id)
)
WITH CHECK (
  public.can_access_training_module(original_module_id)
);

-- Assessments
DROP POLICY IF EXISTS rls_assessments_select ON public.assessments;
DROP POLICY IF EXISTS rls_assessments_write ON public.assessments;

CREATE POLICY rls_assessments_select ON public.assessments
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_assessments_write ON public.assessments
FOR ALL USING (
  public.can_access_company(company_id)
)
WITH CHECK (
  public.can_access_company(company_id)
);

-- Employee assessments
DROP POLICY IF EXISTS rls_employee_assessments_select ON public.employee_assessments;
DROP POLICY IF EXISTS rls_employee_assessments_write ON public.employee_assessments;

CREATE POLICY rls_employee_assessments_select ON public.employee_assessments
FOR SELECT USING (
  public.can_access_user(user_id)
  OR public.can_access_company(public.company_id_for_assessment(assessment_id))
);

CREATE POLICY rls_employee_assessments_write ON public.employee_assessments
FOR ALL USING (
  public.can_access_user(user_id)
)
WITH CHECK (
  public.can_access_user(user_id)
);

-- Learning plan
DROP POLICY IF EXISTS rls_learning_plan_select ON public.learning_plan;
DROP POLICY IF EXISTS rls_learning_plan_write ON public.learning_plan;

CREATE POLICY rls_learning_plan_select ON public.learning_plan
FOR SELECT USING (
  public.can_access_user(user_id)
  OR public.can_access_training_module(module_id)
);

CREATE POLICY rls_learning_plan_write ON public.learning_plan
FOR ALL USING (
  public.can_access_user(user_id)
  OR public.can_access_training_module(module_id)
)
WITH CHECK (
  public.can_access_user(user_id)
  AND (module_id IS NULL OR public.can_access_training_module(module_id))
);

-- Module progress (keep this compatible with prior dedicated migration)
DROP POLICY IF EXISTS rls_module_progress_select ON public.module_progress;
DROP POLICY IF EXISTS rls_module_progress_write ON public.module_progress;
DROP POLICY IF EXISTS "Users can view own module progress" ON public.module_progress;
DROP POLICY IF EXISTS "Admins can view company module progress" ON public.module_progress;
DROP POLICY IF EXISTS "Users can insert own module progress" ON public.module_progress;
DROP POLICY IF EXISTS "Admins can insert company module progress" ON public.module_progress;
DROP POLICY IF EXISTS "Users can update own module progress" ON public.module_progress;
DROP POLICY IF EXISTS "Admins can update company module progress" ON public.module_progress;
DROP POLICY IF EXISTS "Admins can delete company module progress" ON public.module_progress;

CREATE POLICY rls_module_progress_select ON public.module_progress
FOR SELECT USING (public.can_access_user(user_id));

CREATE POLICY rls_module_progress_write ON public.module_progress
FOR ALL USING (public.can_access_user(user_id))
WITH CHECK (
  public.can_access_user(user_id)
  AND public.can_access_processed_module(processed_module_id)
);

-- Learning style and chatbot interactions
DROP POLICY IF EXISTS rls_employee_learning_style_select ON public.employee_learning_style;
DROP POLICY IF EXISTS rls_employee_learning_style_write ON public.employee_learning_style;

CREATE POLICY rls_employee_learning_style_select ON public.employee_learning_style
FOR SELECT USING (public.can_access_user(user_id));

CREATE POLICY rls_employee_learning_style_write ON public.employee_learning_style
FOR ALL USING (public.can_access_user(user_id))
WITH CHECK (public.can_access_user(user_id));

DROP POLICY IF EXISTS rls_chatbot_user_interactions_select ON public.chatbot_user_interactions;
DROP POLICY IF EXISTS rls_chatbot_user_interactions_write ON public.chatbot_user_interactions;

CREATE POLICY rls_chatbot_user_interactions_select ON public.chatbot_user_interactions
FOR SELECT USING (public.can_access_user(user_id));

CREATE POLICY rls_chatbot_user_interactions_write ON public.chatbot_user_interactions
FOR ALL USING (public.can_access_user(user_id))
WITH CHECK (public.can_access_user(user_id));

-- Content generation and jobs
DROP POLICY IF EXISTS rls_content_generation_history_select ON public.content_generation_history;
DROP POLICY IF EXISTS rls_content_generation_history_write ON public.content_generation_history;

CREATE POLICY rls_content_generation_history_select ON public.content_generation_history
FOR SELECT USING (
  public.can_access_training_module(original_module_id)
  OR public.can_access_processed_module(processed_module_id)
);

CREATE POLICY rls_content_generation_history_write ON public.content_generation_history
FOR ALL USING (
  public.can_access_training_module(original_module_id)
)
WITH CHECK (
  public.can_access_training_module(original_module_id)
);

DROP POLICY IF EXISTS rls_content_jobs_select ON public.content_jobs;
DROP POLICY IF EXISTS rls_content_jobs_write ON public.content_jobs;

CREATE POLICY rls_content_jobs_select ON public.content_jobs
FOR SELECT USING (public.can_access_training_module(module_id));

CREATE POLICY rls_content_jobs_write ON public.content_jobs
FOR ALL USING (public.can_access_training_module(module_id))
WITH CHECK (public.can_access_training_module(module_id));

-- KPI tables
DROP POLICY IF EXISTS rls_kpis_select ON public.kpis;
DROP POLICY IF EXISTS rls_kpis_write ON public.kpis;

CREATE POLICY rls_kpis_select ON public.kpis
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_kpis_write ON public.kpis
FOR ALL USING (public.can_access_company(company_id))
WITH CHECK (public.can_access_company(company_id));

DROP POLICY IF EXISTS rls_employee_kpi_select ON public.employee_kpi;
DROP POLICY IF EXISTS rls_employee_kpi_write ON public.employee_kpi;

CREATE POLICY rls_employee_kpi_select ON public.employee_kpi
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_employee_kpi_write ON public.employee_kpi
FOR ALL USING (public.can_access_company(company_id))
WITH CHECK (public.can_access_company(company_id));

DROP POLICY IF EXISTS rls_employee_kpi_history_select ON public.employee_kpi_history;
DROP POLICY IF EXISTS rls_employee_kpi_history_write ON public.employee_kpi_history;

CREATE POLICY rls_employee_kpi_history_select ON public.employee_kpi_history
FOR SELECT USING (public.can_access_user(user_id));

CREATE POLICY rls_employee_kpi_history_write ON public.employee_kpi_history
FOR ALL USING (public.can_access_user(user_id))
WITH CHECK (public.can_access_user(user_id));

-- Scheduling and dispatch tables
DROP POLICY IF EXISTS rls_scheduled_emails_select ON public.scheduled_emails;
DROP POLICY IF EXISTS rls_scheduled_emails_write ON public.scheduled_emails;
DROP POLICY IF EXISTS "Users can view scheduled emails from their company" ON public.scheduled_emails;
DROP POLICY IF EXISTS "Admins can create scheduled emails" ON public.scheduled_emails;
DROP POLICY IF EXISTS "Admins can update scheduled emails" ON public.scheduled_emails;
DROP POLICY IF EXISTS "Admins can delete scheduled emails" ON public.scheduled_emails;

CREATE POLICY rls_scheduled_emails_select ON public.scheduled_emails
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_scheduled_emails_write ON public.scheduled_emails
FOR ALL USING (public.can_access_company(company_id))
WITH CHECK (public.can_access_company(company_id));

DROP POLICY IF EXISTS rls_scheduled_jobs_select ON public.scheduled_jobs;
DROP POLICY IF EXISTS rls_scheduled_jobs_write ON public.scheduled_jobs;

CREATE POLICY rls_scheduled_jobs_select ON public.scheduled_jobs
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_scheduled_jobs_write ON public.scheduled_jobs
FOR ALL USING (public.can_access_company(company_id))
WITH CHECK (public.can_access_company(company_id));

DROP POLICY IF EXISTS rls_scheduled_whatsapp_select ON public.scheduled_whatsapp;
DROP POLICY IF EXISTS rls_scheduled_whatsapp_write ON public.scheduled_whatsapp;

CREATE POLICY rls_scheduled_whatsapp_select ON public.scheduled_whatsapp
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_scheduled_whatsapp_write ON public.scheduled_whatsapp
FOR ALL USING (public.can_access_company(company_id))
WITH CHECK (public.can_access_company(company_id));

DROP POLICY IF EXISTS rls_whatsapp_dispatch_select ON public.whatsapp_dispatch;
DROP POLICY IF EXISTS rls_whatsapp_dispatch_write ON public.whatsapp_dispatch;

CREATE POLICY rls_whatsapp_dispatch_select ON public.whatsapp_dispatch
FOR SELECT USING (public.can_access_user(user_id));

CREATE POLICY rls_whatsapp_dispatch_write ON public.whatsapp_dispatch
FOR ALL USING (public.can_access_user(user_id))
WITH CHECK (public.can_access_user(user_id));

DROP POLICY IF EXISTS rls_email_dispatch_log_select ON public.email_dispatch_log;
DROP POLICY IF EXISTS rls_email_dispatch_log_write ON public.email_dispatch_log;

CREATE POLICY rls_email_dispatch_log_select ON public.email_dispatch_log
FOR SELECT USING (public.can_access_user(user_id));

CREATE POLICY rls_email_dispatch_log_write ON public.email_dispatch_log
FOR ALL USING (public.can_access_user(user_id))
WITH CHECK (public.can_access_user(user_id));

-- Nudges
DROP POLICY IF EXISTS rls_nudges_select ON public.nudges;
DROP POLICY IF EXISTS rls_nudges_write ON public.nudges;

CREATE POLICY rls_nudges_select ON public.nudges
FOR SELECT USING (public.can_access_user(user_id));

CREATE POLICY rls_nudges_write ON public.nudges
FOR ALL USING (public.can_access_user(user_id))
WITH CHECK (public.can_access_user(user_id));

-- Roleplay
DROP POLICY IF EXISTS rls_roleplay_sessions_select ON public.roleplay_sessions;
DROP POLICY IF EXISTS rls_roleplay_sessions_write ON public.roleplay_sessions;
DROP POLICY IF EXISTS "Employees can view their own roleplay sessions" ON public.roleplay_sessions;
DROP POLICY IF EXISTS "Employees can insert their own roleplay sessions" ON public.roleplay_sessions;
DROP POLICY IF EXISTS "Employees can update their own roleplay sessions" ON public.roleplay_sessions;
DROP POLICY IF EXISTS "Users can view roleplay sessions" ON public.roleplay_sessions;
DROP POLICY IF EXISTS "Users can insert roleplay sessions" ON public.roleplay_sessions;
DROP POLICY IF EXISTS "Users can update roleplay sessions" ON public.roleplay_sessions;

CREATE POLICY rls_roleplay_sessions_select ON public.roleplay_sessions
FOR SELECT USING (public.can_access_user(employee_id));

CREATE POLICY rls_roleplay_sessions_write ON public.roleplay_sessions
FOR ALL USING (public.can_access_user(employee_id))
WITH CHECK (public.can_access_user(employee_id));

DROP POLICY IF EXISTS rls_roleplay_assessments_select ON public.roleplay_assessments;
DROP POLICY IF EXISTS rls_roleplay_assessments_write ON public.roleplay_assessments;
DROP POLICY IF EXISTS "Employees can view their own roleplay assessments" ON public.roleplay_assessments;
DROP POLICY IF EXISTS "Employees can insert their own roleplay assessments" ON public.roleplay_assessments;
DROP POLICY IF EXISTS "Users can view roleplay assessments" ON public.roleplay_assessments;
DROP POLICY IF EXISTS "Users can insert roleplay assessments" ON public.roleplay_assessments;

CREATE POLICY rls_roleplay_assessments_select ON public.roleplay_assessments
FOR SELECT USING (public.can_access_user(employee_id));

CREATE POLICY rls_roleplay_assessments_write ON public.roleplay_assessments
FOR ALL USING (public.can_access_user(employee_id))
WITH CHECK (public.can_access_user(employee_id));

-- Scenarios
DROP POLICY IF EXISTS rls_scenarios_select ON public.scenarios;
DROP POLICY IF EXISTS rls_scenarios_write ON public.scenarios;

CREATE POLICY rls_scenarios_select ON public.scenarios
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_scenarios_write ON public.scenarios
FOR ALL USING (public.can_access_company(company_id))
WITH CHECK (public.can_access_company(company_id));

DROP POLICY IF EXISTS rls_scenario_assignments_select ON public.scenario_assignments;
DROP POLICY IF EXISTS rls_scenario_assignments_write ON public.scenario_assignments;

CREATE POLICY rls_scenario_assignments_select ON public.scenario_assignments
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_scenario_assignments_write ON public.scenario_assignments
FOR ALL USING (public.can_access_company(company_id))
WITH CHECK (public.can_access_company(company_id));

-- Vectors and embeddings
DROP POLICY IF EXISTS rls_vectordb_chunks_select ON public.vectordb_chunks;
DROP POLICY IF EXISTS rls_vectordb_chunks_write ON public.vectordb_chunks;

CREATE POLICY rls_vectordb_chunks_select ON public.vectordb_chunks
FOR SELECT USING (public.can_access_company(company_id));

CREATE POLICY rls_vectordb_chunks_write ON public.vectordb_chunks
FOR ALL USING (public.can_access_company(company_id))
WITH CHECK (public.can_access_company(company_id));

DROP POLICY IF EXISTS rls_vectordb_images_select ON public.vectordb_images;
DROP POLICY IF EXISTS rls_vectordb_images_write ON public.vectordb_images;

CREATE POLICY rls_vectordb_images_select ON public.vectordb_images
FOR SELECT USING (
  public.can_access_training_module(module_id)
  OR public.can_access_company(
    (SELECT vc.company_id FROM public.vectordb_chunks vc WHERE vc.chunk_id = vectordb_images.chunk_id LIMIT 1)
  )
);

CREATE POLICY rls_vectordb_images_write ON public.vectordb_images
FOR ALL USING (public.can_access_training_module(module_id))
WITH CHECK (public.can_access_training_module(module_id));

DROP POLICY IF EXISTS rls_module_embeddings_select ON public.module_embeddings;
DROP POLICY IF EXISTS rls_module_embeddings_write ON public.module_embeddings;

CREATE POLICY rls_module_embeddings_select ON public.module_embeddings
FOR SELECT USING (public.can_access_training_module(module_id));

CREATE POLICY rls_module_embeddings_write ON public.module_embeddings
FOR ALL USING (public.can_access_training_module(module_id))
WITH CHECK (public.can_access_training_module(module_id));

-- Org structure / reference tables
DROP POLICY IF EXISTS rls_categories_public_read ON public.categories;
DROP POLICY IF EXISTS rls_categories_admin_write ON public.categories;
CREATE POLICY rls_categories_public_read ON public.categories FOR SELECT USING (true);
CREATE POLICY rls_categories_admin_write ON public.categories FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS rls_courses_public_read ON public.courses;
DROP POLICY IF EXISTS rls_courses_admin_write ON public.courses;
CREATE POLICY rls_courses_public_read ON public.courses FOR SELECT USING (true);
CREATE POLICY rls_courses_admin_write ON public.courses FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS rls_sub_department_company_read ON public.sub_department;
DROP POLICY IF EXISTS rls_sub_department_admin_write ON public.sub_department;
CREATE POLICY rls_sub_department_company_read ON public.sub_department FOR SELECT USING (public.current_app_user_id() IS NOT NULL);
CREATE POLICY rls_sub_department_admin_write ON public.sub_department FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS rls_function_select ON public."function";
DROP POLICY IF EXISTS rls_function_write ON public."function";
CREATE POLICY rls_function_select ON public."function" FOR SELECT USING (public.can_access_company(company_id));
CREATE POLICY rls_function_write ON public."function" FOR ALL USING (public.can_access_company(company_id)) WITH CHECK (public.can_access_company(company_id));

DROP POLICY IF EXISTS rls_sub_function_select ON public.sub_function;
DROP POLICY IF EXISTS rls_sub_function_write ON public.sub_function;
CREATE POLICY rls_sub_function_select ON public.sub_function FOR SELECT USING (
  public.can_access_company(
    (SELECT f.company_id FROM public."function" f WHERE f.function_id = sub_function.function_id LIMIT 1)
  )
);
CREATE POLICY rls_sub_function_write ON public.sub_function FOR ALL USING (
  public.can_access_company(
    (SELECT f.company_id FROM public."function" f WHERE f.function_id = sub_function.function_id LIMIT 1)
  )
) WITH CHECK (
  public.can_access_company(
    (SELECT f.company_id FROM public."function" f WHERE f.function_id = sub_function.function_id LIMIT 1)
  )
);

DROP POLICY IF EXISTS rls_titles_select ON public.titles;
DROP POLICY IF EXISTS rls_titles_write ON public.titles;
CREATE POLICY rls_titles_select ON public.titles FOR SELECT USING (
  public.can_access_company(
    (
      SELECT f.company_id
      FROM public.sub_function sf
      JOIN public."function" f ON f.function_id = sf.function_id
      WHERE sf.sub_function_id = titles.sub_function_id
      LIMIT 1
    )
  )
);
CREATE POLICY rls_titles_write ON public.titles FOR ALL USING (
  public.can_access_company(
    (
      SELECT f.company_id
      FROM public.sub_function sf
      JOIN public."function" f ON f.function_id = sf.function_id
      WHERE sf.sub_function_id = titles.sub_function_id
      LIMIT 1
    )
  )
) WITH CHECK (
  public.can_access_company(
    (
      SELECT f.company_id
      FROM public.sub_function sf
      JOIN public."function" f ON f.function_id = sf.function_id
      WHERE sf.sub_function_id = titles.sub_function_id
      LIMIT 1
    )
  )
);

-- Error logs (super-admin only)
DROP POLICY IF EXISTS rls_error_logs_read ON public.error_logs;
DROP POLICY IF EXISTS rls_error_logs_write ON public.error_logs;

CREATE POLICY rls_error_logs_read ON public.error_logs
FOR SELECT USING (public.is_super_admin());

CREATE POLICY rls_error_logs_write ON public.error_logs
FOR ALL USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- Grants for app access (subject to RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.categories TO anon;
GRANT SELECT ON public.courses TO anon;

COMMIT;
