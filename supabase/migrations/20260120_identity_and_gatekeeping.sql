-- 1. Enable pg_trgm for fuzzy matching support
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. League Configuration Table
-- Decouples hardcoded switch/case mapping from Edge Functions
CREATE TABLE IF NOT EXISTS league_config (
    id TEXT PRIMARY KEY, -- e.g., 'uefa.champions', 'nba', 'nfl'
    odds_api_key TEXT NOT NULL, -- e.g., 'soccer_uefa_champs_league'
    espn_league_id TEXT,
    display_name TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. High-Precision Team Mapping Table
-- Stores learned aliases (e.g., 'Kairat' -> 'Kairat Almaty')
CREATE TABLE IF NOT EXISTS team_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_external_name TEXT NOT NULL, -- The name we get from Odds API
    canonical_name TEXT NOT NULL,    -- The name we have in our 'matches' table
    league_id TEXT REFERENCES league_config(id) ON DELETE CASCADE,
    provider TEXT DEFAULT 'THE_ODDS_API',
    is_verified BOOLEAN DEFAULT false, -- Set to true once human/SRE audits the match
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(raw_external_name, league_id, provider)
);

-- 4. Audit View: Discover Identity Gaps
-- Finds unmatched teams that are appearing in odds feeds but missing from DB
CREATE OR REPLACE VIEW v_identity_gaps AS
SELECT 
    mf.sport_key,
    mf.home_team as external_home,
    mf.away_team as external_away,
    mf.last_updated
FROM market_feeds mf
LEFT JOIN team_mappings tm ON (mf.home_team = tm.raw_external_name OR mf.away_team = tm.raw_external_name)
WHERE tm.id IS NULL;

-- 5. Gatekeeping View: Ready for Intelligence
-- STRICT FILTER: Prevents AI from making picks on matches with invalid/null odds
CREATE OR REPLACE VIEW v_ready_for_intel AS
SELECT 
    m.*,
    (m.current_odds->>'homeSpread')::numeric as spread_home,
    (m.current_odds->>'awaySpread')::numeric as spread_away,
    (m.current_odds->>'total')::numeric as game_total
FROM matches m
WHERE m.status IN ('STATUS_SCHEDULED', 'SCHEDULED')
  AND m.start_time > (NOW() - INTERVAL '1 hour') -- Allow recently started games
  AND m.current_odds IS NOT NULL
  AND (m.current_odds->>'homeSpread') IS NOT NULL
  AND (m.current_odds->>'total') IS NOT NULL;

-- 6. Helper: Similarity Matching
-- Use this in Edge Functions to find the best DB match for a generic string
DROP FUNCTION IF EXISTS find_canonical_team(text, text, double precision);

CREATE OR REPLACE FUNCTION find_canonical_team(
    search_name TEXT, 
    search_league_id TEXT, 
    min_similarity FLOAT DEFAULT 0.4
)
RETURNS TABLE (
    db_id TEXT, 
    db_name TEXT, 
    score real
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id as db_id,
        m.home_team as db_name,
        similarity(m.home_team, search_name) as score
    FROM matches m
    WHERE m.league_id = search_league_id
      AND similarity(m.home_team, search_name) >= min_similarity
    UNION ALL
    SELECT 
        m.id,
        m.away_team,
        similarity(m.away_team, search_name)
    FROM matches m
    WHERE m.league_id = search_league_id
      AND similarity(m.away_team, search_name) >= min_similarity
    ORDER BY score DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;
