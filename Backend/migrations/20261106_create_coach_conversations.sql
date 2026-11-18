-- ============================================================================
-- Migration: 20261106_create_coach_conversations.sql
-- Description: Stores user chat threads and conversation history for the
--              AI Performance Coach (similar to ChatGPT / modern chatbots).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.coach_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    company_id UUID NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Chat',
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast user thread retrieval ordered by recency
CREATE INDEX IF NOT EXISTS idx_coach_conversations_user_updated 
ON public.coach_conversations(user_id, company_id, updated_at DESC);

-- Index for lookup by conversation ID
CREATE INDEX IF NOT EXISTS idx_coach_conversations_id 
ON public.coach_conversations(id);

