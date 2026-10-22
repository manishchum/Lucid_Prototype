-- ============================================================================
-- Migration: 20261021_create_coach_documents_and_chunks.sql
-- Description: Schema for Employee Performance Coach ingestion pipeline.
--              Supports manual upload of: PDF, DOCX, DOC, CSV, XLSX, XLS, PPTX, PPT.
--              Includes vector storage, citation metadata, and structured spreadsheet rows.
-- ============================================================================

BEGIN;

-- 1. Ensure required extensions exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 2. MASTER TABLE: coach_uploaded_documents
--    Tracks uploaded files, processing status, and document metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coach_uploaded_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    uploaded_by UUID NOT NULL,
    target_employee_id UUID,                     -- Specific employee if 1-on-1 review, NULL if team-wide/general
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,                     -- 'pdf', 'docx', 'doc', 'csv', 'xlsx', 'xls', 'pptx', 'ppt'
    file_size_bytes BIGINT,
    storage_path TEXT NOT NULL,                  -- Supabase storage path: coach-documents/{company_id}/{id}/{file_name}
    file_hash TEXT,                              -- SHA256/MD5 for deduplication check
    description TEXT,                            -- LLM-generated semantic summary for document routing
    manual_description TEXT,                     -- Optional admin/manager notes on upload
    document_period TEXT,                        -- e.g. 'Q3 2024', 'Annual 2024', 'Sprint 42'
    status TEXT NOT NULL DEFAULT 'pending',      -- 'pending', 'parsing', 'embedding', 'completed', 'failed'
    error_message TEXT,
    parsed_metadata JSONB DEFAULT '{}'::jsonb,   -- { "page_count": 12, "sheet_names": ["Q3", "KPIs"], "slide_count": 15 }
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 3. CHUNKS TABLE: coach_document_chunks
--    Stores vector embeddings and exact citation/proof coordinates
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coach_document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.coach_uploaded_documents(id) ON DELETE CASCADE,
    company_id UUID NOT NULL,
    target_employee_id UUID,                     -- Scoped to specific employee if detected during parsing
    chunk_index INT NOT NULL,
    chunk_type TEXT NOT NULL DEFAULT 'text',     -- 'text', 'table_row', 'sheet_summary', 'slide', 'header'
    content TEXT NOT NULL,
    embedding vector(1024),                      -- 1024-dim vector for BGE-large-en-v1.5
    
    -- Grounding and proof metadata
    citation JSONB NOT NULL DEFAULT '{
        "file_name": "",
        "file_type": "",
        "page_number": null,
        "slide_number": null,
        "sheet_name": null,
        "row_number": null,
        "section_title": null,
        "evaluator_name": null,
        "eval_period": null
    }'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 4. STRUCTURED TABULAR TABLE: coach_spreadsheet_rows
--    Stores exact tabular row data for CSV / Excel to allow deterministic SQL calculations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coach_spreadsheet_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.coach_uploaded_documents(id) ON DELETE CASCADE,
    company_id UUID NOT NULL,
    sheet_name TEXT NOT NULL DEFAULT 'Sheet1',
    row_index INT NOT NULL,
    target_employee_id UUID,                     -- Resolved employee if matched against users table
    employee_name TEXT,                          -- Raw employee name from the row
    row_data JSONB NOT NULL,                     -- Key-value pair of all columns (e.g. {"KPI": "Sales", "Target": 100, "Actual": 120})
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 5. INDEXES FOR PERFORMANCE & SEARCH SPEED
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_coach_docs_company 
    ON public.coach_uploaded_documents(company_id);

CREATE INDEX IF NOT EXISTS idx_coach_docs_status 
    ON public.coach_uploaded_documents(status);

CREATE INDEX IF NOT EXISTS idx_coach_chunks_doc_id 
    ON public.coach_document_chunks(document_id);

CREATE INDEX IF NOT EXISTS idx_coach_chunks_company 
    ON public.coach_document_chunks(company_id);

CREATE INDEX IF NOT EXISTS idx_coach_chunks_target_emp 
    ON public.coach_document_chunks(target_employee_id);

-- GIN index for fast filtering inside citations
CREATE INDEX IF NOT EXISTS idx_coach_chunks_citation_gin 
    ON public.coach_document_chunks USING gin (citation);

-- GIN index on spreadsheet data for arbitrary column filtering
CREATE INDEX IF NOT EXISTS idx_coach_spreadsheet_rows_gin 
    ON public.coach_spreadsheet_rows USING gin (row_data);

CREATE INDEX IF NOT EXISTS idx_coach_spreadsheet_rows_lookup 
    ON public.coach_spreadsheet_rows(company_id, target_employee_id);

