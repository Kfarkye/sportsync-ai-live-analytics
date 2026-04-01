-- =================================================================
-- NBA Signal System - Comprehensive Data Lake
-- Maximum tracking for AI synthesis, backtesting, and analytics
-- =================================================================

-- =============================================
-- 1. GAME STATE HISTORY (Full timeline)
-- =============================================
CREATE TABLE IF NOT EXISTS nba_game_state_history (
    state_id BIGSERIAL PRIMARY KEY,
    game_id TEXT NOT NULL,
    ts TIMESTAMPTZ DEFAULT NOW(),
    
    -- Game clock
    quarter INT,
    time_remaining TEXT,
    elapsed_min NUMERIC,
    
    -- Score
    pts_home INT,
    pts_away INT,
    score_diff INT GENERATED ALWAYS AS (pts_home - pts_away) STORED,
    total_pts INT GENERATED ALWAYS AS (pts_home + pts_away) STORED,
    
    -- Shooting stats
    home_fgm INT, home_fga INT,
    home_3pm INT, home_3pa INT,
    home_ftm INT, home_fta INT,
    away_fgm INT, away_fga INT,
    away_3pm INT, away_3pa INT,
    away_ftm INT, away_fta INT,
    
    -- Advanced
    pace_estimate NUMERIC,
    possessions_elapsed NUMERIC,
    
    -- Fouls
    home_team_fouls INT,
    away_team_fouls INT,
    home_in_bonus BOOLEAN,
    away_in_bonus BOOLEAN,
    
    -- Source
    source TEXT DEFAULT 'espn'
);

