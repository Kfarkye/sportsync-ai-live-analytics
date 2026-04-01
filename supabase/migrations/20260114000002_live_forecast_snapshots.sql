-- =============================================================================
-- LIVE FORECAST SNAPSHOTS (v1.1)
-- Permanent historical ledger of game snapshots for analytics and UI
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.live_forecast_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    league_id TEXT NOT NULL,
    period INTEGER,
    clock TEXT,
    away_score INTEGER DEFAULT 0,
    home_score INTEGER DEFAULT 0,
    
    -- Market Data
    market_total FLOAT,
    
    -- Model Data (Deterministic Signals)
    fair_total FLOAT,
    p10_total FLOAT,
    p90_total FLOAT,
    variance_sd FLOAT,
    edge_points FLOAT,
    edge_state TEXT, -- 'PLAY', 'LEAN', 'NEUTRAL'
    regime TEXT,
    
    -- Pace Data
    observed_ppm FLOAT,
    projected_ppm FLOAT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Deduplication Constraint: One snapshot per clock state
    CONSTRAINT unique_match_clock UNIQUE (match_id, period, clock)
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_match_id ON public.live_forecast_snapshots(match_id);
CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_created_at ON public.live_forecast_snapshots(created_at DESC);

-- RLS Policies
ALTER TABLE public.live_forecast_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read-only access to forecast snapshots" ON public.live_forecast_snapshots;
CREATE POLICY "Allow public read-only access to forecast snapshots"
ON public.live_forecast_snapshots FOR SELECT
TO anon, authenticated
USING (true);

-- Restrict all mutations to service_role only
DROP POLICY IF EXISTS "service_role_full_access" ON public.live_forecast_snapshots;
CREATE POLICY "service_role_full_access"
ON public.live_forecast_snapshots FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON TABLE public.live_forecast_snapshots IS 'Permanent ledger of live game snapshots. Hardened with unique clock constraint and service_role security.';