-- HNSW Cosine Similarity Vector Index
CREATE INDEX IF NOT EXISTS idx_coach_chunks_hnsw 
    ON public.coach_document_chunks 
    USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
--    Follows standard Lucid tenant isolation using can_access_company & can_access_user
-- ============================================================================
ALTER TABLE public.coach_uploaded_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_spreadsheet_rows ENABLE ROW LEVEL SECURITY;

-- Documents Table Policies
DROP POLICY IF EXISTS "rls_coach_uploaded_documents_select" ON public.coach_uploaded_documents;
CREATE POLICY rls_coach_uploaded_documents_select ON public.coach_uploaded_documents
    AS PERMISSIVE FOR SELECT TO public
    USING (can_access_company(company_id));

DROP POLICY IF EXISTS "rls_coach_uploaded_documents_write" ON public.coach_uploaded_documents;
CREATE POLICY rls_coach_uploaded_documents_write ON public.coach_uploaded_documents
    AS PERMISSIVE FOR ALL TO public
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

-- Chunks Table Policies
DROP POLICY IF EXISTS "rls_coach_document_chunks_select" ON public.coach_document_chunks;
CREATE POLICY rls_coach_document_chunks_select ON public.coach_document_chunks
    AS PERMISSIVE FOR SELECT TO public
    USING (can_access_company(company_id));

DROP POLICY IF EXISTS "rls_coach_document_chunks_write" ON public.coach_document_chunks;
CREATE POLICY rls_coach_document_chunks_write ON public.coach_document_chunks
    AS PERMISSIVE FOR ALL TO public
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

-- Spreadsheet Rows Policies
DROP POLICY IF EXISTS "rls_coach_spreadsheet_rows_select" ON public.coach_spreadsheet_rows;
CREATE POLICY rls_coach_spreadsheet_rows_select ON public.coach_spreadsheet_rows
    AS PERMISSIVE FOR SELECT TO public
    USING (can_access_company(company_id));

DROP POLICY IF EXISTS "rls_coach_spreadsheet_rows_write" ON public.coach_spreadsheet_rows;
CREATE POLICY rls_coach_spreadsheet_rows_write ON public.coach_spreadsheet_rows
    AS PERMISSIVE FOR ALL TO public
    USING (can_access_company(company_id))
    WITH CHECK (can_access_company(company_id));

-- ============================================================================
-- 7. RPC RETRIEVAL FUNCTION: match_coach_document_chunks
--    Used by the AI agent to search vector embeddings with tenant & role filtering
-- ============================================================================
DROP FUNCTION IF EXISTS public.match_coach_document_chunks(vector(1024), uuid, uuid[], int, float);
DROP FUNCTION IF EXISTS public.match_coach_document_chunks;

CREATE OR REPLACE FUNCTION public.match_coach_document_chunks(
    query_embedding vector(1024),
    p_company_id uuid,
    p_allowed_employee_ids uuid[] DEFAULT NULL,  -- If populated, restricts search to specific employees + team docs
    match_count int DEFAULT 8,
    match_threshold float DEFAULT 0.0
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    company_id uuid,
    target_employee_id uuid,
    chunk_index int,
    chunk_type text,
    content text,
    citation jsonb,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.document_id,
        c.company_id,
        c.target_employee_id,
        c.chunk_index,
        c.chunk_type,
        c.content,
        c.citation,
        (1 - (c.embedding <=> query_embedding))::float AS similarity
    FROM public.coach_document_chunks c
    WHERE c.company_id = p_company_id
      AND (
          -- If allowed list is null, no employee filter applied (e.g. company admin/CEO)
          p_allowed_employee_ids IS NULL 
          OR c.target_employee_id IS NULL -- Team-wide / general policy docs
          OR c.target_employee_id = ANY(p_allowed_employee_ids)
      )
      AND (1 - (c.embedding <=> query_embedding)) >= match_threshold
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================================
-- 8. STORAGE BUCKET REGISTRATION: coach-documents
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('coach-documents', 'coach-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage Policy: Users can view/read documents within their company
DROP POLICY IF EXISTS "Coach Documents Read Policy" ON storage.objects;
CREATE POLICY "Coach Documents Read Policy"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'coach-documents'
    AND (storage.foldername(name))[1] = current_app_company_id()::text
);

-- Storage Policy: Users can upload documents within their company folder
DROP POLICY IF EXISTS "Coach Documents Upload Policy" ON storage.objects;
CREATE POLICY "Coach Documents Upload Policy"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'coach-documents'
    AND (storage.foldername(name))[1] = current_app_company_id()::text
);

COMMIT;
