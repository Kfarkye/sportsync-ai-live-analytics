-- 20260109000002_db_hardening.sql
-- Hardens the database for high-throughput odds ingestion.

-- 1. Ensure market_feeds has a unique constraint for onConflict
CREATE UNIQUE INDEX IF NOT EXISTS market_feeds_external_id_uq ON public.market_feeds (external_id);

-- 2. Optimize matches query window for syncToMatchesTable
CREATE INDEX IF NOT EXISTS matches_league_start_time_idx ON public.matches (league_id, start_time);

-- 3. Ensure entity_mappings fast lookups for both providers
CREATE UNIQUE INDEX IF NOT EXISTS entity_mappings_provider_external_uq ON public.entity_mappings (provider, external_id);
CREATE INDEX IF NOT EXISTS idx_entity_mappings_canonical_provider ON public.entity_mappings (canonical_id, provider);

-- 4. Opening lines one row per match
CREATE UNIQUE INDEX IF NOT EXISTS opening_lines_match_id_uq ON public.opening_lines (match_id);

-- 5. Market history retrieval (for audit and charts)
CREATE INDEX IF NOT EXISTS market_history_match_id_created_idx ON public.market_history (match_id, ts);
