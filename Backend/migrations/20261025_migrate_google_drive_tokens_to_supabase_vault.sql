-- ============================================================================
-- Migration: 20261025_migrate_google_drive_tokens_to_supabase_vault.sql
-- Description: Migrates Google Drive OAuth token storage to Supabase Vault (vault.secrets).
-- OAuth tokens are no longer stored in table columns.
-- ============================================================================

-- 1. Ensure supabase_vault extension is present
CREATE EXTENSION IF NOT EXISTS "supabase_vault" CASCADE;

-- 2. Alter public.google_drive_integrations: add secret references and deprecate plaintext columns
ALTER TABLE public.google_drive_integrations
    ADD COLUMN IF NOT EXISTS access_token_secret_id UUID REFERENCES vault.secrets(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS refresh_token_secret_id UUID REFERENCES vault.secrets(id) ON DELETE SET NULL;

-- Make old token columns nullable and rename to indicate deprecation (or drop where allowed)
ALTER TABLE public.google_drive_integrations
    ALTER COLUMN access_token DROP NOT NULL,
    ALTER COLUMN refresh_token DROP NOT NULL;

-- 3. Stored Procedure: Store/Update Google Drive OAuth tokens in Supabase Vault
CREATE OR REPLACE FUNCTION public.store_google_drive_tokens(
    p_company_id UUID,
    p_access_token TEXT,
    p_refresh_token TEXT,
    p_token_expires_at TIMESTAMPTZ
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
    v_access_secret_id UUID;
    v_refresh_secret_id UUID;
    v_access_name TEXT := 'gdrive_access_token_' || p_company_id::text;
    v_refresh_name TEXT := 'gdrive_refresh_token_' || p_company_id::text;
BEGIN
    -- 1. Check if access token secret exists by name in vault.secrets
    SELECT id INTO v_access_secret_id
    FROM vault.secrets
    WHERE name = v_access_name
    LIMIT 1;

    IF v_access_secret_id IS NOT NULL THEN
        PERFORM vault.update_secret(v_access_secret_id, p_access_token);
    ELSE
        v_access_secret_id := vault.create_secret(
            p_access_token,
            v_access_name,
            'Google Drive OAuth access token for company ' || p_company_id::text
        );
    END IF;

    -- 2. Check if refresh token secret exists by name in vault.secrets
    SELECT id INTO v_refresh_secret_id
    FROM vault.secrets
    WHERE name = v_refresh_name
    LIMIT 1;

    IF p_refresh_token IS NOT NULL AND p_refresh_token <> '' THEN
        IF v_refresh_secret_id IS NOT NULL THEN
            PERFORM vault.update_secret(v_refresh_secret_id, p_refresh_token);
        ELSE
            v_refresh_secret_id := vault.create_secret(
                p_refresh_token,
                v_refresh_name,
                'Google Drive OAuth refresh token for company ' || p_company_id::text
            );
        END IF;
    END IF;

    -- 3. Update google_drive_integrations with secret UUIDs and expiration
    UPDATE public.google_drive_integrations
    SET
        access_token_secret_id = v_access_secret_id,
        refresh_token_secret_id = v_refresh_secret_id,
        token_expires_at = p_token_expires_at,
        updated_at = timezone('utc'::text, now())
    WHERE company_id = p_company_id;

    RETURN jsonb_build_object(
        'access_token_secret_id', v_access_secret_id,
        'refresh_token_secret_id', v_refresh_secret_id,
        'success', true
    );
END;
$$;

-- 4. Stored Procedure: Retrieve decrypted tokens strictly for backend service role
CREATE OR REPLACE FUNCTION public.get_google_drive_tokens(p_company_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
    v_access_secret_id UUID;
    v_refresh_secret_id UUID;
    v_token_expires_at TIMESTAMPTZ;
    v_access_token TEXT;
    v_refresh_token TEXT;
BEGIN
    SELECT access_token_secret_id, refresh_token_secret_id, token_expires_at
    INTO v_access_secret_id, v_refresh_secret_id, v_token_expires_at
    FROM public.google_drive_integrations
    WHERE company_id = p_company_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- If secret_id not saved on row, fallback to lookup by name
    IF v_access_secret_id IS NOT NULL THEN
        SELECT decrypted_secret INTO v_access_token
        FROM vault.decrypted_secrets
        WHERE id = v_access_secret_id;
    ELSE
        SELECT decrypted_secret INTO v_access_token
        FROM vault.decrypted_secrets
        WHERE name = 'gdrive_access_token_' || p_company_id::text
        LIMIT 1;
    END IF;

    IF v_refresh_secret_id IS NOT NULL THEN
        SELECT decrypted_secret INTO v_refresh_token
        FROM vault.decrypted_secrets
        WHERE id = v_refresh_secret_id;
    ELSE
        SELECT decrypted_secret INTO v_refresh_token
        FROM vault.decrypted_secrets
        WHERE name = 'gdrive_refresh_token_' || p_company_id::text
        LIMIT 1;
    END IF;

    RETURN jsonb_build_object(
        'access_token', v_access_token,
        'refresh_token', v_refresh_token,
        'token_expires_at', v_token_expires_at
    );
END;
$$;

-- 5. Stored Procedure: Delete vault secrets when disconnecting
CREATE OR REPLACE FUNCTION public.delete_google_drive_vault_tokens(p_company_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
BEGIN
    DELETE FROM vault.secrets
    WHERE name IN (
        'gdrive_access_token_' || p_company_id::text,
        'gdrive_refresh_token_' || p_company_id::text
    );

    UPDATE public.google_drive_integrations
    SET
        access_token_secret_id = NULL,
        refresh_token_secret_id = NULL,
        updated_at = timezone('utc'::text, now())
    WHERE company_id = p_company_id;

    RETURN true;
END;
$$;

-- 6. Trigger: Automatically cleanup Vault secrets if integration row is deleted
CREATE OR REPLACE FUNCTION public.cleanup_google_drive_vault_secrets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
BEGIN
    DELETE FROM vault.secrets
    WHERE name IN (
        'gdrive_access_token_' || OLD.company_id::text,
        'gdrive_refresh_token_' || OLD.company_id::text
    );
    RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER trg_cleanup_gdrive_vault_secrets
BEFORE DELETE ON public.google_drive_integrations
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_google_drive_vault_secrets();

-- 7. Permissions hardening: strictly service_role only
REVOKE ALL ON FUNCTION public.store_google_drive_tokens(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_google_drive_tokens(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.get_google_drive_tokens(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_google_drive_tokens(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.delete_google_drive_vault_tokens(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_google_drive_vault_tokens(UUID) TO service_role;
