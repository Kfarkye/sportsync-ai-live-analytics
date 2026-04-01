-- OPTIMIZED Tennis Match Sync v2
-- Creates matches from market_feeds and updates odds with proper indexing

-- =============================================================================
-- INDEXES: Ensure fast lookups for tennis sync operations
-- =============================================================================

-- Index for market_feeds tennis filtering
CREATE INDEX IF NOT EXISTS idx_market_feeds_tennis 
ON market_feeds (sport_key) 
WHERE sport_key LIKE 'tennis_%';

-- Index for matches tennis lookup
CREATE INDEX IF NOT EXISTS idx_matches_tennis 
ON matches (league_id) 
WHERE league_id IN ('atp', 'wta');

-- Index for pregame_intel tennis with null spread (targets the UPDATE)
CREATE INDEX IF NOT EXISTS idx_pregame_intel_tennis_no_spread 
ON pregame_intel (sport, home_team, away_team) 
WHERE sport = 'tennis' AND analyzed_spread IS NULL;

-- =============================================================================
-- UPSERT: Sync tennis matches from market_feeds
-- =============================================================================

INSERT INTO matches (
    id,
    league_id,
    sport,
    home_team,
    away_team,
    start_time,
    status,
    current_odds,
    last_odds_update
)
SELECT 
    mf.external_id || '_tennis' as id,
    CASE 
        WHEN mf.sport_key LIKE '%atp%' THEN 'atp'
        WHEN mf.sport_key LIKE '%wta%' THEN 'wta'
        ELSE 'tennis'
    END as league_id,
    'tennis' as sport,
    mf.home_team,
    mf.away_team,
    mf.commence_time as start_time,
    'STATUS_SCHEDULED' as status,
    jsonb_build_object(
        'homeWin', NULLIF((mf.best_h2h->'home'->>'price'), '')::int,
        'awayWin', NULLIF((mf.best_h2h->'away'->>'price'), '')::int,
        'total', NULLIF((mf.best_total->'over'->>'point'), '')::numeric,
        'overOdds', NULLIF((mf.best_total->'over'->>'price'), '')::int,
        'underOdds', NULLIF((mf.best_total->'under'->>'price'), '')::int,
        'homeSpread', NULLIF((mf.best_spread->'home'->>'point'), '')::numeric,
        'awaySpread', NULLIF((mf.best_spread->'away'->>'point'), '')::numeric,
        'homeSpreadOdds', NULLIF((mf.best_spread->'home'->>'price'), '')::int,
        'awaySpreadOdds', NULLIF((mf.best_spread->'away'->>'price'), '')::int,
        'provider', COALESCE(mf.best_h2h->>'bookmaker', 'Consensus'),
        'lastUpdated', mf.last_updated,
        'isInstitutional', true
    ) as current_odds,
    mf.last_updated
FROM market_feeds mf
WHERE mf.sport_key LIKE 'tennis_%'
  AND mf.home_team IS NOT NULL
  AND mf.away_team IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
    home_team = EXCLUDED.home_team,
    away_team = EXCLUDED.away_team,
    start_time = COALESCE(EXCLUDED.start_time, matches.start_time),
    current_odds = EXCLUDED.current_odds,
    last_odds_update = EXCLUDED.last_odds_update
WHERE matches.last_odds_update IS NULL 
   OR matches.last_odds_update < EXCLUDED.last_odds_update;

-- =============================================================================
-- UPDATE: Enrich pregame_intel with odds (using exact match first, fuzzy fallback)
-- =============================================================================

-- First: Exact match on player names
UPDATE pregame_intel pi
SET 
    analyzed_spread = (m.current_odds->>'homeSpread')::numeric,
    home_ml = m.current_odds->>'homeWin',
    away_ml = m.current_odds->>'awayWin'
FROM matches m
WHERE pi.sport = 'tennis'
  AND pi.analyzed_spread IS NULL
  AND m.league_id IN ('atp', 'wta')
  AND LOWER(pi.home_team) = LOWER(m.home_team)
  AND LOWER(pi.away_team) = LOWER(m.away_team);

-- Second: Fuzzy match on last names (for cases like "N. Djokovic" vs "Novak Djokovic")
UPDATE pregame_intel pi
SET 
    analyzed_spread = (m.current_odds->>'homeSpread')::numeric,
    home_ml = m.current_odds->>'homeWin',
    away_ml = m.current_odds->>'awayWin'
FROM matches m
WHERE pi.sport = 'tennis'
  AND pi.analyzed_spread IS NULL
  AND m.league_id IN ('atp', 'wta')
  AND m.current_odds IS NOT NULL
  AND (
    -- Match on last name (most reliable for tennis)
    LOWER(split_part(pi.home_team, ' ', array_length(string_to_array(pi.home_team, ' '), 1))) = 
    LOWER(split_part(m.home_team, ' ', array_length(string_to_array(m.home_team, ' '), 1)))
    AND
    LOWER(split_part(pi.away_team, ' ', array_length(string_to_array(pi.away_team, ' '), 1))) = 
    LOWER(split_part(m.away_team, ' ', array_length(string_to_array(m.away_team, ' '), 1)))
  );

-- =============================================================================
-- VERIFY: Audit the sync results
-- =============================================================================

SELECT 
    'matches' as table_name,
    COUNT(*) FILTER (WHERE league_id IN ('atp', 'wta')) as tennis_total,
    COUNT(*) FILTER (WHERE league_id IN ('atp', 'wta') AND current_odds IS NOT NULL) as with_odds,
    COUNT(*) FILTER (WHERE league_id IN ('atp', 'wta') AND current_odds->>'homeSpread' IS NOT NULL) as with_spread
FROM matches
UNION ALL
SELECT 
    'pregame_intel' as table_name,
    COUNT(*) FILTER (WHERE sport = 'tennis') as tennis_total,
    COUNT(*) FILTER (WHERE sport = 'tennis' AND analyzed_spread IS NOT NULL) as with_odds,
    COUNT(*) FILTER (WHERE sport = 'tennis' AND home_ml IS NOT NULL) as with_spread
FROM pregame_intel;
