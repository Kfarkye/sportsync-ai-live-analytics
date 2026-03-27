
-- ==============================================
-- ENFORCE ONE-TO-ONE ALIGNMENT
-- Each registry object → one API family → one publish owner → one runtime tier
-- ==============================================

-- Add the alignment fields
ALTER TABLE public.data_registry
  ADD COLUMN IF NOT EXISTS api_family TEXT,
  ADD COLUMN IF NOT EXISTS api_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS publish_owner TEXT,
  ADD COLUMN IF NOT EXISTS consumer_tier TEXT
    CHECK (consumer_tier IN ('hub', 'app', 'source', 'job'));

COMMENT ON COLUMN public.data_registry.api_family IS 
  'API object family this dataset belongs to. One API family = one delivery contract.';
COMMENT ON COLUMN public.data_registry.api_endpoint IS 
  'The API route that serves this object. Consumer reads this, never the raw table.';
COMMENT ON COLUMN public.data_registry.publish_owner IS 
  'The single Cloud Function or job that publishes to this object. If 2 jobs can publish the same family, you recreate chaos.';
COMMENT ON COLUMN public.data_registry.consumer_tier IS 
  'What the consumer is reading: hub (SSOT), app (evidence), source (raw), job (control).';

-- Populate alignment for all 19 objects
UPDATE public.data_registry SET
  api_family = 'games',
  api_endpoint = '/api/games/current',
  publish_owner = 'syncHubGamesCurrent',
  consumer_tier = 'hub'
WHERE canonical_name = 'HUB_GAMES_CURRENT';

UPDATE public.data_registry SET
  api_family = 'games',
  api_endpoint = '/api/games/live',
  publish_owner = 'syncHubGamesLive',
  consumer_tier = 'hub'
WHERE canonical_name = 'HUB_GAMES_LIVE';

UPDATE public.data_registry SET
  api_family = 'games',
  api_endpoint = '/api/games/canonical',
  publish_owner = 'syncHubGamesCanonical',
  consumer_tier = 'hub'
WHERE canonical_name = 'HUB_GAMES_CANONICAL';

UPDATE public.data_registry SET
  api_family = 'teams',
  api_endpoint = '/api/teams',
  publish_owner = 'syncHubTeams',
  consumer_tier = 'hub'
WHERE canonical_name = 'HUB_TEAMS';

UPDATE public.data_registry SET
  api_family = 'refs',
  api_endpoint = '/api/refs/tendencies',
  publish_owner = 'syncRefTendencies',
  consumer_tier = 'app'
WHERE canonical_name = 'APP_REF_TENDENCIES_CURRENT';

UPDATE public.data_registry SET
  api_family = 'intel',
  api_endpoint = '/api/intel/pregame',
  publish_owner = 'syncPregameIntel',
  consumer_tier = 'app'
WHERE canonical_name = 'APP_PREGAME_INTEL';

UPDATE public.data_registry SET
  api_family = 'props',
  api_endpoint = '/api/props/player',
  publish_owner = 'syncPlayerProps',
  consumer_tier = 'app'
WHERE canonical_name = 'APP_PLAYER_PROPS';

UPDATE public.data_registry SET
  api_family = 'injuries',
  api_endpoint = '/api/injuries/current',
  publish_owner = 'syncInjuries',
  consumer_tier = 'app'
WHERE canonical_name = 'APP_INJURIES_CURRENT';

UPDATE public.data_registry SET
  api_family = 'recaps',
  api_endpoint = '/api/recaps',
  publish_owner = 'syncGameRecaps',
  consumer_tier = 'app'
WHERE canonical_name = 'APP_GAME_RECAPS';

UPDATE public.data_registry SET
  api_family = 'enrichment',
  api_endpoint = '/api/sources/espn/enrichment',
  publish_owner = 'espnEnrichmentDrain',
  consumer_tier = 'source'
WHERE canonical_name = 'SOURCE_ESPN_ENRICHMENT';

