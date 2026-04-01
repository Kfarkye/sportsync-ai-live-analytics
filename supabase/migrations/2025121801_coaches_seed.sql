-- ============================================================================
-- COACHES TABLE - Ground Truth (Seeded Data) - 2025-26 SEASON
-- Simple reference table: team_id → coach name
-- Updated only when coaching changes occur (rare)
-- ============================================================================

CREATE TABLE IF NOT EXISTS coaches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id TEXT NOT NULL,           -- ESPN team ID
    team_name TEXT NOT NULL,         -- e.g., "Kansas City Chiefs"
    team_abbrev TEXT NOT NULL,       -- e.g., "KC"
    coach_name TEXT NOT NULL,        -- e.g., "Andy Reid"
    sport TEXT NOT NULL,             -- e.g., "NFL", "NBA", "MLB", "NHL"
    league_id TEXT NOT NULL,         -- e.g., "nfl", "nba", "mlb", "nhl"
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(team_id, sport)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_coaches_team_sport ON coaches(team_id, sport);
CREATE INDEX IF NOT EXISTS idx_coaches_league ON coaches(league_id);

-- Coaches table is now empty and ready for real-time ingestion.

-- ============================================================================
-- TRIGGER: Auto-update updated_at on changes
-- ============================================================================
CREATE OR REPLACE FUNCTION update_coaches_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS coaches_updated_at ON coaches;
CREATE TRIGGER coaches_updated_at
    BEFORE UPDATE ON coaches
    FOR EACH ROW
    EXECUTE FUNCTION update_coaches_timestamp();

-- ============================================================================
-- RLS POLICIES (Public Read Access)
-- ============================================================================
ALTER TABLE coaches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coaches are publicly readable" ON coaches;
CREATE POLICY "Coaches are publicly readable" ON coaches
    FOR SELECT TO anon, authenticated
    USING (true);

COMMENT ON TABLE coaches IS 'Ground truth coach data for 2025-26 season. Updated manually when coaching changes occur.';
