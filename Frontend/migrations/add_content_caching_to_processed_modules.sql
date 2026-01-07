-- Combined Migration: Add caching for mindmaps and flashcards
-- Purpose: Cache generated mindmaps and flashcards to avoid repeated API calls
-- Created: 2026-01-07

-- Add mindmap_data column if it doesn't exist
ALTER TABLE processed_modules
ADD COLUMN IF NOT EXISTS mindmap_data JSONB;

-- Add flashcard_data column if it doesn't exist
ALTER TABLE processed_modules
ADD COLUMN IF NOT EXISTS flashcard_data JSONB;

-- Create indexes for faster JSON queries
CREATE INDEX IF NOT EXISTS idx_processed_modules_mindmap_data 
ON processed_modules USING GIN (mindmap_data);

CREATE INDEX IF NOT EXISTS idx_processed_modules_flashcard_data 
ON processed_modules USING GIN (flashcard_data);

-- Add comments to document the columns
COMMENT ON COLUMN processed_modules.mindmap_data IS 'Cached mindmap data generated from module content. Structure: {"nodes": [...], "edges": [...]}';
COMMENT ON COLUMN processed_modules.flashcard_data IS 'Cached flashcard data generated from module content. Structure: [{"heading": string, "points": string[]}]';
