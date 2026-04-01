-- =================================================================
-- Professional Odds Resilience & Ledger
-- Capture Opening, Closing, and Tick-by-Tick Line Movement
-- =================================================================

-- 1. Universal Market History Ledger (Action Network Grade)
CREATE TABLE IF NOT EXISTS public.market_history (
    id BIGSERIAL PRIMARY KEY,
    match_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    league_id TEXT NOT NULL,
    ts TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'consensus',
    
    -- Totals
    total_line NUMERIC,
    over_price INTEGER,
    under_price INTEGER,
    
    -- Spreads
    home_spread NUMERIC,
    away_spread NUMERIC,
    home_spread_price INTEGER,
    away_spread_price INTEGER,
    
    -- Moneyline
    home_ml INTEGER,
    away_ml INTEGER,
    draw_ml INTEGER,

    -- Metadata
    is_live BOOLEAN DEFAULT FALSE,
    provider TEXT
);

CREATE INDEX IF NOT EXISTS idx_market_history_match_ts ON market_history(match_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_market_history_league ON market_history(league_id);

-- 2. Add Milestone Flags to Matches
-- These flags prevent live/stale data from overwriting established benchmarks
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS is_opening_locked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_closing_locked BOOLEAN DEFAULT FALSE;

-- 3. RLS Policies
ALTER TABLE public.market_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read market_history" ON market_history;
CREATE POLICY "Public read market_history" ON market_history FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Service write market_history" ON market_history;
CREATE POLICY "Service write market_history" ON market_history FOR ALL TO service_role USING (true);

-- 4. Verification Check
SELECT 'Odds Ledger Infrastructure Deployed' as status;
