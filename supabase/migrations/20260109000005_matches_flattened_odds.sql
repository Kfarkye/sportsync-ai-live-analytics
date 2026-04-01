-- 20260109000005_matches_flattened_odds.sql
-- Adds flattened odds columns to matches table for faster querying and compatibility with live-sync services.

-- 1. Add flattened odds columns
ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS odds_home_ml_safe INTEGER,
ADD COLUMN IF NOT EXISTS odds_away_ml_safe INTEGER,
ADD COLUMN IF NOT EXISTS odds_home_spread_safe NUMERIC,
ADD COLUMN IF NOT EXISTS odds_away_spread_safe NUMERIC,
ADD COLUMN IF NOT EXISTS odds_total_safe NUMERIC;

-- 2. Add metadata and status columns
ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS status_state TEXT,
ADD COLUMN IF NOT EXISTS last_odds_update TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS odds_api_event_id TEXT;

-- 3. Add index for faster lookups by external event ID
CREATE INDEX IF NOT EXISTS idx_matches_odds_api_event_id ON public.matches(odds_api_event_id);

-- 4. Verification
SELECT 'Flattened odds columns added and indexed' as status;
