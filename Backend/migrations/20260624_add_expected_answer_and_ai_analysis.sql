-- Database Migration: Add expected_answer to tasks, and ai_analysis / analysis_status to task_submissions
-- Run this migration in your Supabase SQL Editor

BEGIN;

-- Add expected_answer to tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS expected_answer text;

-- Add ai_analysis and analysis_status to task_submissions
ALTER TABLE task_submissions
  ADD COLUMN IF NOT EXISTS ai_analysis jsonb,
  ADD COLUMN IF NOT EXISTS analysis_status text DEFAULT 'pending';

COMMIT;
