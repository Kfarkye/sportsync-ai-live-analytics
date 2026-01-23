-- =================================================================
-- NBA Signal System - Market Movement Tracking
-- Backend data layer for AI synthesis (UI handled separately)
-- =================================================================

-- Add market movement columns to window signals
-- ALTER TABLE nba_window_signals 
-- ADD COLUMN IF NOT EXISTS market_at_open NUMERIC,           -- Opening line
-- ADD COLUMN IF NOT EXISTS market_delta_since_open NUMERIC,  -- Movement since game start
-- ADD COLUMN IF NOT EXISTS market_delta_since_prev NUMERIC,  -- Movement since previous window
-- ADD COLUMN IF NOT EXISTS pace_delta_since_open NUMERIC,    -- Pace change since open
-- ADD COLUMN IF NOT EXISTS drivers JSONB DEFAULT '[]';       -- Top factors for AI narration

-- Store reference market snapshots per game for movement tracking
CREATE TABLE IF NOT EXISTS nba_market_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    game_id TEXT NOT NULL,
    window_name TEXT NOT NULL, -- 'OPEN', 'Q1_END', 'HALFTIME', 'Q3_END'
    ts TIMESTAMPTZ DEFAULT NOW(),
    reference_total NUMERIC NOT NULL,
    reference_spread NUMERIC,
    pace_estimate NUMERIC,
    UNIQUE (game_id, window_name)
);

CREATE INDEX IF NOT EXISTS idx_market_snaps_game ON nba_market_snapshots(game_id);

-- RLS
ALTER TABLE nba_market_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read nba_market_snapshots" ON nba_market_snapshots;
DROP POLICY IF EXISTS "Service role write nba_market_snapshots" ON nba_market_snapshots;
CREATE POLICY "Allow read nba_market_snapshots" ON nba_market_snapshots FOR SELECT USING (true);
CREATE POLICY "Service role write nba_market_snapshots" ON nba_market_snapshots FOR ALL TO service_role USING (true);

-- Verification
SELECT 'market_movement_tracking_added' as status;
