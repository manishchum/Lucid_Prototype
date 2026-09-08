-- ============================================================================
-- Migration: 20260907_enable_rls_user_sessions_and_manager_reports.sql
-- Description: Enable Row Level Security (RLS) & establish policies on
--              user_sessions and manager_daily_reports.
-- Target DB: Lucid (ref: fmkikkebrxyzjsffqgex)
-- Applied: 2026-09-07
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Table: public.user_sessions
-- ============================================================================
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_user_sessions_select" ON public.user_sessions;
CREATE POLICY rls_user_sessions_select ON public.user_sessions
    AS PERMISSIVE FOR SELECT TO public
    USING (can_access_user(user_id));

DROP POLICY IF EXISTS "rls_user_sessions_write" ON public.user_sessions;
CREATE POLICY rls_user_sessions_write ON public.user_sessions
    AS PERMISSIVE FOR ALL TO public
    USING (can_access_user(user_id))
    WITH CHECK (can_access_user(user_id));

-- ============================================================================
-- 2. Table: public.manager_daily_reports
-- ============================================================================
ALTER TABLE public.manager_daily_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_manager_daily_reports_select" ON public.manager_daily_reports;
CREATE POLICY rls_manager_daily_reports_select ON public.manager_daily_reports
    AS PERMISSIVE FOR SELECT TO public
    USING (can_access_user(manager_id));

DROP POLICY IF EXISTS "rls_manager_daily_reports_write" ON public.manager_daily_reports;
CREATE POLICY rls_manager_daily_reports_write ON public.manager_daily_reports
    AS PERMISSIVE FOR ALL TO public
    USING (can_access_user(manager_id))
    WITH CHECK (can_access_user(manager_id));

COMMIT;
