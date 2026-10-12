-- ============================================================================
-- Migration: 20260925_split_rpc_and_covering_indexes.sql
-- Description: High-Performance Architecture for Employee Dashboard
--              1. Composite Covering Indexes for User & Company Queries
--              2. Split-RPC Architecture (Dynamic User Data vs. Static Company Data)
--              3. Zero-Regressions / Zero Breaking Changes for Mobile & Web
-- ============================================================================

-- ============================================================================
-- PART 1: HIGH-EFFICIENCY COVERING INDEXES
-- ============================================================================

-- 1.1 Learning Plan Covering Index (User Dashboard Query)
CREATE INDEX IF NOT EXISTS idx_lp_user_covering 
  ON public.learning_plan(user_id) 
  INCLUDE (learning_plan_id, module_id, status, priority, due_date, baseline_assessment, completed_at);

-- 1.2 Module Progress Covering Index (Index-Only Progress Scan)
CREATE INDEX IF NOT EXISTS idx_mp_user_lookup_covering 
  ON public.module_progress(user_id, processed_module_id) 
  INCLUDE (module_progress_id, quiz_score, completed_at, pass_status);

-- 1.3 Employee Assessments Score Covering Index
CREATE INDEX IF NOT EXISTS idx_ea_user_scores_covering 
  ON public.employee_assessments(user_id) 
  INCLUDE (assessment_id, score, max_score, completed_at);

-- 1.4 Task Submissions User & Company Compound Index
CREATE INDEX IF NOT EXISTS idx_ts_user_company_covering 
  ON public.task_submissions(user_id, company_id) 
  INCLUDE (submission_id, task_id, score, status, submitted_at);

-- 1.5 Employee Learning Style Fast Lookup
CREATE INDEX IF NOT EXISTS idx_els_user_covering 
  ON public.employee_learning_style(user_id) 
  INCLUDE (learning_style);

-- 1.6 Partial Index on Active Users (Instantly counts active company users)
CREATE INDEX IF NOT EXISTS idx_users_company_active_partial 
  ON public.users(company_id) 
  WHERE is_active = true;

-- 1.7 Training Modules Company Covering Index
CREATE INDEX IF NOT EXISTS idx_tm_company_covering 
  ON public.training_modules(company_id) 
  INCLUDE (module_id, title, content_type, processing_status, created_at);

-- 1.8 Processed Modules Join & Order Index
CREATE INDEX IF NOT EXISTS idx_pm_join_order_covering 
  ON public.processed_modules(original_module_id, order_index ASC) 
  INCLUDE (processed_module_id, title);

-- 1.9 Assessments Company Covering Index
CREATE INDEX IF NOT EXISTS idx_assessments_company_covering 
  ON public.assessments(company_id) 
  INCLUDE (assessment_id, processed_module_id, original_module_id, type);


-- ============================================================================
-- PART 2: DYNAMIC USER DASHBOARD RPC (Target: < 50ms)
-- Only fetches rows that belong to p_user_id. Bypasses company-wide catalog scans.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_dashboard_dynamic_data(
    p_user_id UUID,
    p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'learning_style', (
            SELECT learning_style
            FROM employee_learning_style
            WHERE user_id = p_user_id
            LIMIT 1
        ),
        'learning_plans', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'learning_plan_id', learning_plan_id,
                'user_id', user_id,
                'module_id', module_id,
                'assigned_on', assigned_on,
                'started_at', started_at,
                'status', status,
                'priority', priority,
                'due_date', due_date,
                'baseline_assessment', baseline_assessment,
                'processed_module_ids', processed_module_ids,
                'plan_json', plan_json,
                'overall_status', overall_status,
                'completed_at', completed_at
            ))
            FROM learning_plan
            WHERE user_id = p_user_id
        ), '[]'::jsonb),
        'module_progress', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'module_progress_id', module_progress_id,
                'user_id', user_id,
                'processed_module_id', processed_module_id,
                'started_at', started_at,
                'completed_at', completed_at,
                'pass_status', pass_status,
                'quiz_score', quiz_score,
                'quiz_feedback', quiz_feedback,
                'viewed_at', viewed_at,
                'audio_listen_duration', audio_listen_duration
            ))
            FROM module_progress
            WHERE user_id = p_user_id
        ), '[]'::jsonb),
        'employee_assessments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'assessment_id', assessment_id,
                'score', score,
                'max_score', max_score,
                'completed_at', completed_at
            ))
            FROM employee_assessments
            WHERE user_id = p_user_id
        ), '[]'::jsonb),
        'task_submissions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'submission_id', submission_id,
                'assignment_id', assignment_id,
                'company_id', company_id,
                'user_id', user_id,
                'task_id', task_id,
                'submission_type', submission_type,
                'text_response', text_response,
                'image_url', image_url,
                'audio_url', audio_url,
                'video_url', video_url,
                'answers', answers,
                'score', score,
                'max_score', max_score,
                'status', status,
                'submitted_at', submitted_at
            ))
            FROM task_submissions
            WHERE user_id = p_user_id AND company_id = p_company_id
        ), '[]'::jsonb)
    ) INTO result;

    RETURN result;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.get_user_dashboard_dynamic_data(UUID, UUID) TO authenticated, service_role, anon;


-- ============================================================================
-- PART 3: COMPANY STATIC DASHBOARD DATA RPC (Cached 1 Hour in Redis)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_company_static_dashboard_data(
    p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'company', (
            SELECT jsonb_build_object(
                'company_id', company_id,
                'name', name,
                'company_logo', company_logo,
                'subscription_tier', subscription_tier,
                'subscription_addons', subscription_addons,
                'learning_style', learning_style,
                'created_at', created_at
            )
            FROM companies
            WHERE company_id = p_company_id
            LIMIT 1
        ),
        'total_users', (
            SELECT COUNT(*)::INT
            FROM users
            WHERE company_id = p_company_id AND is_active = true
        ),
        'training_modules', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'module_id', module_id,
                'company_id', company_id,
                'title', title,
                'description', description,
                'content_type', content_type,
                'content_url', content_url,
                'processing_status', processing_status,
                'threshold_value', threshold_value,
                'created_at', created_at
            ))
            FROM training_modules
            WHERE company_id = p_company_id
        ), '[]'::jsonb),
        'processed_modules', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'processed_module_id', pm.processed_module_id,
                'original_module_id', pm.original_module_id,
                'title', pm.title,
                'order_index', pm.order_index
            ) ORDER BY pm.order_index ASC)
            FROM processed_modules pm
            INNER JOIN training_modules tm ON tm.module_id = pm.original_module_id
            WHERE tm.company_id = p_company_id
        ), '[]'::jsonb),
        'assessments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'assessment_id', assessment_id,
                'processed_module_id', processed_module_id,
                'original_module_id', original_module_id,
                'type', type
            ))
            FROM assessments
            WHERE company_id = p_company_id
        ), '[]'::jsonb)
    ) INTO result;

    RETURN result;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.get_company_static_dashboard_data(UUID) TO authenticated, service_role, anon;
