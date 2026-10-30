-- ============================================================================
-- Migration: 20261030_optimize_coach_ingestion_indexes.sql
-- Description: Composite indexes, deduplication tracking, versioning, and
--              audit columns for Enterprise Coach Ingestion.
-- ============================================================================

BEGIN;

-- 1. Defensive column additions
ALTER TABLE public.coach_uploaded_documents 
    ADD COLUMN IF NOT EXISTS version INT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS mime_type TEXT,
    ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS error_details JSONB DEFAULT '{}'::jsonb;

-- 2. Fast Deduplication & Conflict Lookup Index
CREATE INDEX IF NOT EXISTS idx_coach_docs_company_hash 
    ON public.coach_uploaded_documents(company_id, file_hash);

-- 3. Composite Index for Paginated Document Inventory
CREATE INDEX IF NOT EXISTS idx_coach_docs_company_created 
    ON public.coach_uploaded_documents(company_id, created_at DESC);

-- 4. Fast Filename Conflict Index
CREATE INDEX IF NOT EXISTS idx_coach_docs_company_filename 
    ON public.coach_uploaded_documents(company_id, file_name);

-- 5. Compound Index for Chunks Search Scoping
CREATE INDEX IF NOT EXISTS idx_coach_chunks_doc_employee 
    ON public.coach_document_chunks(document_id, target_employee_id);

COMMIT;

