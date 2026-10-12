-- Migration: Add platform_type column to companies table
-- Supported values: 'web', 'mobile', 'both'

ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS platform_type TEXT NOT NULL DEFAULT 'web';

-- Optional: Add check constraint for valid platform types
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'check_companies_platform_type'
    ) THEN
        ALTER TABLE public.companies
        ADD CONSTRAINT check_companies_platform_type
        CHECK (platform_type IN ('web', 'mobile', 'both'));
    END IF;
END $$;
