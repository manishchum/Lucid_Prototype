-- ============================================================================
-- Migration: 20261031_create_currency_exchange_rates_table.sql
-- Description: Creates currency_exchange_rates table to store annual exchange rates
--              (e.g., 2026 -> 95, 2027 -> 96). Preserves historical audit records
--              while allowing queries to automatically pick the latest active rate.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.currency_exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    to_currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    year INTEGER NOT NULL,
    rate NUMERIC(10, 4) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_currency_pair_year UNIQUE (from_currency, to_currency, year)
);

-- Fast index for fetching the latest active exchange rate
CREATE INDEX IF NOT EXISTS idx_currency_exchange_lookup 
ON public.currency_exchange_rates (from_currency, to_currency, is_active, year DESC);

-- Seed initial 2026 exchange rate (95.00)
INSERT INTO public.currency_exchange_rates (from_currency, to_currency, year, rate, is_active, notes)
VALUES ('USD', 'INR', 2026, 95.00, true, 'Annual exchange rate for 2026')
ON CONFLICT (from_currency, to_currency, year) DO UPDATE
SET rate = EXCLUDED.rate,
    is_active = EXCLUDED.is_active,
    notes = EXCLUDED.notes,
    updated_at = timezone('utc'::text, now());

-- Enable Row Level Security (RLS)
ALTER TABLE public.currency_exchange_rates ENABLE ROW LEVEL SECURITY;

-- Allow read access to all clients
DROP POLICY IF EXISTS "rls_currency_exchange_rates_select" ON public.currency_exchange_rates;
CREATE POLICY rls_currency_exchange_rates_select ON public.currency_exchange_rates
    FOR SELECT TO public USING (true);

-- Allow modify access only to super admins / service role
DROP POLICY IF EXISTS "rls_currency_exchange_rates_write" ON public.currency_exchange_rates;
CREATE POLICY rls_currency_exchange_rates_write ON public.currency_exchange_rates
    FOR ALL TO public
    USING (is_super_admin())
    WITH CHECK (is_super_admin());

COMMIT;
