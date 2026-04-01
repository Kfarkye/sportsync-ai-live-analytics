-- NBA Team Priors Table Creation and Seeding
-- Contains team-level shooting efficiency priors for the v3.0 Control Engine

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS nba_team_priors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    season TEXT NOT NULL,
    team TEXT NOT NULL,
    exp_3p_pct NUMERIC DEFAULT 0.36,  -- Expected 3PT%
    exp_2p_pct NUMERIC DEFAULT 0.52,  -- Expected 2PT%
    pace NUMERIC DEFAULT 100,         -- Team pace
    o_rating NUMERIC DEFAULT 110,     -- Offensive rating
    d_rating NUMERIC DEFAULT 110,     -- Defensive rating
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_team_season UNIQUE (season, team)
);

-- Enable RLS
ALTER TABLE nba_team_priors ENABLE ROW LEVEL SECURITY;

-- Allow read access
-- Allow read access
DROP POLICY IF EXISTS "Allow read access to nba_team_priors" ON nba_team_priors;
CREATE POLICY "Allow read access to nba_team_priors"
    ON nba_team_priors FOR SELECT USING (true);

-- Seed with 2024-25 NBA team priors (league averages as baseline, adjusted per team)
-- INSERT INTO nba_team_priors (season, team, exp_3p_pct, exp_2p_pct, pace, o_rating, d_rating) VALUES
-- -- Eastern Conference
-- ('2024-25', 'Boston Celtics', 0.381, 0.54, 99.2, 122.0, 107.5),
-- ... (rest of data)
--     d_rating = EXCLUDED.d_rating;

-- Also add 2025-26 season (copy from 2024-25 as baseline)
-- INSERT INTO nba_team_priors (season, team, exp_3p_pct, exp_2p_pct, pace, o_rating, d_rating)
-- SELECT '2025-26', team, exp_3p_pct, exp_2p_pct, pace, o_rating, d_rating
-- FROM nba_team_priors WHERE season = '2024-25'
-- ON CONFLICT (season, team) DO NOTHING;
--
-- -- Verify
-- -- SELECT COUNT(*) as total_priors FROM nba_team_priors;
