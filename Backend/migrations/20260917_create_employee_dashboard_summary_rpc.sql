-- Migration: Create get_employee_dashboard_summary RPC stored function for ultra-fast single-roundtrip dashboard summary data aggregation
-- Date: 2026-09-17

CREATE OR REPLACE FUNCTION get_employee_dashboard_summary(
    p_user_id UUID,
    p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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
            WHERE company_id = p_company_id
        ),
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
        ), '[]'::jsonb),
        'processed_modules', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'processed_module_id', processed_module_id,
                'original_module_id', original_module_id,
                'title', title,
                'order_index', order_index
            ))
            FROM processed_modules
            WHERE original_module_id IN (
                SELECT module_id FROM training_modules WHERE company_id = p_company_id
            )
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
