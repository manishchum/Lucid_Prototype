-- Migration: Ensure composite unique constraint on module_progress(user_id, processed_module_id)
-- Purpose: Prevent duplicate progress records and enable atomic ON CONFLICT upsert.
-- Resolves P0 race condition (TOCTOU gap) on concurrent quiz/module progress submissions.

-- Step 1: Deduplicate any existing duplicate rows (defensive cleanup for all environments)
WITH ranked_progress AS (
    SELECT 
        module_progress_id,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, processed_module_id 
            ORDER BY completed_at DESC NULLS LAST, quiz_score DESC NULLS LAST, started_at DESC
        ) AS rn
    FROM public.module_progress
    WHERE user_id IS NOT NULL AND processed_module_id IS NOT NULL
)
DELETE FROM public.module_progress
WHERE module_progress_id IN (
    SELECT module_progress_id 
    FROM ranked_progress 
    WHERE rn > 1
);

-- Step 2: Ensure the composite unique constraint exists on (user_id, processed_module_id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'module_progress_user_module_key'
    ) THEN
        ALTER TABLE public.module_progress 
        ADD CONSTRAINT module_progress_user_module_key 
        UNIQUE (user_id, processed_module_id);
    END IF;
END $$;
