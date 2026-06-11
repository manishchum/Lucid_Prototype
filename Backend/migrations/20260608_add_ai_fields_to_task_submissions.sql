-- Add AI validation and media columns to task_submissions
-- Run this migration against your Supabase/Postgres database

BEGIN;

ALTER TABLE IF EXISTS task_submissions
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS audio_url text,
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS ai_validation_pass boolean,
  ADD COLUMN IF NOT EXISTS ai_validation_verdict text,
  ADD COLUMN IF NOT EXISTS ai_validation_reason text,
  ADD COLUMN IF NOT EXISTS ai_validation_suggestion text,
  ADD COLUMN IF NOT EXISTS ai_validation_confidence text,
  ADD COLUMN IF NOT EXISTS ai_status text;

COMMIT;
