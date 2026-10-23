-- ============================================================================
-- Migration: 20261024_create_google_drive_integrations.sql
-- Description: Schema for Google Drive Connector to Performance Coach Ingestion
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.google_drive_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    connected_by UUID NOT NULL REFERENCES public.users(user_id),
    google_account_email TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ,
    folder_id TEXT NOT NULL,
    folder_name TEXT NOT NULL DEFAULT 'Lucid Coach Ingestion',
    sync_status TEXT NOT NULL DEFAULT 'active',
    webhook_channel_id TEXT,
    webhook_resource_id TEXT,
    webhook_expiration TIMESTAMPTZ,
    last_page_token TEXT,
    last_synced_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_company_drive_integration UNIQUE (company_id)
);

CREATE TABLE IF NOT EXISTS public.google_drive_synced_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
    integration_id UUID NOT NULL REFERENCES public.google_drive_integrations(id) ON DELETE CASCADE,
    drive_file_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size_bytes BIGINT,
    md5_checksum TEXT,
    drive_modified_time TIMESTAMPTZ,
    coach_document_id UUID REFERENCES public.coach_uploaded_documents(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    error_message TEXT,
    synced_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_file_sync UNIQUE (company_id, drive_file_id, md5_checksum)
);

CREATE INDEX IF NOT EXISTS idx_gdrive_channel ON public.google_drive_integrations(webhook_channel_id);
CREATE INDEX IF NOT EXISTS idx_gdrive_synced_docs ON public.google_drive_synced_files(coach_document_id);
