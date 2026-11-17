-- ============================================================================
-- Migration: 20261028_create_unified_connectors_schema.sql
-- Description: Unified polymorphic multi-connector schema for Google Drive,
--              OneDrive, Slack, Teams, Zoom, Gmail, etc.
-- ============================================================================

-- 1. Ensure extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" CASCADE;

-- 2. Master Company Integrations table (Polymorphic across all providers)
CREATE TABLE IF NOT EXISTS public.company_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    provider TEXT NOT NULL,                                       -- 'google_drive', 'onedrive', 'slack', 'teams', 'gmail', 'zoom'
    status TEXT NOT NULL DEFAULT 'active',                        -- 'active', 'disconnected', 'error', 'syncing'
    connected_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
    account_identifier TEXT NOT NULL,                             -- email or workspace/team ID
    access_token_secret_id UUID REFERENCES vault.secrets(id) ON DELETE SET NULL,
    refresh_token_secret_id UUID REFERENCES vault.secrets(id) ON DELETE SET NULL,
    token_expires_at TIMESTAMPTZ,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,                    -- Provider-specific config (webhooks, drive IDs, channel names)
    last_synced_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_company_provider UNIQUE (company_id, provider)
);

-- 3. Monitored Sources / Containers table (Folders, Shared Drives, Channels)
CREATE TABLE IF NOT EXISTS public.integration_monitored_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES public.company_integrations(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,                                      -- Drive folder_id, Shared Drive ID, Slack channel ID
    source_type TEXT NOT NULL DEFAULT 'folder',                   -- 'folder', 'shared_drive', 'channel', 'calendar'
    source_name TEXT NOT NULL,                                    -- 'Sales Coaching 2026', '#general'
    source_path TEXT NOT NULL DEFAULT '/',                        -- Canonical hierarchy path e.g. '/Shared Drives/Sales/Coaching'
    is_recursive BOOLEAN NOT NULL DEFAULT true,                   -- Auto-sync all nested subfolders
    sync_cursor TEXT,                                             -- Delta change cursor or page_token
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,                  -- Cached ancestor maps, subfolder IDs, permissions
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_integration_source UNIQUE (integration_id, source_id)
);

