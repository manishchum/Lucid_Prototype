-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Create scheduled_jobs table for persistent job storage
-- Purpose: Replace APScheduler SQLite store with Supabase-backed persistent storage
-- Run this migration in your Supabase dashboard
-- ─────────────────────────────────────────────────────────────────────────────

-- Create ENUM for job status
CREATE TYPE job_status_enum AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- Create ENUM for job type
CREATE TYPE job_type_enum AS ENUM ('send_email', 'send_whatsapp', 'content_dispatch');

-- Create scheduled_jobs table
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    scheduled_job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type job_type_enum NOT NULL,           -- Type of job (send_email, send_whatsapp, etc)
    status job_status_enum NOT NULL DEFAULT 'pending', -- Current status
    
    -- Job payload (flexible JSON to support different job types)
    payload JSONB NOT NULL,                    -- {recipient_emails, subject, body, etc}
    
    -- Scheduling
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL, -- When to run (UTC)
    run_at TIMESTAMP WITH TIME ZONE,          -- When it actually ran
    
    -- Tracking
    attempt_count INT DEFAULT 0,               -- Number of execution attempts
    max_attempts INT DEFAULT 3,                -- Max retries
    error_message TEXT,                        -- Last error (if failed)
    
    -- Metadata
    module_id UUID,                            -- Associated module (if any)
    company_id UUID,                           -- Associated company (if any)
    created_by UUID,                           -- User who created the job
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Indexes for efficient querying
    CONSTRAINT scheduled_at_is_future CHECK (scheduled_at > NOW() OR status != 'pending')
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_scheduled_at ON scheduled_jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_company_id ON scheduled_jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_job_type ON scheduled_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_pending_due ON scheduled_jobs(scheduled_at)
    WHERE status = 'pending' AND scheduled_at <= NOW();

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_scheduled_jobs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER scheduled_jobs_update_timestamp
    BEFORE UPDATE ON scheduled_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_scheduled_jobs_timestamp();

-- Optional: Add RLS policies if needed
-- ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
-- 
-- CREATE POLICY "Companies can see their own scheduled jobs"
--   ON scheduled_jobs FOR SELECT
--   USING (company_id IN (
--     SELECT company_id FROM user_companies 
--     WHERE user_id = auth.uid()
--   ));