CREATE INDEX IF NOT EXISTS idx_game_state_game_ts ON nba_game_state_history(game_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_game_state_elapsed ON nba_game_state_history(game_id, elapsed_min);

-- =============================================
-- 2. MODEL PREDICTION HISTORY (Every run)
-- =============================================
CREATE TABLE IF NOT EXISTS nba_model_predictions (
    prediction_id BIGSERIAL PRIMARY KEY,
    game_id TEXT NOT NULL,
    ts TIMESTAMPTZ DEFAULT NOW(),
    elapsed_min NUMERIC,
    
    -- Inputs
    current_total INT,
    live_market_line NUMERIC,
    opening_line NUMERIC,
    
    -- Model internals
    anchor_ppp NUMERIC,
    poss_live NUMERIC,
    live_pace_48 NUMERIC,
    pace_blend_48 NUMERIC,
    rem_poss NUMERIC,
    struct_ppp NUMERIC,
    proj_ppp NUMERIC,
    luck_gap NUMERIC,
    lineup_adj_ppp NUMERIC,
    foul_ev NUMERIC,
    ot_ev NUMERIC,
    vol_std NUMERIC,
    
    -- Outputs
    model_fair NUMERIC,
    edge_points NUMERIC,
    edge_z NUMERIC,
    
    -- Flags
    is_window_signal BOOLEAN DEFAULT FALSE,
    window_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_model_pred_game_ts ON nba_model_predictions(game_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_model_pred_edge ON nba_model_predictions(edge_z);

-- =============================================
-- 3. MARKET LINE HISTORY (Every update)
-- =============================================
CREATE TABLE IF NOT EXISTS nba_market_history (
    market_id BIGSERIAL PRIMARY KEY,
    game_id TEXT NOT NULL,
    ts TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'espn',
    
    -- Totals
    total_line NUMERIC,
    over_juice INT,
    under_juice INT,
    
    -- Spreads
    spread_line NUMERIC,
    home_spread_juice INT,
    away_spread_juice INT,
    
    -- Moneyline
    home_ml INT,
    away_ml INT,
    
    -- Deltas
    total_delta_since_open NUMERIC,
    spread_delta_since_open NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_market_history_game_ts ON nba_market_history(game_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_market_history_source ON nba_market_history(source);

-- =============================================
-- 4. SIGNAL PERFORMANCE (Enriched grading)
-- =============================================
CREATE TABLE IF NOT EXISTS nba_signal_performance (
    perf_id BIGSERIAL PRIMARY KEY,
    signal_id BIGINT,
    
    -- At signal time
    signal_ts TIMESTAMPTZ,
    window_name TEXT,
    signal_side TEXT,
    edge_at_signal NUMERIC,
    market_at_signal NUMERIC,
    model_fair_at_signal NUMERIC,
    confidence TEXT,
    
    -- At game end
    final_total INT,
    final_home_score INT,
    final_away_score INT,
    
    -- Performance
    result TEXT,
    edge_captured NUMERIC,
    roi_units NUMERIC,
    
    -- Context
    game_pace_final NUMERIC,
    luck_normalized BOOLEAN,
    ot_occurred BOOLEAN,
    
    graded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_perf_window ON nba_signal_performance(window_name);
CREATE INDEX IF NOT EXISTS idx_signal_perf_result ON nba_signal_performance(result);

-- =============================================
-- 5. MOMENTUM EVENTS (Key game moments)
-- =============================================
CREATE TABLE IF NOT EXISTS nba_momentum_events (
    event_id BIGSERIAL PRIMARY KEY,
    game_id TEXT NOT NULL,
    ts TIMESTAMPTZ DEFAULT NOW(),
    elapsed_min NUMERIC,
    
    event_type TEXT NOT NULL,
    event_subtype TEXT,
    
    -- Context
    score_home INT,
    score_away INT,
    run_points INT,
    run_minutes NUMERIC,
    
    -- Impact
    estimated_impact_points NUMERIC,
    market_moved BOOLEAN,
    market_delta NUMERIC,
    
    details JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_momentum_game_ts ON nba_momentum_events(game_id, ts);
CREATE INDEX IF NOT EXISTS idx_momentum_type ON nba_momentum_events(event_type);

-- =============================================
-- 6. PLAYER PERFORMANCE TRACKING
-- =============================================
CREATE TABLE IF NOT EXISTS nba_player_game_stats (
    stat_id BIGSERIAL PRIMARY KEY,
    game_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    player_name TEXT,
    team TEXT,
    
    -- Box stats
    minutes NUMERIC,
    points INT,
    rebounds INT,
    assists INT,
    steals INT,
    blocks INT,
    turnovers INT,
    fouls INT,
    
    -- Shooting
    fgm INT, fga INT,
    pm3 INT, pa3 INT,
    ftm INT, fta INT,
    
    -- Advanced
    plus_minus INT,
    usage_rate NUMERIC,
    ts_pct NUMERIC,
    
    -- Tracking
    is_starter BOOLEAN,
    dnp_reason TEXT,
    injury_status TEXT,
    
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_stats_game ON nba_player_game_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_player ON nba_player_game_stats(player_id);

-- =============================================
-- 7. BETTING SIMULATION LOG (Paper trading)
-- =============================================
CREATE TABLE IF NOT EXISTS nba_bet_simulation (
    sim_id BIGSERIAL PRIMARY KEY,
    signal_id BIGINT,
    ts TIMESTAMPTZ DEFAULT NOW(),
    
    -- Bet details
    bet_type TEXT,
    bet_side TEXT,
    line_at_bet NUMERIC,
    juice_at_bet INT,
    
    -- Sizing (paper)
    units NUMERIC DEFAULT 1,
    
    -- Result
    result TEXT,
    pnl_units NUMERIC,
    
    graded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bet_sim_result ON nba_bet_simulation(result);

-- =============================================
-- 8. SYSTEM HEALTH METRICS
-- =============================================
CREATE TABLE IF NOT EXISTS nba_system_metrics (
    metric_id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ DEFAULT NOW(),
    function_name TEXT NOT NULL,
    
    -- Performance
    execution_time_ms INT,
    games_processed INT,
    signals_emitted INT,
    errors INT,
    
    -- Resources
    db_queries INT,
    external_api_calls INT,
    
    -- Health
    success_rate NUMERIC,
    avg_latency_ms NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_system_metrics_ts ON nba_system_metrics(ts DESC);
CREATE INDEX IF NOT EXISTS idx_system_metrics_fn ON nba_system_metrics(function_name);

-- =============================================
-- RLS POLICIES (READ for anon, WRITE for service)
-- =============================================
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN 
        SELECT unnest(ARRAY[
            'nba_game_state_history',
            'nba_model_predictions', 
            'nba_market_history',
            'nba_signal_performance',
            'nba_momentum_events',
            'nba_player_game_stats',
            'nba_bet_simulation',
            'nba_system_metrics'
        ])
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Anon read %I" ON %I', tbl, tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Service write %I" ON %I', tbl, tbl);
        EXECUTE format('CREATE POLICY "Anon read %I" ON %I FOR SELECT TO anon USING (true)', tbl, tbl);
        EXECUTE format('CREATE POLICY "Service write %I" ON %I FOR ALL TO service_role USING (true)', tbl, tbl);
    END LOOP;
END;
$$;

-- =============================================
-- SUMMARY VIEWS FOR ANALYTICS
-- =============================================

-- Daily signal performance
CREATE OR REPLACE VIEW nba_daily_performance AS
SELECT 
    DATE(signal_ts) as date,
    window_name,
    signal_side,
    COUNT(*) as signals,
    COUNT(*) FILTER (WHERE result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE result = 'LOSS') as losses,
    ROUND(AVG(edge_at_signal), 2) as avg_edge,
    ROUND(SUM(roi_units), 2) as total_units
FROM nba_signal_performance
GROUP BY DATE(signal_ts), window_name, signal_side
ORDER BY date DESC, window_name;

-- Model accuracy by time of game
CREATE OR REPLACE VIEW nba_model_accuracy_by_period AS
SELECT 
    CASE 
        WHEN elapsed_min < 12 THEN 'Q1'
        WHEN elapsed_min < 24 THEN 'Q2'
        WHEN elapsed_min < 36 THEN 'Q3'
        ELSE 'Q4'
    END as period,
    COUNT(*) as predictions,
    ROUND(AVG(ABS(edge_z)), 2) as avg_edge,
    ROUND(STDDEV(edge_z), 2) as edge_volatility
FROM nba_model_predictions
GROUP BY period
ORDER BY period;

-- =============================================
-- VERIFICATION
-- =============================================
SELECT 'comprehensive_data_lake_created' as status,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'nba_%') as nba_tables;