-- 4. Synced Items Registry table (Documents, Spreadsheets, Transcripts, Messages)
CREATE TABLE IF NOT EXISTS public.integration_synced_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES public.company_integrations(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,                                      -- Root monitored container ID
    external_item_id TEXT NOT NULL,                               -- Google Drive file ID, Slack ts
    item_name TEXT NOT NULL,                                      -- 'Evaluation_Report.pdf'
    item_type TEXT NOT NULL,                                      -- 'pdf', 'xlsx', 'docx', 'csv'
    item_path TEXT,                                               -- Subtree relative path e.g. '2026/Q3/report.pdf'
    parent_external_id TEXT,                                      -- Immediate parent folder ID
    size_bytes BIGINT,
    content_hash TEXT NOT NULL,                                   -- MD5 or SHA256 content checksum
    external_modified_time TIMESTAMPTZ,
    coach_document_id UUID REFERENCES public.coach_uploaded_documents(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'completed',                     -- 'completed', 'processing', 'failed', 'deleted'
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    synced_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_integration_item_hash UNIQUE (integration_id, external_item_id, content_hash)
);

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_company_integrations_provider ON public.company_integrations(company_id, provider);
CREATE INDEX IF NOT EXISTS idx_company_integrations_channel ON public.company_integrations((config->>'webhook_channel_id'));
CREATE INDEX IF NOT EXISTS idx_monitored_sources_integration ON public.integration_monitored_sources(integration_id);
CREATE INDEX IF NOT EXISTS idx_monitored_sources_company_source ON public.integration_monitored_sources(company_id, source_id);
CREATE INDEX IF NOT EXISTS idx_synced_items_integration_item ON public.integration_synced_items(integration_id, external_item_id);
CREATE INDEX IF NOT EXISTS idx_synced_items_coach_doc ON public.integration_synced_items(coach_document_id);

-- 6. Safe Data Migration from legacy Google Drive tables (if existing)
DO $$
DECLARE
    r RECORD;
    v_new_integration_id UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'google_drive_integrations') THEN
        FOR r IN SELECT * FROM public.google_drive_integrations LOOP
            -- Upsert into company_integrations
            INSERT INTO public.company_integrations (
                id,
                company_id,
                provider,
                status,
                connected_by,
                account_identifier,
                access_token_secret_id,
                refresh_token_secret_id,
                token_expires_at,
                config,
                last_synced_at,
                error_message,
                created_at,
                updated_at
            ) VALUES (
                r.id,
                r.company_id,
                'google_drive',
                r.sync_status,
                r.connected_by,
                r.google_account_email,
                r.access_token_secret_id,
                r.refresh_token_secret_id,
                r.token_expires_at,
                jsonb_build_object(
                    'folder_id', r.folder_id,
                    'folder_name', r.folder_name,
                    'webhook_channel_id', r.webhook_channel_id,
                    'webhook_resource_id', r.webhook_resource_id,
                    'webhook_expiration', r.webhook_expiration,
                    'last_page_token', r.last_page_token
                ),
                r.last_synced_at,
                r.error_message,
                r.created_at,
                COALESCE(r.updated_at, r.created_at)
            )
            ON CONFLICT (company_id, provider) DO UPDATE SET
                status = EXCLUDED.status,
                account_identifier = EXCLUDED.account_identifier,
                access_token_secret_id = EXCLUDED.access_token_secret_id,
                refresh_token_secret_id = EXCLUDED.refresh_token_secret_id,
                token_expires_at = EXCLUDED.token_expires_at,
                config = EXCLUDED.config,
                last_synced_at = EXCLUDED.last_synced_at,
                error_message = EXCLUDED.error_message,
                updated_at = EXCLUDED.updated_at
            RETURNING id INTO v_new_integration_id;

            -- Upsert monitored root folder into integration_monitored_sources
            IF r.folder_id IS NOT NULL AND r.folder_id <> '' THEN
                INSERT INTO public.integration_monitored_sources (
                    integration_id,
                    company_id,
                    source_id,
                    source_type,
                    source_name,
                    source_path,
                    is_recursive,
                    sync_cursor,
                    created_at,
                    updated_at
                ) VALUES (
                    v_new_integration_id,
                    r.company_id,
                    r.folder_id,
                    'folder',
                    COALESCE(r.folder_name, 'Lucid Coach Ingestion'),
                    '/' || COALESCE(r.folder_name, 'Lucid Coach Ingestion'),
                    true,
                    r.last_page_token,
                    r.created_at,
                    COALESCE(r.updated_at, r.created_at)
                )
                ON CONFLICT (integration_id, source_id) DO NOTHING;
            END IF;
        END LOOP;
    END IF;

    -- Migrate synced files
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'google_drive_synced_files') THEN
        INSERT INTO public.integration_synced_items (
            id,
            integration_id,
            company_id,
            source_id,
            external_item_id,
            item_name,
            item_type,
            size_bytes,
            content_hash,
            external_modified_time,
            coach_document_id,
            status,
            error_message,
            synced_at
        )
        SELECT
            f.id,
            f.integration_id,
            f.company_id,
            COALESCE(i.folder_id, 'root'),
            f.drive_file_id,
            f.file_name,
            f.file_type,
            f.file_size_bytes,
            COALESCE(f.md5_checksum, f.drive_file_id),
            f.drive_modified_time,
            f.coach_document_id,
            f.status,
            f.error_message,
            f.synced_at
        FROM public.google_drive_synced_files f
        LEFT JOIN public.google_drive_integrations i ON f.integration_id = i.id
        ON CONFLICT (integration_id, external_item_id, content_hash) DO NOTHING;
    END IF;
END $$;

