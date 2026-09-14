-- ============================================================================
-- Migration: 20260908_create_dashboard_rpc.sql
-- Description: Ultra-fast single-roundtrip aggregation function for employee dashboard summary
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_employee_dashboard_summary(
    p_user_id UUID,
    p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plans JSONB;
    v_modules JSONB;
    v_progress JSONB;
    v_company JSONB;
    v_total_users INT;
    v_learning_style TEXT;
    v_employee_assessments JSONB;
    v_task_submissions JSONB;
    v_result JSONB;
BEGIN
    -- 1. Company details
    SELECT to_jsonb(c) INTO v_company
    FROM public.companies c
    WHERE c.company_id = p_company_id
    LIMIT 1;

    -- 2. Total company users count
    SELECT COUNT(*)::INT INTO v_total_users
    FROM public.users u
    WHERE u.company_id = p_company_id;

    -- 3. Learning Style
    SELECT els.learning_style INTO v_learning_style
    FROM public.employee_learning_style els
    WHERE els.user_id = p_user_id
    LIMIT 1;

    -- 4. Learning Plans
    SELECT COALESCE(jsonb_agg(to_jsonb(lp)), '[]'::jsonb) INTO v_plans
    FROM public.learning_plan lp
    WHERE lp.user_id = p_user_id;

    -- 5. Training Modules
    SELECT COALESCE(jsonb_agg(to_jsonb(tm)), '[]'::jsonb) INTO v_modules
    FROM public.training_modules tm
    WHERE tm.company_id = p_company_id;

    -- 6. Module Progress
    SELECT COALESCE(jsonb_agg(to_jsonb(mp)), '[]'::jsonb) INTO v_progress
    FROM public.module_progress mp
    WHERE mp.user_id = p_user_id;

    -- 7. Employee Assessments
    SELECT COALESCE(jsonb_agg(to_jsonb(ea)), '[]'::jsonb) INTO v_employee_assessments
    FROM public.employee_assessments ea
    WHERE ea.user_id = p_user_id;

    -- 8. Task Submissions
    SELECT COALESCE(jsonb_agg(to_jsonb(ts)), '[]'::jsonb) INTO v_task_submissions
    FROM public.task_submissions ts
    WHERE ts.user_id = p_user_id AND ts.company_id = p_company_id;

    -- Combine into single consolidated JSONB response
    v_result := jsonb_build_object(
        'company', COALESCE(v_company, '{}'::jsonb),
        'total_users', COALESCE(v_total_users, 0),
        'learning_style', v_learning_style,
        'plans', v_plans,
        'modules', v_modules,
        'progress', v_progress,
        'employee_assessments', v_employee_assessments,
        'task_submissions', v_task_submissions
    );

    RETURN v_result;
END;
$$;
