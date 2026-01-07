-- Add mindmap_data column to processed_modules table
-- This stores the generated mindmap JSON data to avoid regenerating it every time

ALTER TABLE processed_modules 
ADD COLUMN IF NOT EXISTS mindmap_data JSONB;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_processed_modules_mindmap_data ON processed_modules USING GIN (mindmap_data);

-- Add comment to document the column
COMMENT ON COLUMN processed_modules.mindmap_data IS 'Stores the generated mindmap data (nodes and edges) as JSON to avoid regeneration';
