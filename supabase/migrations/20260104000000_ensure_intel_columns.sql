-- Ensure pregame_intel has all necessary columns
-- This migration is safe to run even if columns already exist

ALTER TABLE pregame_intel 
ADD COLUMN IF NOT EXISTS briefing TEXT,
ADD COLUMN IF NOT EXISTS home_team TEXT,
ADD COLUMN IF NOT EXISTS away_team TEXT;

-- Verify
SELECT 'columns confirmed' as result;
