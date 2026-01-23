-- =================================================================
-- Add league_id column to closing_lines for sport filtering
-- =================================================================

-- Add the new column
ALTER TABLE closing_lines 
ADD COLUMN IF NOT EXISTS league_id TEXT;

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_closing_lines_league ON closing_lines(league_id);

-- Backfill existing data based on total range (heuristic)
UPDATE closing_lines SET league_id = CASE
    WHEN total::NUMERIC >= 180 AND total::NUMERIC <= 280 THEN 'nba'
    WHEN total::NUMERIC >= 100 AND total::NUMERIC < 180 THEN 'ncaab'
    WHEN total::NUMERIC >= 30 AND total::NUMERIC <= 80 THEN 'nfl'
    WHEN total::NUMERIC >= 10 AND total::NUMERIC < 30 THEN 'ncaaf'
    WHEN total::NUMERIC >= 3 AND total::NUMERIC <= 15 THEN 'nhl'
    WHEN total::NUMERIC >= 0 AND total::NUMERIC < 3 THEN 'soccer' -- Soccer totals are very low (2.5, 3.0)
    WHEN total::NUMERIC > 3 AND total::NUMERIC < 10 THEN 'mlb'
    ELSE 'unknown'
END
WHERE league_id IS NULL AND total IS NOT NULL;

-- Verify
SELECT league_id, COUNT(*) as rows FROM closing_lines GROUP BY league_id ORDER BY rows DESC;
