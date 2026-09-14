-- Migration: 20260909_sync_module_approval_triggers.sql
-- Automatically syncs pending edits from content_generation_history to processed_modules
-- and sets default reviewer when a training module review_stage is updated to 'approved' directly in the DB.

-- 1. Function to set default reviewer_id if NULL upon approval
CREATE OR REPLACE FUNCTION public.set_default_reviewer_on_approval()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.review_stage = 'approved' AND NEW.reviewer_id IS NULL THEN
        NEW.reviewer_id := NEW.uploaded_by;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger before update on training_modules
DROP TRIGGER IF EXISTS trg_training_modules_set_reviewer ON public.training_modules;
CREATE TRIGGER trg_training_modules_set_reviewer
    BEFORE UPDATE OF review_stage, reviewer_id ON public.training_modules
    FOR EACH ROW
    EXECUTE FUNCTION public.set_default_reviewer_on_approval();

-- 3. Function to sync approved/rejected changes to processed_modules and history
CREATE OR REPLACE FUNCTION public.sync_training_module_approval()
RETURNS TRIGGER AS $$
BEGIN
    -- Only act when moving to approved
    IF NEW.review_stage = 'approved' AND (OLD.review_stage IS DISTINCT FROM 'approved') THEN
        -- Push latest in_review content from content_generation_history to processed_modules
        UPDATE public.processed_modules pm
        SET content = latest_cgh.content
        FROM (
            SELECT DISTINCT ON (processed_module_id) processed_module_id, content
            FROM public.content_generation_history
            WHERE original_module_id = NEW.module_id
              AND status = 'in_review'
            ORDER BY processed_module_id, created_at DESC
        ) latest_cgh
        WHERE pm.processed_module_id = latest_cgh.processed_module_id;

        -- Mark in_review history entries as approved
        UPDATE public.content_generation_history
        SET status = 'approved'
        WHERE original_module_id = NEW.module_id
          AND status = 'in_review';

    ELSIF NEW.review_stage = 'rejected' AND (OLD.review_stage IS DISTINCT FROM 'rejected') THEN
        -- Mark in_review history entries as rejected
        UPDATE public.content_generation_history
        SET status = 'rejected'
        WHERE original_module_id = NEW.module_id
          AND status = 'in_review';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Trigger after update on training_modules
DROP TRIGGER IF EXISTS trg_training_modules_sync_approval ON public.training_modules;
CREATE TRIGGER trg_training_modules_sync_approval
    AFTER UPDATE OF review_stage ON public.training_modules
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_training_module_approval();
