-- Migration: Create table and RPC functions for processed_module vector chunks (RAG)
-- Date: 2026-09-22

-- 1. Create table vectordb_processed_chunks
CREATE TABLE IF NOT EXISTS public.vectordb_processed_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processed_module_id TEXT NOT NULL,
    original_module_id TEXT NOT NULL,
    company_id UUID,
    chunk_type TEXT DEFAULT 'qa',
    content TEXT NOT NULL,
    embedding vector(1024),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Indexes
CREATE INDEX IF NOT EXISTS idx_vectordb_processed_chunks_pm_id 
    ON public.vectordb_processed_chunks(processed_module_id);

CREATE INDEX IF NOT EXISTS idx_vectordb_processed_chunks_orig_id 
    ON public.vectordb_processed_chunks(original_module_id);

CREATE INDEX IF NOT EXISTS idx_vectordb_processed_chunks_company 
    ON public.vectordb_processed_chunks(company_id);

-- Vector HNSW index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_vectordb_processed_chunks_hnsw 
    ON public.vectordb_processed_chunks 
    USING hnsw (embedding vector_cosine_ops);

-- 3. Enable RLS and setup policies
ALTER TABLE public.vectordb_processed_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_vectordb_processed_chunks_select" ON public.vectordb_processed_chunks;
CREATE POLICY rls_vectordb_processed_chunks_select ON public.vectordb_processed_chunks 
    AS PERMISSIVE FOR SELECT TO public 
    USING (company_id IS NULL OR can_access_company(company_id));

DROP POLICY IF EXISTS "rls_vectordb_processed_chunks_write" ON public.vectordb_processed_chunks;
CREATE POLICY rls_vectordb_processed_chunks_write ON public.vectordb_processed_chunks 
    AS PERMISSIVE FOR ALL TO public 
    USING (company_id IS NULL OR can_access_company(company_id)) 
    WITH CHECK (company_id IS NULL OR can_access_company(company_id));

-- 4. RPC Function for matching chunks within a single processed module
DROP FUNCTION IF EXISTS public.match_processed_module_chunks(vector(1024), text, int, float);
DROP FUNCTION IF EXISTS public.match_processed_module_chunks(vector, text, integer, double precision);
DROP FUNCTION IF EXISTS public.match_processed_module_chunks;

CREATE OR REPLACE FUNCTION public.match_processed_module_chunks(
    query_embedding vector(1024),
    p_processed_module_id text,
    match_count int DEFAULT 5,
    match_threshold float DEFAULT 0.0
)
RETURNS TABLE (
    id uuid,
    processed_module_id text,
    original_module_id text,
    chunk_type text,
    content text,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        vc.id,
        vc.processed_module_id,
        vc.original_module_id,
        vc.chunk_type,
        vc.content,
        vc.metadata,
        (1 - (vc.embedding <=> query_embedding))::float AS similarity
    FROM public.vectordb_processed_chunks vc
    WHERE vc.processed_module_id = p_processed_module_id
      AND (1 - (vc.embedding <=> query_embedding)) >= match_threshold
    ORDER BY vc.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;

-- 5. RPC Function for matching chunks across all processed modules in a sprint (original_module_id)
DROP FUNCTION IF EXISTS public.match_sprint_module_chunks(vector(1024), text, int, float);
DROP FUNCTION IF EXISTS public.match_sprint_module_chunks(vector, text, integer, double precision);
DROP FUNCTION IF EXISTS public.match_sprint_module_chunks;

CREATE OR REPLACE FUNCTION public.match_sprint_module_chunks(
    query_embedding vector(1024),
    p_original_module_id text,
    match_count int DEFAULT 5,
    match_threshold float DEFAULT 0.0
)
RETURNS TABLE (
    id uuid,
    processed_module_id text,
    original_module_id text,
    chunk_type text,
    content text,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        vc.id,
        vc.processed_module_id,
        vc.original_module_id,
        vc.chunk_type,
        vc.content,
        vc.metadata,
        (1 - (vc.embedding <=> query_embedding))::float AS similarity
    FROM public.vectordb_processed_chunks vc
    WHERE vc.original_module_id = p_original_module_id
      AND (1 - (vc.embedding <=> query_embedding)) >= match_threshold
    ORDER BY vc.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;
