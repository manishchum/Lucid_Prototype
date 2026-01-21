-- Migration: Add user_id and indexes to assessments
-- Run this in your Supabase/Postgres SQL editor.

BEGIN;

-- 1) Add user_id column if it doesn't already exist
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- 2) Add foreign key constraint linking to employees(id) (do nothing if exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'assessments'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'user_id'
  ) THEN
    ALTER TABLE assessments
      ADD CONSTRAINT fk_assessments_employee
      FOREIGN KEY (user_id) REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END$$;

-- 3) Create a composite index to speed lookups by employee/module/type
CREATE INDEX IF NOT EXISTS idx_assessments_employee_module_type
  ON assessments (user_id, module_id, type);

-- 4) Ensure only one baseline assessment exists per employee + module
--    Use a partial unique index (Postgres). It ignores rows where user_id or module_id is NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessments_baseline_employee_module
  ON assessments (user_id, module_id)
  WHERE type = 'baseline' AND user_id IS NOT NULL AND module_id IS NOT NULL;

COMMIT;
