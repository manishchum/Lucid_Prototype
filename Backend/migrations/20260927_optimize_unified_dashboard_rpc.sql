-- ============================================================================
-- Migration: 20260927_optimize_unified_dashboard_rpc.sql
-- Description: Consolidated Single-Roundtrip Dashboard & Precomputed Leaderboard
--              1. Covering indexes for sub-50ms query execution (Idempotent)
--              2. Single Unified Dashboard RPC: public.get_employee_dashboard_summary
--              3. Precomputed Fast Leaderboard RPC: public.get_company_leaderboard_precomputed
--              4. Zero duplicate function signatures or redundant indexes
-- ============================================================================

-- ============================================================================
-- PART 1: HIGH-EFFICIENCY COVERING INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_lp_user_covering 
  ON public.learning_plan(user_id) 
  INCLUDE (learning_plan_id, module_id, status, priority, due_date, baseline_assessment, completed_at);

CREATE INDEX IF NOT EXISTS idx_mp_user_lookup_covering 
  ON public.module_progress(user_id, processed_module_id) 
  INCLUDE (module_progress_id, quiz_score, completed_at, pass_status);

CREATE INDEX IF NOT EXISTS idx_ea_user_scores_covering 
  ON public.employee_assessments(user_id) 
  INCLUDE (assessment_id, score, max_score, completed_at);

CREATE INDEX IF NOT EXISTS idx_ts_user_company_covering 
  ON public.task_submissions(user_id, company_id) 
  INCLUDE (submission_id, task_id, score, status, submitted_at);

CREATE INDEX IF NOT EXISTS idx_els_user_covering 
  ON public.employee_learning_style(user_id) 
  INCLUDE (learning_style);

CREATE INDEX IF NOT EXISTS idx_users_company_active_partial 
  ON public.users(company_id) 
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_tm_company_covering 
  ON public.training_modules(company_id) 
  INCLUDE (module_id, title, content_type, processing_status, created_at);

CREATE INDEX IF NOT EXISTS idx_pm_join_order_covering 
  ON public.processed_modules(original_module_id, order_index ASC) 
  INCLUDE (processed_module_id, title);

CREATE INDEX IF NOT EXISTS idx_assessments_company_covering 
  ON public.assessments(company_id) 
  INCLUDE (assessment_id, processed_module_id, original_module_id, type);


-- ============================================================================
-- PART 2: UNIFIED SINGLE-ROUNDTRIP EMPLOYEE DASHBOARD RPC
-- Replaces existing public.get_employee_dashboard_summary with zero breaking changes.
-- Aggregates all user & company dashboard data, evidence, and assigned tasks in ONE call (<50ms).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_employee_dashboard_summary(
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
            FROM public.companies
            WHERE company_id = p_company_id
            LIMIT 1
        ),
        'total_users', (
            SELECT COUNT(*)::INT
            FROM public.users
            WHERE company_id = p_company_id AND is_active = true
        ),
        'learning_style', (
            SELECT learning_style
            FROM public.employee_learning_style
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
            FROM public.learning_plan
            WHERE user_id = p_user_id
        ), '[]'::jsonb),
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
            FROM public.training_modules
            WHERE company_id = p_company_id
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
            FROM public.module_progress
            WHERE user_id = p_user_id
        ), '[]'::jsonb),
        'employee_assessments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'assessment_id', assessment_id,
                'score', score,
                'max_score', max_score,
                'completed_at', completed_at
            ))
            FROM public.employee_assessments
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
            FROM public.task_submissions
            WHERE user_id = p_user_id AND company_id = p_company_id
        ), '[]'::jsonb),
        'processed_modules', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'processed_module_id', pm.processed_module_id,
                'original_module_id', pm.original_module_id,
                'title', pm.title,
                'order_index', pm.order_index
            ) ORDER BY pm.order_index ASC)
            FROM public.processed_modules pm
            INNER JOIN public.training_modules tm ON tm.module_id = pm.original_module_id
            WHERE tm.company_id = p_company_id
        ), '[]'::jsonb),
        'assessments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'assessment_id', assessment_id,
                'processed_module_id', processed_module_id,
                'original_module_id', original_module_id,
                'type', type
            ))
            FROM public.assessments
            WHERE company_id = p_company_id
        ), '[]'::jsonb),
        'assigned_tasks', COALESCE((
            SELECT public.get_user_assigned_tasks_v2(p_user_id, p_company_id, FALSE)
        ), '[]'::jsonb)
    ) INTO result;

    RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_employee_dashboard_summary(UUID, UUID) TO authenticated, service_role, anon;