UPDATE public.data_registry SET
  api_family = 'enrichment',
  api_endpoint = '/api/sources/espn/athletes',
  publish_owner = 'espnStatsDrain_athletes',
  consumer_tier = 'source'
WHERE canonical_name = 'SOURCE_ESPN_ATHLETES';

UPDATE public.data_registry SET
  api_family = 'enrichment',
  api_endpoint = '/api/sources/espn/game-logs',
  publish_owner = 'espnStatsDrain_gameLogs',
  consumer_tier = 'source'
WHERE canonical_name = 'SOURCE_ESPN_GAME_LOGS';

UPDATE public.data_registry SET
  api_family = 'enrichment',
  api_endpoint = '/api/sources/espn/team-stats',
  publish_owner = 'espnStatsDrain_teamStats',
  consumer_tier = 'source'
WHERE canonical_name = 'SOURCE_ESPN_TEAM_STATS';

UPDATE public.data_registry SET
  api_family = 'events',
  api_endpoint = '/api/sources/events',
  publish_owner = 'ingestGameEvents',
  consumer_tier = 'source'
WHERE canonical_name = 'SOURCE_GAME_EVENTS';

UPDATE public.data_registry SET
  api_family = 'odds',
  api_endpoint = '/api/sources/odds/market-feeds',
  publish_owner = 'ingestOdds',
  consumer_tier = 'source'
WHERE canonical_name = 'SOURCE_ODDS_MARKET_FEEDS';

UPDATE public.data_registry SET
  api_family = 'odds',
  api_endpoint = '/api/sources/odds/polymarket',
  publish_owner = 'ingestPolySports',
  consumer_tier = 'source'
WHERE canonical_name = 'SOURCE_POLY_ODDS';

UPDATE public.data_registry SET
  api_family = 'control',
  api_endpoint = '/api/control/job-runs',
  publish_owner = 'controlPlane',
  consumer_tier = 'job'
WHERE canonical_name = 'JOB_RUNS';

UPDATE public.data_registry SET
  api_family = 'control',
  api_endpoint = '/api/control/alerts',
  publish_owner = 'controlPlane',
  consumer_tier = 'job'
WHERE canonical_name = 'JOB_ALERTS';

UPDATE public.data_registry SET
  api_family = 'control',
  api_endpoint = '/api/control/registry',
  publish_owner = 'controlPlane',
  consumer_tier = 'job'
WHERE canonical_name = 'JOB_DATA_REGISTRY';

-- ENFORCEMENT: Create a view that shows ownership violations
-- If 2+ objects in the same api_family have different publish_owners, that is a violation
CREATE OR REPLACE VIEW public.v_ownership_violations AS
SELECT 
  api_family,
  consumer_tier,
  count(DISTINCT publish_owner) AS publisher_count,
  array_agg(DISTINCT publish_owner) AS publishers,
  array_agg(canonical_name) AS objects
FROM public.data_registry
WHERE api_family IS NOT NULL
GROUP BY api_family, consumer_tier
HAVING count(DISTINCT publish_owner) > 1;

COMMENT ON VIEW public.v_ownership_violations IS 
  'Shows api_families with more than one publish_owner. If this returns rows, the alignment is broken.';

-- ENFORCEMENT: Create a view that shows the full contract map
CREATE OR REPLACE VIEW public.v_api_contract AS
SELECT 
  consumer_tier,
  api_family,
  api_endpoint,
  canonical_name,
  physical_table,
  publish_owner,
  status,
  destination_system,
  cutover_ready,
  row_count_snapshot
FROM public.data_registry
WHERE api_family IS NOT NULL
ORDER BY 
  CASE consumer_tier 
    WHEN 'hub' THEN 1 
    WHEN 'app' THEN 2 
    WHEN 'source' THEN 3 
    WHEN 'job' THEN 4 
  END,
  api_family,
  canonical_name;

COMMENT ON VIEW public.v_api_contract IS 
  'The product spine. Every row is a delivery contract: one canonical object → one API endpoint → one publish owner → one consumer tier.';
;
