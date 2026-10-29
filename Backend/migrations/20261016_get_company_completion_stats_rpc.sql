-- ----------------------------------------------------------------------------
-- Migration: Create get_company_completion_stats RPC for server-side aggregation
-- Replaces loading all module_progress rows into Python memory (OOM prevention)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_company_completion_stats(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total BIGINT := 0;
    v_completed BIGINT := 0;
    v_passed BIGINT := 0;
    v_failed BIGINT := 0;
    v_completion_rate NUMERIC := 0;
    v_pass_rate NUMERIC := 0;
BEGIN
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE mp.completed_at IS NOT NULL),
        COUNT(*) FILTER (WHERE mp.pass_status IS TRUE),
        COUNT(*) FILTER (WHERE mp.completed_at IS NOT NULL AND mp.pass_status IS FALSE)
    INTO
        v_total,
        v_completed,
        v_passed,
        v_failed
    FROM public.module_progress mp
    JOIN public.users u ON u.user_id = mp.user_id
    WHERE u.company_id = p_company_id;

    IF v_total > 0 THEN
        v_completion_rate := ROUND((v_completed::numeric / v_total::numeric) * 100, 2);
    END IF;

    IF v_completed > 0 THEN
        v_pass_rate := ROUND((v_passed::numeric / v_completed::numeric) * 100, 2);
    END IF;

    RETURN jsonb_build_object(
        'total', v_total,
        'completed', v_completed,
        'passed', v_passed,
        'failed', v_failed,
        'completion_rate', v_completion_rate,
        'pass_rate', v_pass_rate
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_completion_stats(UUID) TO authenticated, service_role;
