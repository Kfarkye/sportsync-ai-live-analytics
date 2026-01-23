-- 20260120_entity_registry.sql
-- Formalizes the persistent identity layer for teams across providers.
-- Extends the initial team_mappings implementation.

-- 1. Ensure team_mappings has provider context
ALTER TABLE team_mappings ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'THE_ODDS_API';

-- 2. Create the Identity Gap View
-- This exposes games in the feeds that have no mapping or canonical match
DROP VIEW IF EXISTS v_identity_gaps;
CREATE OR REPLACE VIEW v_identity_gaps AS
SELECT 
  f.sport_key,
  f.home_team as raw_home,
  f.away_team as raw_away,
  f.last_updated,
  m.id as potential_match_id,
  m.home_team as db_home,
  m.away_team as db_away
FROM market_feeds f
LEFT JOIN team_mappings tm1 ON f.home_team = tm1.raw_external_name AND (tm1.league_id = f.sport_key OR tm1.league_id = 'GLOBAL')
LEFT JOIN team_mappings tm2 ON f.away_team = tm2.raw_external_name AND (tm2.league_id = f.sport_key OR tm2.league_id = 'GLOBAL')
LEFT JOIN matches m ON (
    similarity(f.home_team, m.home_team) > 0.4 
)
WHERE tm1.id IS NULL OR tm2.id IS NULL;

-- 3. Function to Autonomously Heal Identity Gaps
-- This is called by the Edge Function after a successful fuzzy match
CREATE OR REPLACE FUNCTION heal_team_identity(
    p_league_id TEXT,
    p_raw_name TEXT,
    p_canonical_name TEXT,
    p_provider TEXT DEFAULT 'THE_ODDS_API'
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO team_mappings (league_id, raw_external_name, canonical_name, provider, is_verified)
    VALUES (p_league_id, p_raw_name, p_canonical_name, p_provider, false)
    ON CONFLICT (league_id, raw_external_name) 
    DO UPDATE SET 
        canonical_name = EXCLUDED.canonical_name,
        created_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
