-- SIGNAL ARCHIVE TABLE
-- Stores historical signal meter data from LiveAnalysisCard for study/backtesting

CREATE TABLE IF NOT EXISTS signal_archive (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    match_id TEXT NOT NULL,
    sport TEXT,
    league TEXT,
    
    -- Teams
    home_team TEXT,
    away_team TEXT,
    
    -- Opening/Closing Odds
    opening_spread NUMERIC,
    opening_total NUMERIC,
    opening_home_ml INTEGER,
    opening_away_ml INTEGER,
    closing_spread NUMERIC,
    closing_total NUMERIC,
    closing_home_ml INTEGER,
    closing_away_ml INTEGER,
    
    -- Line Movement Analysis
    spread_movement NUMERIC,
    total_movement NUMERIC,
    movement_direction TEXT, -- 'SHARP_HOME', 'SHARP_AWAY', 'PUBLIC_HOME', 'PUBLIC_AWAY', 'NEUTRAL'
    
    -- Public/Sharp Splits (if available)
    public_side_pct NUMERIC,
    public_total_pct NUMERIC,
    sharp_action_detected BOOLEAN DEFAULT FALSE,
    
    -- Model Signals (from LiveAnalysisCard)
    signal_strength NUMERIC, -- 0-100
    signal_direction TEXT, -- 'HOME', 'AWAY', 'OVER', 'UNDER', 'NEUTRAL'
    edge_value NUMERIC,
    
    -- Game Context
    game_time TIMESTAMPTZ,
    venue TEXT,
    
    -- Actual Outcome (for backtesting - filled post-game)
    final_home_score INTEGER,
    final_away_score INTEGER,
    final_total INTEGER,
    spread_result TEXT, -- 'COVER_HOME', 'COVER_AWAY', 'PUSH'
    total_result TEXT, -- 'OVER', 'UNDER', 'PUSH'
    
    -- Metadata
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'live_analysis_card'
    
    -- Indexes
    -- CONSTRAINT unique_match_signal UNIQUE (match_id, archived_at::date)
);

-- Enable RLS
ALTER TABLE signal_archive ENABLE ROW LEVEL SECURITY;

-- Service role write access
CREATE POLICY "Service role write" ON signal_archive
    FOR ALL USING (auth.role() = 'service_role');

-- Public read for analytics
CREATE POLICY "Public read access" ON signal_archive
    FOR SELECT USING (true);

-- Indexes for analytics queries
CREATE INDEX idx_signal_archive_match_id ON signal_archive(match_id);
CREATE INDEX idx_signal_archive_game_time ON signal_archive(game_time DESC);
CREATE INDEX idx_signal_archive_sport ON signal_archive(sport);
CREATE INDEX idx_signal_archive_signal_direction ON signal_archive(signal_direction);
CREATE INDEX idx_signal_archive_movement ON signal_archive(movement_direction);
