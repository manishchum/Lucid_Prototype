-- ============================================================================
-- Migration: 20261106_add_coach_profile_to_users.sql
-- Description: Adds a dynamic JSONB `coach_profile` column directly to `public.users`.
--              Eliminates the separate coach_user_profiles table so onboarding questions
--              and user responses can change dynamically without schema migrations.
-- ============================================================================

-- 1. Add JSONB column to users table if not exists
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS coach_profile JSONB DEFAULT '{}'::jsonb;

-- 2. Create GIN index for efficient JSON queries
CREATE INDEX IF NOT EXISTS idx_users_coach_profile 
ON public.users USING gin (coach_profile);

-- 3. (Optional) Drop standalone table if previously created
DROP TABLE IF EXISTS public.coach_user_profiles CASCADE;

