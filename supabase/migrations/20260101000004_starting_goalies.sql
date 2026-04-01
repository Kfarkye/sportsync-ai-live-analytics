-- Starting Goalies Table
-- Stores confirmed/projected starting goalie information for NHL games
-- Populated by fetch-starting-goalies edge function using Gemini grounded search

CREATE TABLE IF NOT EXISTS starting_goalies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    game_date DATE NOT NULL,
    
    -- Home Goalie
    home_goalie_id TEXT,
    home_goalie_name TEXT,
    home_goalie_number INTEGER,
    home_status TEXT DEFAULT 'projected', -- 'confirmed', 'projected', 'unannounced'
    home_stats JSONB DEFAULT '{}', -- { gaa, savePercentage, wins, losses, otl, reasoning, bettingInsight }
    home_source TEXT, -- 'DailyFaceoff', 'LeftWingLock', 'Team Official', etc.
    home_headshot TEXT,
    
    -- Away Goalie
    away_goalie_id TEXT,
    away_goalie_name TEXT,
    away_goalie_number INTEGER,
    away_status TEXT DEFAULT 'projected',
    away_stats JSONB DEFAULT '{}',
    away_source TEXT,
    away_headshot TEXT,
    
    -- Metadata
    confidence_score INTEGER DEFAULT 70,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_match_goalie UNIQUE (match_id, game_date)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_goalies_match_id ON starting_goalies(match_id);
CREATE INDEX IF NOT EXISTS idx_goalies_game_date ON starting_goalies(game_date);

-- Enable RLS
ALTER TABLE starting_goalies ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read starting_goalies" ON starting_goalies
    FOR SELECT USING (true);

-- Service role can insert/update
CREATE POLICY "Service insert starting_goalies" ON starting_goalies
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Service update starting_goalies" ON starting_goalies
    FOR UPDATE USING (true);
