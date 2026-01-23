-- =================================================================
-- Pregame Intel Data Lake
-- Store Gemini's grounded research for instant serving & long-term value
-- Vision: "Daily Faceoff for all sports" - fresh intel every morning
-- =================================================================

-- 1. Main intel storage table
CREATE TABLE IF NOT EXISTS pregame_intel (
    intel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    league_id TEXT NOT NULL,
    
    -- Teams
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    
    -- Game timing
    game_date DATE NOT NULL,
    start_time TIMESTAMPTZ,
    
    -- The structured intel
    headline TEXT NOT NULL,
    cards JSONB NOT NULL DEFAULT '[]',  -- Array of IntelCard objects
    sources JSONB NOT NULL DEFAULT '[]', -- Array of source citations
    
    -- Metadata
    freshness TEXT DEFAULT 'LIVE',  -- LIVE, RECENT, STALE
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    -- For cron tracking
    cron_batch_id TEXT,
    generation_ms INT,  -- How long it took to generate
    
    -- Versioning for updates
    version INT DEFAULT 1,
    
    UNIQUE(match_id, game_date)  -- One intel per game per day
);

-- 2. Individual intel cards (normalized for querying)
-- This lets us search across ALL intel cards for injuries, trends, etc.
CREATE TABLE IF NOT EXISTS pregame_intel_cards (
    card_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intel_id UUID REFERENCES pregame_intel(intel_id) ON DELETE CASCADE,
    match_id TEXT NOT NULL,
    
    -- Card data
    category TEXT NOT NULL,  -- INJURY, LINEUP, TREND, etc.
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    details JSONB,
    impact TEXT,  -- HIGH, MEDIUM, LOW, NEUTRAL
    
    -- Source citation
    source_title TEXT,
    source_url TEXT,
    source_domain TEXT,
    
    -- For search/discovery
    entity_names TEXT[],  -- Player names, team names mentioned
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Intel generation log (audit trail)
CREATE TABLE IF NOT EXISTS pregame_intel_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id TEXT NOT NULL,
    
    -- Stats
    matches_processed INT DEFAULT 0,
    matches_succeeded INT DEFAULT 0,
    matches_failed INT DEFAULT 0,
    total_cards_generated INT DEFAULT 0,
    total_sources_cited INT DEFAULT 0,
    
    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INT,
    
    -- Details
    errors JSONB DEFAULT '[]',
    sports_covered TEXT[],
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_pregame_intel_match ON pregame_intel(match_id);
CREATE INDEX IF NOT EXISTS idx_pregame_intel_date ON pregame_intel(game_date);
CREATE INDEX IF NOT EXISTS idx_pregame_intel_sport ON pregame_intel(sport, league_id);
CREATE INDEX IF NOT EXISTS idx_pregame_intel_freshness ON pregame_intel(freshness, expires_at);

CREATE INDEX IF NOT EXISTS idx_intel_cards_category ON pregame_intel_cards(category);
CREATE INDEX IF NOT EXISTS idx_intel_cards_match ON pregame_intel_cards(match_id);
CREATE INDEX IF NOT EXISTS idx_intel_cards_entities ON pregame_intel_cards USING GIN(entity_names);

-- RLS Policies
ALTER TABLE pregame_intel ENABLE ROW LEVEL SECURITY;
ALTER TABLE pregame_intel_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE pregame_intel_log ENABLE ROW LEVEL SECURITY;

-- Everyone can read intel (it's public content)
CREATE POLICY "pregame_intel_public_read" ON pregame_intel
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "pregame_intel_cards_public_read" ON pregame_intel_cards
    FOR SELECT TO anon, authenticated USING (true);

-- Only service role can write
CREATE POLICY "pregame_intel_service_write" ON pregame_intel
    FOR ALL TO service_role USING (true);

CREATE POLICY "pregame_intel_cards_service_write" ON pregame_intel_cards
    FOR ALL TO service_role USING (true);

CREATE POLICY "pregame_intel_log_service_all" ON pregame_intel_log
    FOR ALL TO service_role USING (true);

-- Helper function to mark stale intel
CREATE OR REPLACE FUNCTION mark_stale_intel()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE pregame_intel
    SET freshness = 'STALE'
    WHERE expires_at < NOW() AND freshness != 'STALE';
END;
$$;

-- Verify
SELECT 'pregame_intel tables created' AS status;
