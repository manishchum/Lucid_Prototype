-- Migration: add dedupe support to error_logs
-- Adds dedupe_key, occurrences, last_seen, created_at and an upsert helper function

BEGIN;

ALTER TABLE IF EXISTS public.error_logs
  ADD COLUMN IF NOT EXISTS dedupe_key text;

ALTER TABLE IF EXISTS public.error_logs
  ADD COLUMN IF NOT EXISTS occurrences integer DEFAULT 1;

ALTER TABLE IF EXISTS public.error_logs
  ADD COLUMN IF NOT EXISTS last_seen timestamptz DEFAULT now();

ALTER TABLE IF EXISTS public.error_logs
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- create unique index for dedupe key to allow upsert on conflict
CREATE UNIQUE INDEX IF NOT EXISTS idx_error_logs_dedupe_key ON public.error_logs(dedupe_key);

-- helper function to insert or increment occurrences atomically
CREATE OR REPLACE FUNCTION public.log_error_dedupe(p jsonb)
  RETURNS void AS
$$
BEGIN
  INSERT INTO public.error_logs(
    dedupe_key, email_id, error, stack_trace, error_type, browser, os, device, action, page_url, occurrences, last_seen, created_at
  ) VALUES (
    p ->> 'dedupe_key',
    NULLIF(p ->> 'email_id',''),
    p ->> 'error',
    NULLIF(p ->> 'stack_trace',''),
    NULLIF(p ->> 'error_type',''),
    NULLIF(p ->> 'browser',''),
    NULLIF(p ->> 'os',''),
    NULLIF(p ->> 'device',''),
    NULLIF(p ->> 'action',''),
    NULLIF(p ->> 'page_url',''),
    COALESCE((p ->> 'occurrences')::int, 1),
    COALESCE(NULLIF(p ->> 'last_seen','')::timestamptz, now()),
    COALESCE(NULLIF(p ->> 'created_at','')::timestamptz, now())
  )
  ON CONFLICT (dedupe_key) DO UPDATE
    SET occurrences = public.error_logs.occurrences + 1,
        last_seen = now();
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMIT;
