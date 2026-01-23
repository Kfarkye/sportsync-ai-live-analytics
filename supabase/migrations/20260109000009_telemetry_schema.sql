
-- Sports Telemetry Engine v2.0
-- Parallel Architecture: Event Sourcing & Lag Analytics

-- 1. Raw Odds Log (Append-Only Event Store)
CREATE TABLE IF NOT EXISTS public.raw_odds_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    game_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    market TEXT NOT NULL, -- 'h2h', 'spreads', 'totals'
    side TEXT NOT NULL,   -- 'home', 'away', 'over', 'under', 'draw'
    book TEXT NOT NULL,
    line NUMERIC NOT NULL,
    price INT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Idempotency / Deduplication Key
    CONSTRAINT raw_odds_log_unique_event UNIQUE (game_id, market, side, book, ts)
);

-- Index for temporal queries (Lag Analysis)
CREATE INDEX IF NOT EXISTS idx_raw_odds_log_lookup 
ON public.raw_odds_log(game_id, market, side, book, ts DESC);


-- 2. Live Market State (The Mutable "Now")
-- Optimized for O(1) Reads during Ingestion
CREATE TABLE IF NOT EXISTS public.live_market_state (
    game_id TEXT NOT NULL,
    market TEXT NOT NULL,
    side TEXT NOT NULL,
    book TEXT NOT NULL,
    
    line NUMERIC NOT NULL,
    price INT NOT NULL,
    last_update_ts TIMESTAMPTZ NOT NULL,
    
    PRIMARY KEY (game_id, market, side, book)
);

-- Index for retrieving all books for a specific market (Consensus Calculation)
CREATE INDEX IF NOT EXISTS idx_live_market_state_consensus 
ON public.live_market_state(game_id, market, side);


-- 3. Derived Consensus Log (The "Tape")
-- Records when the "True Price" changes
CREATE TABLE IF NOT EXISTS public.derived_consensus_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    game_id TEXT NOT NULL,
    market TEXT NOT NULL,
    side TEXT NOT NULL,
    
    consensus_line NUMERIC NOT NULL,
    active_books INT NOT NULL,
    ruleset_version TEXT NOT NULL, -- e.g. 'v2.0-median'
    
    ts TIMESTAMPTZ NOT NULL, -- The moment consensus shifted
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_derived_consensus_log_stream 
ON public.derived_consensus_log(game_id, ts ASC);


-- 4. Derived Lag Metrics (Analytical Store)
-- Who moves first? Who follows?
CREATE TABLE IF NOT EXISTS public.derived_lag_metrics (
    game_id TEXT NOT NULL,
    book TEXT NOT NULL,
    event_ts TIMESTAMPTZ NOT NULL, -- Link to Consensus Event
    ruleset_version TEXT NOT NULL,
    
    reaction_ts TIMESTAMPTZ NOT NULL,
    lag_ms INT NOT NULL, -- Negative = Leader, Positive = Follower
    move_type TEXT NOT NULL CHECK (move_type IN ('LEADER', 'FOLLOWER')),
    
    PRIMARY KEY (game_id, book, event_ts, ruleset_version)
);

-- RLS: Enable Read/Write for everyone (Internal Tool Focus first, refine later if needed)
ALTER TABLE public.raw_odds_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON public.raw_odds_log FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.live_market_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON public.live_market_state FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.derived_consensus_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON public.derived_consensus_log FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.derived_lag_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON public.derived_lag_metrics FOR ALL USING (true) WITH CHECK (true);
