-- Supabase Migration: Add scheduled_emails table for persistent email scheduling
-- This replaces the SQLite job store with Supabase-backed persistence

-- Drop existing table if it exists (to avoid conflicts)
DROP TABLE IF EXISTS scheduled_emails CASCADE;

-- Create scheduled_emails table
CREATE TABLE scheduled_emails (
    scheduled_email_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    
    -- Email details
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    recipient_emails TEXT[] NOT NULL,  -- Array of email addresses
    
    -- Module reference (optional, for multi-module schedules)
    processed_module_id UUID,
    original_module_id UUID,
    module_title TEXT,
    
    -- Scheduling mode: 'one_time' or 'recurring'
    schedule_type TEXT NOT NULL CHECK (schedule_type IN ('one_time', 'recurring')),
    
    -- For one_time: specific date to send (ISO 8601: YYYY-MM-DD)
    scheduled_date TEXT,
    
    -- For both one_time and recurring: time to send (HH:MM format in UTC)
    scheduled_time TEXT NOT NULL,
    
    -- For recurring: array of day-of-week integers (0=Sun, 1=Mon, ..., 6=Sat)
    days_of_week INTEGER[],
    
    -- Content tracking
    content_types TEXT[],  -- e.g. ["flashcards", "audio"]
    
    -- Custom content (JSON, optional)
    custom_flashcards JSONB,
    custom_audio_url TEXT,
    
    -- Status tracking
    is_active BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'paused', 'cancelled')),
    
    -- Retry handling
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID,
    sent_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for efficient querying
CREATE INDEX idx_scheduled_emails_company_id 
    ON scheduled_emails(company_id);

CREATE INDEX idx_scheduled_emails_status_active 
    ON scheduled_emails(status, is_active)
    WHERE is_active = true;

CREATE INDEX idx_scheduled_emails_one_time_pending
    ON scheduled_emails(scheduled_date, scheduled_time, status)
    WHERE schedule_type = 'one_time' AND status = 'pending' AND is_active = true;

CREATE INDEX idx_scheduled_emails_recurring_active
    ON scheduled_emails(schedule_type, status)
    WHERE schedule_type = 'recurring' AND status = 'pending' AND is_active = true;

-- Enable RLS (Row Level Security)
ALTER TABLE scheduled_emails ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (adjust based on your auth setup)
-- Policy: Users can view scheduled emails from their company
CREATE POLICY "Users can view scheduled emails from their company"
    ON scheduled_emails
    FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM public.users WHERE user_id = auth.uid()
        )
    );

-- Policy: Admins can create scheduled emails for their company
CREATE POLICY "Admins can create scheduled emails"
    ON scheduled_emails
    FOR INSERT
    WITH CHECK (
        company_id IN (
            SELECT company_id FROM public.users WHERE user_id = auth.uid()
        )
    );

-- Policy: Admins can update scheduled emails for their company
CREATE POLICY "Admins can update scheduled emails"
    ON scheduled_emails
    FOR UPDATE
    USING (
        company_id IN (
            SELECT company_id FROM public.users WHERE user_id = auth.uid()
        )
    );

-- Policy: Admins can delete scheduled emails for their company
CREATE POLICY "Admins can delete scheduled emails"
    ON scheduled_emails
    FOR DELETE
    USING (
        company_id IN (
            SELECT company_id FROM public.users WHERE user_id = auth.uid()
        )
    );

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_scheduled_emails_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scheduled_emails_updated_at ON scheduled_emails;

CREATE TRIGGER trg_scheduled_emails_updated_at
    BEFORE UPDATE ON scheduled_emails
    FOR EACH ROW
    EXECUTE FUNCTION update_scheduled_emails_updated_at();
