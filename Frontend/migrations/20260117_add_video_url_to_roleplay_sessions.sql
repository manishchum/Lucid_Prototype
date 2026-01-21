-- Migration: Add video_url column to roleplay_sessions
-- Created: 2026-01-17
-- Purpose: Store video recording URL for roleplay sessions

-- Add video_url column to roleplay_sessions table
ALTER TABLE roleplay_sessions 
ADD COLUMN IF NOT EXISTS video_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN roleplay_sessions.video_url IS 'Public URL to the recorded video of the roleplay session stored in Supabase Storage';

-- Create index for faster lookups when filtering by video existence
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_has_video 
ON roleplay_sessions(employee_id, completed_at DESC) 
WHERE video_url IS NOT NULL;
