-- Migration: Add Role-Play Sessions and Assessments Tables
-- Created: 2026-01-15
-- Purpose: Store role-play conversation transcripts and assessment reports

-- Create roleplay_sessions table
CREATE TABLE IF NOT EXISTS roleplay_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL,
  module_id UUID,
  scenario_id TEXT NOT NULL,
  scenario_title TEXT NOT NULL,
  scenario_role TEXT NOT NULL,
  scenario_difficulty TEXT NOT NULL,
  conversation_transcript JSONB NOT NULL, -- Array of messages with text, sender, timestamp
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER, -- Total conversation duration
  message_count INTEGER, -- Total number of messages exchanged
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create roleplay_assessments table
CREATE TABLE IF NOT EXISTS roleplay_assessments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES roleplay_sessions(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  overall_score INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  summary TEXT NOT NULL,
  parameters JSONB NOT NULL, -- Array of {name, score, feedback}
  recommendations JSONB NOT NULL, -- Array of recommendation strings
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_employee 
ON roleplay_sessions(employee_id);

CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_module 
ON roleplay_sessions(module_id);

CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_scenario 
ON roleplay_sessions(scenario_id);

CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_completed 
ON roleplay_sessions(employee_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_roleplay_assessments_session 
ON roleplay_assessments(session_id);

CREATE INDEX IF NOT EXISTS idx_roleplay_assessments_employee 
ON roleplay_assessments(employee_id);

CREATE INDEX IF NOT EXISTS idx_roleplay_assessments_score 
ON roleplay_assessments(employee_id, overall_score DESC);

-- Add updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers to auto-update updated_at
DROP TRIGGER IF EXISTS update_roleplay_sessions_updated_at ON roleplay_sessions;
CREATE TRIGGER update_roleplay_sessions_updated_at
  BEFORE UPDATE ON roleplay_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_roleplay_assessments_updated_at ON roleplay_assessments;
CREATE TRIGGER update_roleplay_assessments_updated_at
  BEFORE UPDATE ON roleplay_assessments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE roleplay_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roleplay_assessments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for roleplay_sessions
-- Employees can view their own sessions
DROP POLICY IF EXISTS "Employees can view their own roleplay sessions" ON roleplay_sessions;
CREATE POLICY "Employees can view their own roleplay sessions"
ON roleplay_sessions FOR SELECT
USING (employee_id = auth.uid());

-- Employees can insert their own sessions
DROP POLICY IF EXISTS "Employees can insert their own roleplay sessions" ON roleplay_sessions;
CREATE POLICY "Employees can insert their own roleplay sessions"
ON roleplay_sessions FOR INSERT
WITH CHECK (employee_id = auth.uid());

-- Employees can update their own sessions
DROP POLICY IF EXISTS "Employees can update their own roleplay sessions" ON roleplay_sessions;
CREATE POLICY "Employees can update their own roleplay sessions"
ON roleplay_sessions FOR UPDATE
USING (employee_id = auth.uid());

-- RLS Policies for roleplay_assessments
-- Employees can view their own assessments
DROP POLICY IF EXISTS "Employees can view their own roleplay assessments" ON roleplay_assessments;
CREATE POLICY "Employees can view their own roleplay assessments"
ON roleplay_assessments FOR SELECT
USING (employee_id = auth.uid());

-- Employees can insert their own assessments
DROP POLICY IF EXISTS "Employees can insert their own roleplay assessments" ON roleplay_assessments;
CREATE POLICY "Employees can insert their own roleplay assessments"
ON roleplay_assessments FOR INSERT
WITH CHECK (employee_id = auth.uid());

-- Comments for documentation
COMMENT ON TABLE roleplay_sessions IS 'Stores role-play conversation sessions including full transcript';
COMMENT ON TABLE roleplay_assessments IS 'Stores AI-generated performance assessments for role-play sessions';
COMMENT ON COLUMN roleplay_sessions.conversation_transcript IS 'JSONB array of message objects: [{text, sender, timestamp}]';
COMMENT ON COLUMN roleplay_assessments.parameters IS 'JSONB array of performance parameters: [{name, score, feedback}]';
COMMENT ON COLUMN roleplay_assessments.recommendations IS 'JSONB array of improvement recommendations';
