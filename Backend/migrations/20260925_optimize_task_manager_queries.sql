-- ============================================================================
-- Migration: 20260925_optimize_task_manager_queries.sql
-- Description: Performance Optimization for Task Manager Endpoints
--              1. Covering indexes for task_assignments, tasks, and submissions
--              2. Stored Function public.get_user_assigned_tasks_v2
--              3. Explicit column projections ONLY (STRICTLY NO SELECT *)
-- ============================================================================

-- ============================================================================
-- PART 1: HIGH-EFFICIENCY COVERING INDEXES
-- ============================================================================

-- 1.1 Task Assignments Company + Status Covering Index
CREATE INDEX IF NOT EXISTS idx_ta_company_status_covering 
  ON public.task_assignments(company_id, status) 
  INCLUDE (assignment_id, level, target_module_id, target_function_id, target_sub_function_id, target_user_ids, due_date, recurrence, total_target_count, created_at);

-- 1.2 Tasks Assignment + Company Covering Index
CREATE INDEX IF NOT EXISTS idx_tasks_assignment_company_covering 
  ON public.tasks(assignment_id, company_id) 
  INCLUDE (task_id, title, description, submission_format, questions, status, bundle_tasks, expected_answer);

-- 1.3 Task Submissions User + Company + Assignment Covering Index
CREATE INDEX IF NOT EXISTS idx_task_subs_user_comp_assign 
  ON public.task_submissions(user_id, company_id, assignment_id) 
  INCLUDE (submission_id, task_id, submission_type, answers, status, score, max_score, submitted_at);

-- 1.4 Child Task Submissions User + Company + Assignment Covering Index
CREATE INDEX IF NOT EXISTS idx_child_task_subs_user_comp_assign 
  ON public.child_task_submissions(user_id, company_id, assignment_id) 
  INCLUDE (submission_id, child_task_id, parent_task_id, submission_type, answers, status, score, max_score, submitted_at);

-- 1.5 Task Submissions Fast User + Task Duplicate / Completion Lookup
CREATE INDEX IF NOT EXISTS idx_task_subs_user_task 
  ON public.task_submissions(user_id, task_id);

-- 1.6 Child Task Submissions Fast User + Child Task Lookup
CREATE INDEX IF NOT EXISTS idx_child_task_subs_user_child 
  ON public.child_task_submissions(user_id, child_task_id);

