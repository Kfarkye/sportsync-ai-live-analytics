-- 20260110000000_telemetry_hardening.sql
-- "Google Quality" Indexing Strategy for High-Volume Log Ingestion
-- Designed for "Turbo Mode" (20s updates) which generates massive log volume.

-- 1. Raw Odds Log: Append-only optimization
-- BRIN (Block Range Index) is 99% smaller than B-Tree and perfect for time-ordered logs.
CREATE INDEX IF NOT EXISTS idx_raw_odds_log_created_brin 
ON public.raw_odds_log USING brin(ingested_at);

-- B-Tree for active game lookup (High Cardinality)
CREATE INDEX IF NOT EXISTS idx_raw_odds_log_game_id 
ON public.raw_odds_log(game_id);

-- 2. Live Market State: High-Frequency Read/Write
-- Composite index for identifying specific bookmaker lines instantly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_market_state_lookup 
ON public.live_market_state(game_id, book, market, side);

-- Index for "Zombie Filter" cleanup (finding old records)
CREATE INDEX IF NOT EXISTS idx_live_market_state_updated 
ON public.live_market_state(last_update_ts);

-- 3. Consensus & Lag Metrics: Analytics Support
-- Efficient sparkline queries
CREATE INDEX IF NOT EXISTS idx_derived_consensus_log_sparkline 
ON public.derived_consensus_log(game_id, ts DESC);

-- Lag monitoring queries
-- Corrected: 'provider' -> 'book', 'measured_at' -> 'event_ts'
CREATE INDEX IF NOT EXISTS idx_derived_lag_metrics_provider 
ON public.derived_lag_metrics(book, event_ts DESC);
