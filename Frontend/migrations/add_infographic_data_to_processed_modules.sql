-- Migration: Add infographic_data column to processed_modules table
-- This column will cache the generated visual guide/infographic data to avoid regeneration

-- Add infographic_data column
ALTER TABLE processed_modules
ADD COLUMN IF NOT EXISTS infographic_data JSONB DEFAULT NULL;

-- Create a GIN index for better query performance on JSONB data
CREATE INDEX IF NOT EXISTS idx_processed_modules_infographic_data 
ON processed_modules USING GIN (infographic_data);

-- Add column comment for documentation
COMMENT ON COLUMN processed_modules.infographic_data IS 'Cached infographic/visual guide data generated from module content. Structure: {"title": string, "sections": [...], "criticalFlags": {...}}';
