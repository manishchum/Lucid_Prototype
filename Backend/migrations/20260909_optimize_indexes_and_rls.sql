-- ============================================================================
-- Migration: 20260909_optimize_indexes_and_rls.sql
-- Description: High-performance covering indexes and RLS cleanup for production
--              Resolves 504 Gateway Timeouts, unindexed foreign key scans,
--              and slow row-by-row RLS re-evaluations.
-- ============================================================================

-- 1. High-Traffic Covering Indexes (IF NOT EXISTS ensures safe execution)

-- Processed Modules
CREATE INDEX IF NOT EXISTS idx_pm_orig_module_id 
  ON public.processed_modules(original_module_id);

CREATE INDEX IF NOT EXISTS idx_pm_orig_module_created 
  ON public.processed_modules(original_module_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_pm_orig_module_order 
  ON public.processed_modules(original_module_id, order_index ASC);

-- Learning Plan
CREATE INDEX IF NOT EXISTS idx_lp_user_id 
  ON public.learning_plan(user_id);

CREATE INDEX IF NOT EXISTS idx_lp_module_id 
  ON public.learning_plan(module_id);

CREATE INDEX IF NOT EXISTS idx_lp_user_module 
  ON public.learning_plan(user_id, module_id);

CREATE INDEX IF NOT EXISTS idx_lp_user_status 
  ON public.learning_plan(user_id, status, overall_status);

-- Module Progress
CREATE INDEX IF NOT EXISTS idx_mp_user_id 
  ON public.module_progress(user_id);

CREATE INDEX IF NOT EXISTS idx_mp_proc_module 
  ON public.module_progress(processed_module_id);

CREATE INDEX IF NOT EXISTS idx_mp_user_proc_module 
  ON public.module_progress(user_id, processed_module_id);

CREATE INDEX IF NOT EXISTS idx_mp_user_quiz 
  ON public.module_progress(user_id, quiz_score);

-- Training Modules
CREATE INDEX IF NOT EXISTS idx_tm_company_id 
  ON public.training_modules(company_id);

-- User Role Assignments
CREATE INDEX IF NOT EXISTS idx_ura_user_id 
  ON public.user_role_assignments(user_id);

CREATE INDEX IF NOT EXISTS idx_ura_role_id 
  ON public.user_role_assignments(role_id);

CREATE INDEX IF NOT EXISTS idx_ura_user_role_active 
  ON public.user_role_assignments(user_id, role_id, is_active);

-- Users
CREATE INDEX IF NOT EXISTS idx_users_company_id 
  ON public.users(company_id);

CREATE INDEX IF NOT EXISTS idx_users_company_active 
  ON public.users(company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_users_firebase_uid 
  ON public.users(firebase_uid);

CREATE INDEX IF NOT EXISTS idx_users_manager_id 
  ON public.users(manager_id);

-- Tasks & Task Management
CREATE INDEX IF NOT EXISTS idx_tasks_company_id 
  ON public.tasks(company_id);

CREATE INDEX IF NOT EXISTS idx_tasks_assignment_id 
  ON public.tasks(assignment_id);

CREATE INDEX IF NOT EXISTS idx_tasks_created_by 
  ON public.tasks(created_by);

CREATE INDEX IF NOT EXISTS idx_task_assign_company 
  ON public.task_assignments(company_id);

CREATE INDEX IF NOT EXISTS idx_task_assign_subfunc 
  ON public.task_assignments(target_sub_function_id);

CREATE INDEX IF NOT EXISTS idx_task_sub_assignment 
  ON public.task_submissions(assignment_id);

CREATE INDEX IF NOT EXISTS idx_task_sub_user 
  ON public.task_submissions(user_id);

CREATE INDEX IF NOT EXISTS idx_task_sub_company 
  ON public.task_submissions(company_id);

-- Assessments
CREATE INDEX IF NOT EXISTS idx_assessments_company 
  ON public.assessments(company_id);

CREATE INDEX IF NOT EXISTS idx_assessments_orig_mod 
  ON public.assessments(original_module_id);

CREATE INDEX IF NOT EXISTS idx_assessments_proc_mod 
  ON public.assessments(processed_module_id);

-- Gamification
CREATE INDEX IF NOT EXISTS idx_gs_company_id 
  ON public.gamification_sprints(company_id);

CREATE INDEX IF NOT EXISTS idx_gd_sprint_id 
  ON public.gamification_drills(sprint_id);

-- 2. Cleanup Legacy Redundant / Restrictive Policies causing RLS initplan slowdowns
-- (The canonical rls_* policies in 20260907_enable_rls_and_policies.sql handle access properly)

DROP POLICY IF EXISTS tasks_company_isolation ON public.tasks;
DROP POLICY IF EXISTS task_assignments_company_isolation ON public.task_assignments;
DROP POLICY IF EXISTS task_submissions_company_isolation ON public.task_submissions;
DROP POLICY IF EXISTS task_submissions_employee_own ON public.task_submissions;
DROP POLICY IF EXISTS trs_company_isolation ON public.task_report_summaries;
