
-- RECOVERY MIGRATION: Ensure 'sport' column exists on intelligence tables
-- Run this if you are getting "column 'sport' does not exist" errors.

DO $$ 
BEGIN
    -- 1. Ensure 'sport' exists in team_trends
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_trends' AND column_name='sport') THEN
        ALTER TABLE team_trends ADD COLUMN sport TEXT DEFAULT 'NFL';
        ALTER TABLE team_trends ALTER COLUMN sport SET NOT NULL;
    END IF;

    -- 2. Ensure 'sport' exists in match_insights
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_insights' AND column_name='sport') THEN
        ALTER TABLE match_insights ADD COLUMN sport TEXT;
    END IF;

    -- 3. Ensure 'sport' exists in game_results
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='game_results' AND column_name='sport') THEN
        ALTER TABLE game_results ADD COLUMN sport TEXT DEFAULT 'NFL';
        ALTER TABLE game_results ALTER COLUMN sport SET NOT NULL;
    END IF;

    -- 4. Ensure 'sport' exists in ref_intel
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ref_intel' AND column_name='sport') THEN
        ALTER TABLE ref_intel ADD COLUMN sport TEXT DEFAULT 'NFL';
        ALTER TABLE ref_intel ALTER COLUMN sport SET NOT NULL;
    END IF;

END $$;

-- Re-apply indices just in case they failed previously
CREATE INDEX IF NOT EXISTS idx_team_trends_sport ON team_trends (sport);
CREATE INDEX IF NOT EXISTS idx_match_insights_sport ON match_insights (sport);
CREATE INDEX IF NOT EXISTS idx_game_results_sport ON game_results (sport);
CREATE INDEX IF NOT EXISTS idx_ref_intel_sport ON ref_intel (sport);
