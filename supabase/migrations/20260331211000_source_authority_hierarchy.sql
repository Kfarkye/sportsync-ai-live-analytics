-- Source Authority Hierarchy: ranked trust levels for data provenance
-- Applied to Supabase via MCP on 2026-03-31

DO $$ BEGIN
  CREATE TYPE source_authority_level AS ENUM (
    'INTERNAL', 'PARTNER_API', 'AI_INFERENCE', 'PREDICTION_MKT', 'COMMUNITY', 'BACKFILL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add source_authority column to canonical tables
ALTER TABLE canonical_games ADD COLUMN IF NOT EXISTS source_authority source_authority_level;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS source_authority source_authority_level;
ALTER TABLE live_game_state ADD COLUMN IF NOT EXISTS source_authority source_authority_level;
ALTER TABLE pregame_intel ADD COLUMN IF NOT EXISTS source_authority source_authority_level;
ALTER TABLE market_feeds ADD COLUMN IF NOT EXISTS source_authority source_authority_level;

-- Resolver function: maps writer name to authority level
CREATE OR REPLACE FUNCTION resolve_source_authority(writer_name text)
RETURNS source_authority_level LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE
    WHEN writer_name IN ('finalize-games-cron','grade-picks-cron','grade-chat-picks') THEN 'INTERNAL'
    WHEN writer_name LIKE 'espn%' OR writer_name LIKE 'nba-%' OR writer_name LIKE 'nhl-%'
         OR writer_name LIKE 'mlb-%' OR writer_name LIKE 'nfl-%' OR writer_name LIKE 'soccer-%'
         OR writer_name IN ('ingest-odds','ingest-odds-v3','get-odds','fetch-matches',
                            'espn-sync','espn-stats-drain','capture-opening-lines',
                            'fetch-daily-schedules','sports-data-sync','ingest-live-games',
                            'sync-player-props','sync-player-game-stats','drain-espn-probabilities',
                            'live-odds-tracker','snapshot-lines','scan-injuries','scan-team-context',
                            'fetch-pregame-officials','fetch-starting-goalies','ingest-game-events')
         THEN 'PARTNER_API'
    WHEN writer_name LIKE 'pregame-intel%' OR writer_name LIKE 'sharp-%' OR writer_name LIKE 'ai-%'
         OR writer_name IN ('generate-pregame-context','generate-daily-thesis','daily-thesis',
                            'analyze-game','analyze-match','batch-analyze-matches',
                            'news-generator','batch-news-generator','batch-recap-generator',
                            'live-intelligence-card','live-edge-calculator','ref-edge-reasoning',
                            'nba-run-model','nba-calibrate-weekly','multimodal','chat-edge')
         THEN 'AI_INFERENCE'
    WHEN writer_name LIKE 'poly%' OR writer_name LIKE 'kalshi%'
         OR writer_name IN ('ingest-poly-sports','drain-kalshi-orderbook','live-market-pulse')
         THEN 'PREDICTION_MKT'
    WHEN writer_name LIKE 'reddit%' THEN 'COMMUNITY'
    WHEN writer_name LIKE 'backfill%' OR writer_name LIKE '%backfill%' THEN 'BACKFILL'
    ELSE 'PARTNER_API'
  END;
END;
$$;

-- Backfill existing rows
UPDATE canonical_games SET source_authority = 'PARTNER_API' WHERE source_authority IS NULL;
