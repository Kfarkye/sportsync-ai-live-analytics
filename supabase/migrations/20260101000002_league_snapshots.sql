-- ============================================================================
-- LEAGUE SNAPSHOTS: High-Resolution Grounding for Analysis AI
-- ============================================================================

CREATE TABLE IF NOT EXISTS league_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    league TEXT NOT NULL, -- 'NFL', 'NBA', 'NHL', 'SOCCER'
    team TEXT NOT NULL,
    season TEXT DEFAULT '2025-26',
    
    -- Performance Metrics
    win_record TEXT,           -- e.g. "12-3"
    streak TEXT,               -- e.g. "W4", "L1"
    
    -- League-Specific Strength Ratings
    off_rank INTEGER,          -- 1-32
    def_rank INTEGER,          -- 1-32
    power_rating NUMERIC,      -- Custom Elo/Strength
    
    -- Behavioral Identity
    identity_tags TEXT[],      -- e.g. ['High Shout Volume', 'Blitz Heavy', 'Slow Starter']
    
    metadata JSONB DEFAULT '{}', -- Extra league-specific raw data
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_team_league_season UNIQUE (league, team, season)
);

-- Enable RLS
ALTER TABLE league_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on snapshots" ON league_snapshots FOR SELECT USING (true);

-- ============================================================================
-- SEEDING: 2025-26 MID-SEASON "TRUTH" (JANUARY 2026)
-- ============================================================================

-- NHL SNAPSHOTS (Focusing on the current NHL test case)
INSERT INTO league_snapshots (league, team, win_record, streak, off_rank, def_rank, power_rating, identity_tags)
VALUES
('NHL', 'Ottawa Senators', '15-18-2', 'L3', 18, 28, 44.5, ARRAY['Defensive Struggles', 'High Event', 'Vulnerable to Over']),
('NHL', 'Washington Capitals', '19-12-4', 'W2', 12, 14, 52.1, ARRAY['Balanced', 'Strong PP', 'Veteran Core']),
('NHL', 'Boston Bruins', '22-8-5', 'W1', 5, 2, 61.2, ARRAY['Elite Defense', 'Goalie Dependent', 'Slow Pace']),
('NHL', 'Toronto Maple Leafs', '20-10-5', 'L1', 2, 18, 58.5, ARRAY['High Volume Shots', 'Weak Blue Line', 'Star Heavy']),
('NHL', 'Edmonton Oilers', '21-11-3', 'W4', 1, 15, 60.1, ARRAY['Elite PP', 'Dynamic Offense', 'Inconsistent Goalies'])
ON CONFLICT (league, team, season) DO UPDATE SET
    win_record = EXCLUDED.win_record,
    streak = EXCLUDED.streak,
    off_rank = EXCLUDED.off_rank,
    def_rank = EXCLUDED.def_rank,
    power_rating = EXCLUDED.power_rating,
    identity_tags = EXCLUDED.identity_tags,
    updated_at = NOW();

-- NFL SNAPSHOTS (Late Season Truth)
INSERT INTO league_snapshots (league, team, win_record, streak, off_rank, def_rank, power_rating, identity_tags)
VALUES
('NFL', 'Kansas City Chiefs', '13-2', 'W6', 3, 4, 65.5, ARRAY['Clutch', 'Elite Defense', 'Playoff Experience']),
('NFL', 'San Francisco 49ers', '11-4', 'W1', 1, 5, 64.2, ARRAY['Explosive Run', 'Physical', 'Healthy Roster']),
('NFL', 'Philadelphia Eagles', '11-4', 'L1', 6, 12, 61.0, ARRAY['Tush Push', 'Second Half Team', 'Defensive Gaps']),
('NFL', 'Dallas Cowboys', '10-5', 'W2', 4, 8, 59.8, ARRAY['Home Fortress', 'Turnover Heavy', 'High Variance'])
ON CONFLICT (league, team, season) DO UPDATE SET
    win_record = EXCLUDED.win_record,
    streak = EXCLUDED.streak,
    off_rank = EXCLUDED.off_rank,
    def_rank = EXCLUDED.def_rank,
    power_rating = EXCLUDED.power_rating,
    identity_tags = EXCLUDED.identity_tags,
    updated_at = NOW();
