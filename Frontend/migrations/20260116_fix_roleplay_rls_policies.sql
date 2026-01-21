-- Migration: Fix Role-Play RLS Policies
-- Created: 2026-01-16
-- Purpose: Update RLS policies to work with application's employee_id logic

-- Drop existing policies
DROP POLICY IF EXISTS "Employees can view their own roleplay sessions" ON roleplay_sessions;
DROP POLICY IF EXISTS "Employees can insert their own roleplay sessions" ON roleplay_sessions;
DROP POLICY IF EXISTS "Employees can update their own roleplay sessions" ON roleplay_sessions;
DROP POLICY IF EXISTS "Employees can view their own roleplay assessments" ON roleplay_assessments;
DROP POLICY IF EXISTS "Employees can insert their own roleplay assessments" ON roleplay_assessments;

-- Create new policies that work with email-based employee lookup
-- For roleplay_sessions
CREATE POLICY "Users can view roleplay sessions"
ON roleplay_sessions FOR SELECT
USING (
  employee_id IN (
    SELECT user_id FROM users WHERE email = auth.jwt() ->> 'email'
  )
);

CREATE POLICY "Users can insert roleplay sessions"
ON roleplay_sessions FOR INSERT
WITH CHECK (
  employee_id IN (
    SELECT user_id FROM users WHERE email = auth.jwt() ->> 'email'
  )
);

CREATE POLICY "Users can update roleplay sessions"
ON roleplay_sessions FOR UPDATE
USING (
  employee_id IN (
    SELECT user_id FROM users WHERE email = auth.jwt() ->> 'email'
  )
);

-- For roleplay_assessments
CREATE POLICY "Users can view roleplay assessments"
ON roleplay_assessments FOR SELECT
USING (
  employee_id IN (
    SELECT user_id FROM users WHERE email = auth.jwt() ->> 'email'
  )
);

CREATE POLICY "Users can insert roleplay assessments"
ON roleplay_assessments FOR INSERT
WITH CHECK (
  employee_id IN (
    SELECT user_id FROM users WHERE email = auth.jwt() ->> 'email'
  )
);

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE ON roleplay_sessions TO authenticated;
GRANT SELECT, INSERT ON roleplay_assessments TO authenticated;

-- Alternatively, if the above policies are too complex, we can use service role for backend operations
-- and create simpler policies that allow authenticated users to access their data

-- Comment: If the above policies cause performance issues, consider:
-- 1. Creating a function to get current user's employee_id
-- 2. Using that in simpler policies
-- 3. Or using service role key on the backend for database operations