-- PART 2: PARAMETERIZED STORED FUNCTION: get_user_assigned_tasks_v2
-- Resolves audience, tasks, and user completion status in a single roundtrip.
-- Strictly uses explicit column projections (NO SELECT *).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_assigned_tasks_v2(
    p_user_id UUID,
    p_company_id UUID,
    p_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_func UUID;
    v_user_subfunc UUID;
    v_tasks JSONB;
BEGIN
    -- 1. Fetch user organizational placement with explicit columns
    SELECT u.function_id, u.sub_function_id
    INTO v_user_func, v_user_subfunc
    FROM public.users u
    WHERE u.user_id = p_user_id;

    -- 2. Build task response set
    WITH user_modules AS (
        SELECT lp.module_id
        FROM public.learning_plan lp
        WHERE lp.user_id = p_user_id
    ),
    matched_assignments AS (
        SELECT
            ta.assignment_id,
            ta.company_id,
            ta.level,
            ta.target_module_id,
            ta.target_function_id,
            ta.target_sub_function_id,
            ta.target_user_ids,
            ta.due_date,
            ta.recurrence,
            ta.total_target_count,
            ta.status AS assignment_status,
            ta.created_at
        FROM public.task_assignments ta
        WHERE ta.company_id = p_company_id
          AND ta.status = 'active'
          AND (
              ta.level = 'org'
              OR (
                  ta.level = 'individual'
                  AND ta.target_user_ids IS NOT NULL
                  AND (
                      CASE 
                          WHEN jsonb_typeof(to_jsonb(ta.target_user_ids)) = 'array' 
                          THEN to_jsonb(ta.target_user_ids) ? (p_user_id::text)
                          ELSE FALSE
                      END
                  )
              )
              OR (ta.level = 'function' AND ta.target_function_id = v_user_func)
              OR (ta.level = 'sub_function' AND ta.target_sub_function_id = v_user_subfunc)
              OR (ta.level = 'cohort' AND ta.target_module_id IN (SELECT module_id FROM user_modules))
          )
    ),
    all_user_subs AS (
        SELECT
            ts.submission_id,
            ts.assignment_id,
            ts.company_id,
            ts.user_id,
            ts.task_id,
            NULL::uuid AS child_task_id,
            ts.submission_type,
            ts.text_response,
            ts.image_url,
            ts.audio_url,
            ts.video_url,
            ts.answers,
            ts.score,
            ts.max_score,
            ts.ai_validation_pass,
            ts.ai_validation_verdict,
            ts.ai_validation_reason,
            ts.ai_validation_suggestion,
            ts.ai_validation_confidence,
            ts.ai_status,
            ts.analysis_status,
            ts.status,
            ts.submitted_at
        FROM public.task_submissions ts
        WHERE ts.company_id = p_company_id
          AND ts.user_id = p_user_id
        UNION ALL
        SELECT
            cts.submission_id,
            cts.assignment_id,
            cts.company_id,
            cts.user_id,
            cts.parent_task_id AS task_id,
            cts.child_task_id,
            cts.submission_type,
            cts.text_response,
            cts.image_url,
            cts.audio_url,
            cts.video_url,
            cts.answers,
            cts.score,
            cts.max_score,
            cts.ai_validation_pass,
            cts.ai_validation_verdict,
            cts.ai_validation_reason,
            cts.ai_validation_suggestion,
            cts.ai_validation_confidence,
            cts.ai_status,
            cts.analysis_status,
            cts.status,
            cts.submitted_at
        FROM public.child_task_submissions cts
        WHERE cts.company_id = p_company_id
          AND cts.user_id = p_user_id
    ),
    ordered_subs AS (
        SELECT
            s.assignment_id,
            s.submission_id,
            s.task_id,
            s.child_task_id,
            s.submission_type,
            s.text_response,
            s.image_url,
            s.audio_url,
            s.video_url,
            s.answers,
            s.score,
            s.max_score,
            s.ai_validation_pass,
            s.ai_validation_verdict,
            s.ai_validation_reason,
            s.ai_validation_suggestion,
            s.ai_validation_confidence,
            s.ai_status,
            s.analysis_status,
            s.status,
            s.submitted_at,
            ROW_NUMBER() OVER (PARTITION BY s.assignment_id ORDER BY s.submitted_at DESC NULLS LAST) AS rn
        FROM all_user_subs s
    ),
    assignment_sub_stats AS (
        SELECT
            s.assignment_id,
            COUNT(DISTINCT s.submission_id) AS total_subs,
            COUNT(DISTINCT s.child_task_id) FILTER (WHERE s.child_task_id IS NOT NULL) AS completed_child_count,
            (
                SELECT jsonb_build_object(
                    'submission_id', os.submission_id,
                    'assignment_id', os.assignment_id,
                    'company_id', p_company_id,
                    'user_id', p_user_id,
                    'task_id', os.task_id,
                    'submission_type', os.submission_type,
                    'text_response', os.text_response,
                    'image_url', os.image_url,
                    'audio_url', os.audio_url,
                    'video_url', os.video_url,
                    'answers', os.answers,
                    'status', os.status,
                    'submitted_at', os.submitted_at
                ) || (
                    CASE WHEN p_is_admin THEN jsonb_build_object(
                        'score', os.score,
                        'max_score', os.max_score,
                        'ai_validation_pass', os.ai_validation_pass,
                        'ai_validation_verdict', os.ai_validation_verdict,
                        'ai_validation_reason', os.ai_validation_reason,
                        'ai_validation_suggestion', os.ai_validation_suggestion,
                        'ai_validation_confidence', os.ai_validation_confidence,
                        'ai_status', os.ai_status,
                        'analysis_status', os.analysis_status
                    ) ELSE '{}'::jsonb END
                )
                FROM ordered_subs os
                WHERE os.assignment_id = s.assignment_id AND os.rn = 1
            ) AS latest_sub_json
        FROM all_user_subs s
        GROUP BY s.assignment_id
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'task_id', t.task_id,
                'assignment_id', ma.assignment_id,
                'company_id', p_company_id,
                'title', COALESCE(t.title, ''),
                'description', COALESCE(t.description, ''),
                'submission_format', CASE
                    WHEN jsonb_typeof(to_jsonb(t.submission_format)) = 'array' THEN to_jsonb(t.submission_format)
                    WHEN t.submission_format IS NOT NULL THEN jsonb_build_array(t.submission_format)
                    ELSE '["text"]'::jsonb
                END,
                'questions', COALESCE(t.questions, '[]'::jsonb),
                'bundle_tasks', COALESCE(t.bundle_tasks, '[]'::jsonb),
                'due_date', COALESCE(ma.due_date::text, ''),
                'recurrence', COALESCE(ma.recurrence, 'none'),
                'level', COALESCE(ma.level, ''),
                'audience_display_name', COALESCE(ma.level, ''),
                'total_target_count', COALESCE(ma.total_target_count, 0),
                'completion_count', 0,
                'created_at', COALESCE(ma.created_at::text, ''),
                'target_user_ids', ma.target_user_ids,
                'target_function_id', ma.target_function_id,
                'target_sub_function_id', ma.target_sub_function_id,
                'target_module_id', ma.target_module_id,
                'assignment_status', COALESCE(ma.assignment_status, 'active'),
                'expected_answer', CASE WHEN p_is_admin THEN t.expected_answer ELSE NULL END,
                'submitted', (
                    CASE
                        WHEN t.submission_format::text LIKE '%bundle%' AND jsonb_array_length(COALESCE(t.bundle_tasks, '[]'::jsonb)) > 0 THEN
                            COALESCE(ast.completed_child_count, 0) >= jsonb_array_length(COALESCE(t.bundle_tasks, '[]'::jsonb))
                        ELSE
                            COALESCE(ast.total_subs, 0) > 0
                    END
                ),
                'status', (
                    CASE
                        WHEN (
                            CASE
                                WHEN t.submission_format::text LIKE '%bundle%' AND jsonb_array_length(COALESCE(t.bundle_tasks, '[]'::jsonb)) > 0 THEN
                                    COALESCE(ast.completed_child_count, 0) >= jsonb_array_length(COALESCE(t.bundle_tasks, '[]'::jsonb))
                                ELSE
                                    COALESCE(ast.total_subs, 0) > 0
                            END
                        ) THEN 'completed'
                        ELSE COALESCE(ma.assignment_status, 'active')
                    END
                ),
                'submission', CASE
                    WHEN (
                        CASE
                            WHEN t.submission_format::text LIKE '%bundle%' AND jsonb_array_length(COALESCE(t.bundle_tasks, '[]'::jsonb)) > 0 THEN
                                COALESCE(ast.completed_child_count, 0) >= jsonb_array_length(COALESCE(t.bundle_tasks, '[]'::jsonb))
                            ELSE
                                COALESCE(ast.total_subs, 0) > 0
                        END
                    ) THEN ast.latest_sub_json
                    ELSE NULL
                END
            )
        ),
        '[]'::jsonb
    )
    INTO v_tasks
    FROM matched_assignments ma
    INNER JOIN public.tasks t ON t.assignment_id = ma.assignment_id AND t.company_id = p_company_id
    LEFT JOIN assignment_sub_stats ast ON ast.assignment_id = ma.assignment_id;

    RETURN v_tasks;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.get_user_assigned_tasks_v2(UUID, UUID, BOOLEAN) TO authenticated, service_role, anon;

-- ============================================================================
-- PART 3: REALTIME REPLICATION FOR INSTANT SYNC ACROSS WEB & MOBILE
-- ============================================================================

-- Ensure all task tables are published to the supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'task_submissions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_submissions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'child_task_submissions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.child_task_submissions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'task_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_assignments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
END $$;

-- Set replica identity to full so that realtime payloads include all columns (user_id, status, etc.)
ALTER TABLE public.task_submissions REPLICA IDENTITY FULL;
ALTER TABLE public.child_task_submissions REPLICA IDENTITY FULL;

