-- Migration: Create team_game_context table
-- Purpose: Store pre-computed situational data for fast worker hydration

CREATE TABLE IF NOT EXISTS team_game_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team TEXT NOT NULL,
    league_id TEXT NOT NULL DEFAULT 'nba',
    game_date DATE NOT NULL,
    
    -- INJURY DATA
    injury_impact NUMERIC(4,2) DEFAULT 0,        -- 0-10 scale
    injury_notes TEXT,                            -- "Embiid OUT, Maxey GTD"
    
    -- FATIGUE/SITUATION
    situation TEXT DEFAULT 'Normal',              -- B2B, 3in4, EndRoadTrip, Normal
    rest_days INTEGER DEFAULT 2,                  -- Days since last game
    fatigue_score INTEGER NOT NULL DEFAULT 0, -- 0-100 scale (from User Data)
    
    -- ATS TRENDS
    ats_last_10 NUMERIC(4,2) DEFAULT 0.50,        -- 0.00 to 1.00
    ats_as_favorite NUMERIC(4,2),                 -- ATS % when favored
    ats_as_underdog NUMERIC(4,2),                 -- ATS % when underdog
    
    -- META
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'cron',                   -- 'cron', 'manual', 'gemini'
    raw_response JSONB,                           -- Store Gemini response for debugging
    
    UNIQUE(team, game_date, league_id)
);

-- Index for fast lookups by team + date
CREATE INDEX IF NOT EXISTS idx_team_game_context_lookup 
ON team_game_context(team, game_date);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_team_game_context_date 
ON team_game_context(game_date);
