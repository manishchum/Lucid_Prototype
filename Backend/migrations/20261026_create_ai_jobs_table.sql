-- ============================================================================
-- Migration: 20261026_create_ai_jobs_table.sql
-- Description: Unified AI asynchronous jobs table for long-running workflows:
--              - Content generation (RAG ingestion + downstream dispatch)
--              - Video generation (diffusers / TTS / ffmpeg pipeline)
--              - Email generation (LLM generation)
--              Provides durable persistence, status tracking, and audit history.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type            VARCHAR(60) NOT NULL, -- 'content_generation', 'email_generation', 'video_generation'
    user_id             UUID NULL REFERENCES public.users(user_id) ON DELETE SET NULL,
    status              VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    progress            INT NOT NULL DEFAULT 0, -- 0 to 100
    params              JSONB NOT NULL DEFAULT '{}'::jsonb,
    result              JSONB NULL,
    error               TEXT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_id ON public.ai_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON public.ai_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_job_type ON public.ai_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_created_at ON public.ai_jobs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;

-- Service role full access
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'ai_jobs' AND policyname = 'service_role_ai_jobs'
    ) THEN 
        CREATE POLICY "service_role_ai_jobs" 
        ON public.ai_jobs 
        FOR ALL TO service_role 
        USING (true) 
        WITH CHECK (true); 
    END IF; 
END $$;

-- Authenticated users can view their own jobs
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'ai_jobs' AND policyname = 'users_read_own_ai_jobs'
    ) THEN 
        CREATE POLICY "users_read_own_ai_jobs" 
        ON public.ai_jobs 
        FOR SELECT TO authenticated 
        USING (auth.uid() = user_id); 
    END IF; 
END $$;

COMMIT;
