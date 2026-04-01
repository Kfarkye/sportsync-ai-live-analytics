-- Migration: Add logic_authority to pregame_intel
-- This column stores the raw Chain-of-Thought reasoning from Gemini 3

ALTER TABLE pregame_intel 
ADD COLUMN IF NOT EXISTS logic_authority TEXT;

-- Index for future text search capabilities
CREATE INDEX IF NOT EXISTS idx_pregame_intel_logic ON pregame_intel USING gin(to_tsvector('english', COALESCE(logic_authority, '')));

SELECT 'logic_authority column added' as status;