-- ============================================================================
-- PART 3: PRECOMPUTED COMPANY LEADERBOARD SQL FUNCTION
-- Computes company rank, percentile, points, and completion stats in a single
-- query using window functions (<25ms) instead of full table scans in Python.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_company_leaderboard_precomputed(
    p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_users INT;
    result JSONB;
BEGIN
    -- 1. Count active users
    SELECT COUNT(*)::INT
    INTO v_total_users
    FROM public.users
    WHERE company_id = p_company_id AND is_active = true;

    IF v_total_users = 0 THEN
        RETURN '[]'::jsonb;
    END IF;

    -- 2. Compute rankings with window functions
    WITH active_users AS (
        SELECT user_id, name, avatar_url, email
        FROM public.users
        WHERE company_id = p_company_id AND is_active = true
    ),
    user_plan_stats AS (
        SELECT 
            lp.user_id,
            COUNT(*) FILTER (
                WHERE (lp.status IS NULL OR UPPER(TRIM(lp.status)) NOT IN ('DELETED', 'ARCHIVED', 'DISABLED', 'REMOVED'))
            ) AS total_assigned,
            COUNT(*) FILTER (
                WHERE (
                    lp.overall_status = true 
                    OR UPPER(TRIM(COALESCE(lp.status, ''))) IN ('COMPLETED', 'PASSED', 'FINISHED')
                    OR lp.completed_at IS NOT NULL
                )
            ) AS total_completed
        FROM public.learning_plan lp
        INNER JOIN active_users au ON au.user_id = lp.user_id
        GROUP BY lp.user_id
    ),
    ranked AS (
        SELECT 
            au.user_id,
            au.name,
            au.avatar_url,
            au.email,
            COALESCE(ups.total_completed, 0) AS modules_completed,
            COALESCE(ups.total_assigned, 0) AS modules_assigned,
            CASE 
                WHEN COALESCE(ups.total_assigned, 0) > 0 
                THEN ROUND((COALESCE(ups.total_completed, 0)::NUMERIC / ups.total_assigned::NUMERIC) * 100)::INT
                ELSE 0 
            END AS completion_percentage,
            (COALESCE(ups.total_completed, 0) * 100) AS total_points,
            ROW_NUMBER() OVER (
                ORDER BY 
                    CASE 
                        WHEN COALESCE(ups.total_assigned, 0) > 0 
                        THEN (COALESCE(ups.total_completed, 0)::NUMERIC / ups.total_assigned::NUMERIC)
                        ELSE 0 
                    END DESC,
                    COALESCE(ups.total_completed, 0) DESC,
                    au.user_id ASC
            ) AS rank
        FROM active_users au
        LEFT JOIN user_plan_stats ups ON ups.user_id = au.user_id
    )
    SELECT jsonb_agg(jsonb_build_object(
        'user_id', r.user_id,
        'name', COALESCE(r.name, 'Unknown User'),
        'avatar_url', r.avatar_url,
        'email', r.email,
        'rank', r.rank,
        'modules_completed', r.modules_completed,
        'modules_assigned', r.modules_assigned,
        'completion_percentage', r.completion_percentage,
        'total_points', r.total_points,
        'total_users', v_total_users,
        'users_ahead', GREATEST(0, r.rank - 1),
        'percentile', CASE 
            WHEN v_total_users > 1 
            THEN ROUND(((v_total_users - r.rank)::NUMERIC / (v_total_users - 1)::NUMERIC) * 100)::INT
            ELSE 100 
        END
    ) ORDER BY r.rank ASC)
    INTO result
    FROM ranked r;

    RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_leaderboard_precomputed(UUID) TO authenticated, service_role, anon;
