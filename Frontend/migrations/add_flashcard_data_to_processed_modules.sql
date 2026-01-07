-- Migration: Add flashcard_data column to processed_modules table
-- Purpose: Cache generated flashcards to avoid repeated API calls
-- Created: 2026-01-07

-- Add flashcard_data column if it doesn't exist
ALTER TABLE processed_modules
ADD COLUMN IF NOT EXISTS flashcard_data JSONB;

-- Create an index on flashcard_data for faster JSON queries (optional, but recommended)
CREATE INDEX IF NOT EXISTS idx_processed_modules_flashcard_data 
ON processed_modules USING GIN (flashcard_data);

-- Add a comment to document the column
COMMENT ON COLUMN processed_modules.flashcard_data IS 'Cached flashcard data generated from module content. Structure: [{"heading": string, "points": string[]}]';