-- 7. Unified Vault Stored Procedures (Multi-Provider Tokens)
CREATE OR REPLACE FUNCTION public.store_integration_tokens(
    p_company_id UUID,
    p_provider TEXT,
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
    v_access_name TEXT := p_provider || '_access_token_' || p_company_id::text;
    v_refresh_name TEXT := p_provider || '_refresh_token_' || p_company_id::text;
BEGIN
    -- 1. Store or update access token
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
            p_provider || ' OAuth access token for company ' || p_company_id::text
        );
    END IF;

    -- 2. Store or update refresh token
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
                p_provider || ' OAuth refresh token for company ' || p_company_id::text
            );
        END IF;
    END IF;

    -- 3. Update company_integrations
    UPDATE public.company_integrations
    SET
        access_token_secret_id = v_access_secret_id,
        refresh_token_secret_id = COALESCE(v_refresh_secret_id, refresh_token_secret_id),
        token_expires_at = p_token_expires_at,
        updated_at = timezone('utc'::text, now())
    WHERE company_id = p_company_id AND provider = p_provider;

    -- Also update legacy table if present for backwards compatibility
    IF p_provider = 'google_drive' AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'google_drive_integrations') THEN
        UPDATE public.google_drive_integrations
        SET
            access_token_secret_id = v_access_secret_id,
            refresh_token_secret_id = COALESCE(v_refresh_secret_id, refresh_token_secret_id),
            token_expires_at = p_token_expires_at,
            updated_at = timezone('utc'::text, now())
        WHERE company_id = p_company_id;
    END IF;

    RETURN jsonb_build_object(
        'access_token_secret_id', v_access_secret_id,
        'refresh_token_secret_id', v_refresh_secret_id,
        'success', true
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_integration_tokens(
    p_company_id UUID,
    p_provider TEXT
)
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
    FROM public.company_integrations
    WHERE company_id = p_company_id AND provider = p_provider;

    IF NOT FOUND THEN
        -- Fallback to legacy table if provider is google_drive
        IF p_provider = 'google_drive' AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'google_drive_integrations') THEN
            SELECT access_token_secret_id, refresh_token_secret_id, token_expires_at
            INTO v_access_secret_id, v_refresh_secret_id, v_token_expires_at
            FROM public.google_drive_integrations
            WHERE company_id = p_company_id;
        END IF;
    END IF;

    IF v_access_secret_id IS NOT NULL THEN
        SELECT decrypted_secret INTO v_access_token
        FROM vault.decrypted_secrets
        WHERE id = v_access_secret_id;
    ELSE
        SELECT decrypted_secret INTO v_access_token
        FROM vault.decrypted_secrets
        WHERE name = p_provider || '_access_token_' || p_company_id::text
        LIMIT 1;
    END IF;

    IF v_refresh_secret_id IS NOT NULL THEN
        SELECT decrypted_secret INTO v_refresh_token
        FROM vault.decrypted_secrets
        WHERE id = v_refresh_secret_id;
    ELSE
        SELECT decrypted_secret INTO v_refresh_token
        FROM vault.decrypted_secrets
        WHERE name = p_provider || '_refresh_token_' || p_company_id::text
        LIMIT 1;
    END IF;

    RETURN jsonb_build_object(
        'access_token', v_access_token,
        'refresh_token', v_refresh_token,
        'token_expires_at', v_token_expires_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_integration_tokens(
    p_company_id UUID,
    p_provider TEXT
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
BEGIN
    DELETE FROM vault.secrets
    WHERE name IN (
        p_provider || '_access_token_' || p_company_id::text,
        p_provider || '_refresh_token_' || p_company_id::text
    );

    UPDATE public.company_integrations
    SET
        access_token_secret_id = NULL,
        refresh_token_secret_id = NULL,
        updated_at = timezone('utc'::text, now())
    WHERE company_id = p_company_id AND provider = p_provider;

    RETURN true;
END;
$$;

-- 8. Backwards-compatible Wrappers (zero redundancy: delegating directly to unified functions)
CREATE OR REPLACE FUNCTION public.store_google_drive_tokens(
    p_company_id UUID,
    p_access_token TEXT,
    p_refresh_token TEXT,
    p_token_expires_at TIMESTAMPTZ
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN public.store_integration_tokens(p_company_id, 'google_drive', p_access_token, p_refresh_token, p_token_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_google_drive_tokens(p_company_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN public.get_integration_tokens(p_company_id, 'google_drive');
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_google_drive_vault_tokens(p_company_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN public.delete_integration_tokens(p_company_id, 'google_drive');
END;
$$;

-- 9. Automatic cleanup trigger on delete
CREATE OR REPLACE FUNCTION public.cleanup_integration_vault_secrets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
BEGIN
    DELETE FROM vault.secrets
    WHERE name IN (
        OLD.provider || '_access_token_' || OLD.company_id::text,
        OLD.provider || '_refresh_token_' || OLD.company_id::text
    );
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_integration_vault_secrets ON public.company_integrations;
CREATE TRIGGER trg_cleanup_integration_vault_secrets
BEFORE DELETE ON public.company_integrations
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_integration_vault_secrets();

-- 10. Security Hardening (Strictly service_role only)
REVOKE ALL ON FUNCTION public.store_integration_tokens(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_integration_tokens(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.get_integration_tokens(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_integration_tokens(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.delete_integration_tokens(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_integration_tokens(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.store_google_drive_tokens(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_google_drive_tokens(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.get_google_drive_tokens(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_google_drive_tokens(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.delete_google_drive_vault_tokens(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_google_drive_vault_tokens(UUID) TO service_role;
