-- ============================================================================
-- Migration: 20261014_enterprise_notification_remediation.sql
-- Description: Enterprise Remediation for Notification System:
--              1. Locks down RLS on public.notification_workflows (disables public write).
--              2. Fixes schedule_bulk_notification_jobs_rpc idempotency key.
--              3. Creates get_notification_recipient_context_rpc for single-query context enrichment.
-- ============================================================================

BEGIN;

-- 1. Restrict RLS on notification_workflows to Authenticated Read-Only and Service Role Manage
DO $$ 
BEGIN 
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'notification_workflows' AND policyname = 'rls_notification_workflows_all'
    ) THEN 
        ALTER POLICY "rls_notification_workflows_all" 
        ON public.notification_workflows 
        TO authenticated 
        USING (true) 
        WITH CHECK (false);
    END IF; 
END $$;

DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'notification_workflows' AND policyname = 'rls_notification_workflows_service_manage'
    ) THEN 
        CREATE POLICY "rls_notification_workflows_service_manage" 
        ON public.notification_workflows 
        FOR ALL TO service_role 
        USING (true) 
        WITH CHECK (true);
    END IF; 
END $$;

-- 2. Deterministic Bulk Scheduling RPC with stable idempotency keys
CREATE OR REPLACE FUNCTION schedule_bulk_notification_jobs_rpc(
    p_user_ids UUID[],
    p_notification_type VARCHAR,
    p_metadata JSONB,
    p_assignment_id UUID DEFAULT NULL,
    p_scheduled_at TIMESTAMPTZ DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_scheduled_at TIMESTAMPTZ;
    v_inserted_count INTEGER := 0;
    v_entity_id VARCHAR;
    v_default_company_id UUID;
BEGIN
    v_scheduled_at := COALESCE(p_scheduled_at, NOW());
    v_entity_id := COALESCE(
        p_metadata->>'task_id',
        p_metadata->>'sprint_id',
        p_metadata->>'scenario_id',
        p_metadata->>'module_id',
        p_metadata->>'entity_id',
        p_assignment_id::text,
        'bulk'
    );

    SELECT company_id INTO v_default_company_id FROM public.companies LIMIT 1;

    WITH inserted AS (
        INSERT INTO public.notification_jobs (
            company_id,
            user_id,
            assignment_id,
            notification_type,
            scheduled_at,
            idempotency_key,
            metadata
        )
        SELECT
            COALESCE(u.company_id, v_default_company_id),
            u.user_id,
            p_assignment_id,
            p_notification_type,
            v_scheduled_at,
            u.user_id::text || ':' || p_notification_type || ':' || v_entity_id,
            p_metadata
        FROM public.users u
        WHERE u.user_id = ANY(p_user_ids)
          AND (u.is_active IS NOT FALSE)
          AND COALESCE(u.company_id, v_default_company_id) IS NOT NULL
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
    )
    SELECT COUNT(*) INTO v_inserted_count FROM inserted;

    RETURN v_inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Consolidated High-Performance Learner Context Enrichment RPC
CREATE OR REPLACE FUNCTION get_notification_recipient_context_rpc(
    p_user_id UUID,
    p_company_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_user RECORD;
    v_company_name TEXT := 'Lucid';
    v_manager_name TEXT := 'Manager';
    v_vark RECORD;
    v_vark_style TEXT := 'auditory';
    v_is_visual BOOLEAN := FALSE;
    v_is_auditory BOOLEAN := TRUE;
    v_is_kinesthetic BOOLEAN := FALSE;
    v_is_reading BOOLEAN := FALSE;
    v_cta_label TEXT := 'Listen to 3-Min Audio Recap';
    v_cta_url TEXT := '/learn?mode=audio';
    v_gamification RECORD;
    v_xp INT := 0;
    v_streak INT := 0;
    v_rank INT := 1;
    v_rival_name TEXT := 'the top learner';
    v_points_to_next INT := 50;
    v_streak_expiring_hours INT := 12;
    v_assessment RECORD;
    v_progress RECORD;
    v_res JSONB;
    v_first_name TEXT := 'there';
BEGIN
    -- 1. User Identity
    SELECT u.user_id, u.name, u.email, u.company_id, u.manager_id, COALESCE(u.email_unsubscribed, false) as email_unsubscribed
    INTO v_user
    FROM public.users u
    WHERE u.user_id = p_user_id
    LIMIT 1;

    IF v_user.user_id IS NULL THEN
        RETURN '{}'::jsonb;
    END IF;

    IF v_user.name IS NOT NULL AND length(trim(v_user.name)) > 0 THEN
        v_first_name := split_part(trim(v_user.name), ' ', 1);
    END IF;

    -- Company Name
    IF v_user.company_id IS NOT NULL THEN
        SELECT name INTO v_company_name FROM public.companies WHERE company_id = v_user.company_id LIMIT 1;
        v_company_name := COALESCE(v_company_name, 'Lucid');
    END IF;

    -- Manager Name
    IF v_user.manager_id IS NOT NULL THEN
        SELECT name INTO v_manager_name FROM public.users WHERE user_id = v_user.manager_id LIMIT 1;
        v_manager_name := COALESCE(v_manager_name, 'Manager');
    END IF;

    -- 2. VARK Modality
    SELECT learning_style INTO v_vark
    FROM public.employee_learning_style
    WHERE user_id = p_user_id
    LIMIT 1;

    IF v_vark.learning_style IS NOT NULL THEN
        v_vark_style := lower(v_vark.learning_style);
        v_is_visual := (v_vark_style LIKE '%visual%');
        v_is_kinesthetic := (v_vark_style LIKE '%kinest%');
        v_is_reading := (v_vark_style LIKE '%read%' OR v_vark_style LIKE '%write%');
        v_is_auditory := (v_vark_style LIKE '%auditory%' OR (NOT v_is_visual AND NOT v_is_kinesthetic AND NOT v_is_reading));

        IF v_is_visual THEN
            v_cta_label := 'View Visual Mindmap & Diagrams';
            v_cta_url := '/learn?mode=visual';
        ELSIF v_is_kinesthetic THEN
            v_cta_label := 'Start Interactive Practice Drill';
            v_cta_url := '/gamification/arena';
        ELSIF v_is_reading THEN
            v_cta_label := 'Read Executive Summary & Digest';
            v_cta_url := '/learn?mode=digest';
        END IF;
    END IF;

    -- 3. Gamification
    SELECT total_xp, current_streak_days
    INTO v_gamification
    FROM public.user_gamification_profiles
    WHERE user_id = p_user_id
    LIMIT 1;

    IF v_gamification.total_xp IS NOT NULL THEN
        v_xp := v_gamification.total_xp;
        v_streak := COALESCE(v_gamification.current_streak_days, 0);
    END IF;

    -- Leaderboard position (within same company)
    IF v_user.company_id IS NOT NULL THEN
        SELECT COUNT(*) + 1 INTO v_rank
        FROM public.user_gamification_profiles
        WHERE company_id = v_user.company_id AND total_xp > v_xp;

        -- Find immediate rival ahead
        SELECT split_part(COALESCE(u.name, 'colleague'), ' ', 1), (p.total_xp - v_xp + 1)
        INTO v_rival_name, v_points_to_next
        FROM public.user_gamification_profiles p
        JOIN public.users u ON u.user_id = p.user_id
        WHERE p.company_id = v_user.company_id AND p.total_xp > v_xp
        ORDER BY p.total_xp ASC
        LIMIT 1;

        v_rival_name := COALESCE(v_rival_name, 'the top learner');
        v_points_to_next := COALESCE(GREATEST(10, v_points_to_next), 50);
    END IF;

    v_streak_expiring_hours := GREATEST(1, EXTRACT(HOUR FROM (DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day' - (NOW() AT TIME ZONE 'UTC')))::int);

    -- 4. Latest Assessment
    SELECT score, max_score, feedback
    INTO v_assessment
    FROM public.employee_assessments
    WHERE user_id = p_user_id
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 1;

    -- 5. Latest Curriculum Progress
    SELECT mp.quiz_score, mp.pass_status, pm.title as module_title
    INTO v_progress
    FROM public.module_progress mp
    LEFT JOIN public.processed_modules pm ON pm.processed_module_id = mp.processed_module_id
    WHERE mp.user_id = p_user_id
    ORDER BY mp.completed_at DESC NULLS LAST, mp.started_at DESC NULLS LAST
    LIMIT 1;

    v_res := jsonb_build_object(
        'subscriber.first_name', v_first_name,
        'subscriber.full_name', COALESCE(v_user.name, 'Learner'),
        'subscriber.email', COALESCE(v_user.email, ''),
        'subscriber.company_name', v_company_name,
        'subscriber.manager_name', v_manager_name,
        'subscriber.email_unsubscribed', v_user.email_unsubscribed,
        'vark.primary_style', CASE WHEN v_is_visual THEN 'Visual' WHEN v_is_kinesthetic THEN 'Kinesthetic' WHEN v_is_reading THEN 'Reading/Writing' ELSE 'Auditory' END,
        'vark.is_visual', v_is_visual,
        'vark.is_auditory', v_is_auditory,
        'vark.is_kinesthetic', v_is_kinesthetic,
        'vark.is_reading_writing', v_is_reading,
        'vark.recommended_cta_label', v_cta_label,
        'vark.recommended_cta_url', v_cta_url,
        'gamification.streak_days', v_streak,
        'gamification.xp_points', v_xp,
        'gamification.leaderboard_rank', '#' || v_rank::text,
        'gamification.rival_name', v_rival_name,
        'gamification.points_to_next_rank', v_points_to_next,
        'gamification.streak_expiring_hours', v_streak_expiring_hours,
        'assessment.score', COALESCE(v_assessment.score, 80),
        'assessment.passing_score', 70,
        'assessment.feedback_summary', COALESCE(substring(v_assessment.feedback from 1 for 120), 'Solid conceptual understanding.'),
        'assessment.weak_topic', 'Core Application',
        'assessment.remediation_module', 'Core Module Refresher',
        'curriculum.module_name', COALESCE(v_progress.module_title, 'Core Onboarding Track'),
        'curriculum.progress_percentage', CASE WHEN v_progress.pass_status IS TRUE THEN 100 WHEN v_progress.quiz_score IS NOT NULL THEN v_progress.quiz_score ELSE 50 END,
        'curriculum.minutes_remaining', 15,
        'curriculum.days_left', 3
    );

    RETURN v_res;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
