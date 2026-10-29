-- ============================================================================
-- Migration: 20261023_create_sms_delivery_logs.sql
-- Description: Audit and failure tracking for SMS OTP deliveries.
--              Stores status, retry counts, HTTP status codes, provider response 
--              payloads, and error messages for support visibility and telemetry.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.sms_delivery_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone               VARCHAR(30) NOT NULL,
    phone_masked        VARCHAR(30) NOT NULL,
    provider            VARCHAR(50) NOT NULL DEFAULT 'dovesoft',
    status              VARCHAR(30) NOT NULL, -- 'SUCCESS', 'FAILED', 'RETRYING', 'ABORTED'
    status_code         INT NULL,
    response_body       TEXT NULL,
    error_message       TEXT NULL,
    attempt_number      INT NOT NULL DEFAULT 1,
    max_attempts        INT NOT NULL DEFAULT 2,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Efficient indexing for support lookups and status aggregation
CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_phone ON public.sms_delivery_logs(phone);
CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_status ON public.sms_delivery_logs(status);
CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_created_at ON public.sms_delivery_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.sms_delivery_logs ENABLE ROW LEVEL SECURITY;

-- Allow backend service role full access
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'sms_delivery_logs' AND policyname = 'service_role_sms_delivery_logs'
    ) THEN 
        CREATE POLICY "service_role_sms_delivery_logs" 
        ON public.sms_delivery_logs 
        FOR ALL TO service_role 
        USING (true) 
        WITH CHECK (true); 
    END IF; 
END $$;

COMMIT;
