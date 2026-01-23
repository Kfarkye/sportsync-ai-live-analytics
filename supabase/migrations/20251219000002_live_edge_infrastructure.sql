-- LIVE EDGE INFRASTRUCTURE
-- Storage schema for P_expected, E_expected, and live edge alerts

-- ============================================================================
-- 1. PREGAME EXPECTATIONS TABLE
-- Stores pace and efficiency expectations derived from pregame analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS pregame_expectations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    sport_key TEXT NOT NULL,
    
    -- Pace expectations (possessions/plays per minute)
    expected_pace DECIMAL(8,4),
    home_pace DECIMAL(8,4),
    away_pace DECIMAL(8,4),
    pace_source TEXT DEFAULT 'calculated',  -- 'calculated', 'manual', 'model'
    
    -- Efficiency expectations (points per possession)
    expected_efficiency DECIMAL(8,4),
    home_off_rating DECIMAL(8,2),     -- Offensive rating (pts per 100 poss)
    away_off_rating DECIMAL(8,2),
    home_def_rating DECIMAL(8,2),     -- Defensive rating
    away_def_rating DECIMAL(8,2),
    efficiency_source TEXT DEFAULT 'calculated',
    
    -- Total expectations
    expected_total DECIMAL(8,2),
    expected_total_source TEXT DEFAULT 'opening_line',  -- 'opening_line', 'model', 'manual'
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_pregame_match UNIQUE (match_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pregame_expectations_match ON pregame_expectations(match_id);
CREATE INDEX IF NOT EXISTS idx_pregame_expectations_sport ON pregame_expectations(sport_key);

-- ============================================================================
-- 2. LIVE EDGE ALERTS TABLE
-- Stores detected price breaks for historical analysis and execution tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS live_edge_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Alert details
    direction TEXT CHECK (direction IN ('OVER', 'UNDER')),
    edge DECIMAL(8,2),                  -- Fair value - Market value
    edge_percent DECIMAL(8,4),          -- Edge as percentage
    confidence DECIMAL(5,4),            -- 0-1 confidence score
    primary_driver TEXT CHECK (primary_driver IN ('PACE', 'EFFICIENCY', 'BOTH')),
    
    -- Metrics snapshot
    metrics JSONB,                      -- Full LiveMetrics object
    game_state JSONB,                   -- Full LiveGameState object
    
    -- Execution tracking
    recommendation TEXT,
    was_executed BOOLEAN DEFAULT FALSE,
    execution_price DECIMAL(8,2),
    outcome TEXT CHECK (outcome IN ('WIN', 'LOSS', 'PUSH', 'PENDING')),
    outcome_value DECIMAL(8,2),         -- Profit/loss if executed
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for analysis
CREATE INDEX IF NOT EXISTS idx_live_edge_alerts_match ON live_edge_alerts(match_id);
CREATE INDEX IF NOT EXISTS idx_live_edge_alerts_detected ON live_edge_alerts(detected_at);
CREATE INDEX IF NOT EXISTS idx_live_edge_alerts_direction ON live_edge_alerts(direction);
CREATE INDEX IF NOT EXISTS idx_live_edge_alerts_confidence ON live_edge_alerts(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_live_edge_alerts_executable ON live_edge_alerts(edge_percent DESC) WHERE confidence > 0.7;

-- ============================================================================
-- 3. LIVE METRICS HISTORY TABLE
-- Stores time-series of live metrics for charting and analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS live_metrics_history (
    match_id TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Core metrics
    p_live DECIMAL(8,4),        -- Live pace
    e_live DECIMAL(8,4),        -- Live efficiency
    r_real DECIMAL(8,4),        -- Actual scoring rate
    r_market DECIMAL(8,4),      -- Market-implied rate
    r_expected DECIMAL(8,4),    -- Expected rate
    
    -- Deltas
    pace_delta DECIMAL(8,4),
    efficiency_delta DECIMAL(8,4),
    market_delta DECIMAL(8,4),
    
    -- Game state
    total_score INTEGER,
    time_remaining DECIMAL(8,2),
    possessions INTEGER,
    period INTEGER,
    
    -- Market state
    live_total DECIMAL(8,2),
    
    PRIMARY KEY (match_id, captured_at)
);

-- Partition by time for efficient queries
CREATE INDEX IF NOT EXISTS idx_live_metrics_match_time ON live_metrics_history(match_id, captured_at DESC);

-- ============================================================================
-- 4. SPORT CONFIGURATIONS TABLE
-- Stores sport-specific parameters for calculations
-- ============================================================================

CREATE TABLE IF NOT EXISTS sport_configurations (
    sport_key TEXT PRIMARY KEY,
    sport_name TEXT NOT NULL,
    
    -- Game structure
    periods_per_game INTEGER NOT NULL,
    minutes_per_period DECIMAL(8,2) NOT NULL,
    
    -- Pace/efficiency units
    possession_unit TEXT NOT NULL,      -- 'possessions', 'drives', 'shots'
    efficiency_unit TEXT NOT NULL,      -- 'pts/poss', 'pts/drive', 'goals/shot'
    
    -- Calculation parameters
    min_possessions_for_stability INTEGER DEFAULT 15,
    default_pace DECIMAL(8,4),
    default_efficiency DECIMAL(8,4),
    default_total DECIMAL(8,2),
    
    -- Thresholds
    market_delta_threshold DECIMAL(8,4) DEFAULT 0.3,
    edge_percent_threshold DECIMAL(8,4) DEFAULT 0.03,
    min_time_remaining DECIMAL(8,2) DEFAULT 2,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default configurations
INSERT INTO sport_configurations (sport_key, sport_name, periods_per_game, minutes_per_period, possession_unit, efficiency_unit, min_possessions_for_stability, default_pace, default_efficiency, default_total)
VALUES 
    ('basketball_nba', 'NBA', 4, 12, 'possessions', 'pts/100poss', 20, 2.1, 1.1, 220),
    ('basketball_ncaab', 'NCAAB', 2, 20, 'possessions', 'pts/100poss', 15, 1.7, 1.0, 145),
    ('americanfootball_nfl', 'NFL', 4, 15, 'drives', 'pts/drive', 6, 0.2, 2.3, 44),
    ('americanfootball_ncaaf', 'NCAAF', 4, 15, 'drives', 'pts/drive', 6, 0.22, 2.5, 52),
    ('icehockey_nhl', 'NHL', 3, 20, 'shots', 'goals/shot', 15, 0.5, 0.1, 6),
    ('soccer_epl', 'EPL', 2, 45, 'shots', 'goals/shot', 5, 0.15, 0.1, 2.5)
ON CONFLICT (sport_key) DO UPDATE SET
    sport_name = EXCLUDED.sport_name,
    periods_per_game = EXCLUDED.periods_per_game,
    minutes_per_period = EXCLUDED.minutes_per_period,
    possession_unit = EXCLUDED.possession_unit,
    efficiency_unit = EXCLUDED.efficiency_unit,
    updated_at = NOW();

-- ============================================================================
-- 5. HELPER FUNCTIONS
-- ============================================================================

-- Function to get expected rate for a match
CREATE OR REPLACE FUNCTION get_expected_rate(p_match_id TEXT)
RETURNS TABLE (
    expected_pace DECIMAL,
    expected_efficiency DECIMAL,
    expected_rate DECIMAL,
    expected_total DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pe.expected_pace,
        pe.expected_efficiency,
        (pe.expected_pace * pe.expected_efficiency) as expected_rate,
        pe.expected_total
    FROM pregame_expectations pe
    WHERE pe.match_id = p_match_id;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate edge statistics
CREATE OR REPLACE FUNCTION get_edge_statistics(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    total_alerts BIGINT,
    executed_alerts BIGINT,
    win_rate DECIMAL,
    avg_edge DECIMAL,
    avg_confidence DECIMAL,
    total_profit DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_alerts,
        COUNT(*) FILTER (WHERE was_executed) as executed_alerts,
        ROUND(
            COUNT(*) FILTER (WHERE outcome = 'WIN')::DECIMAL / 
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('WIN', 'LOSS')), 0),
            4
        ) as win_rate,
        ROUND(AVG(edge), 2) as avg_edge,
        ROUND(AVG(confidence), 4) as avg_confidence,
        ROUND(SUM(CASE WHEN was_executed THEN outcome_value ELSE 0 END), 2) as total_profit
    FROM live_edge_alerts
    WHERE detected_at > NOW() - (p_days || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- Comment
COMMENT ON TABLE live_edge_alerts IS 'Stores detected price breaks for the live-edge-calculator service';
COMMENT ON TABLE pregame_expectations IS 'Stores pregame pace and efficiency expectations for live edge calculations';
COMMENT ON TABLE live_metrics_history IS 'Time-series of live metrics for historical analysis';
COMMENT ON TABLE sport_configurations IS 'Sport-specific parameters for edge calculations';
