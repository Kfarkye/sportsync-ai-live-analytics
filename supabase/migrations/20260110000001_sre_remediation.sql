-- 20260110000001_sre_remediation.sql
-- SRE & Security Remediation
-- Fixes P0 Security Vulnerabilities (Open RLS) and Performance Issues (Redundant Index).

-- -----------------------------------------------------------------------------
-- 1. SECURITY: Lock down Telemetry (Fix "Allow All" Vulnerability)
-- -----------------------------------------------------------------------------

-- Drop permissive policies
DROP POLICY IF EXISTS "Enable all access" ON public.raw_odds_log;
DROP POLICY IF EXISTS "Enable all access" ON public.live_market_state;

-- Drop existings restrictive policies to allow re-run (Idempotency)
DROP POLICY IF EXISTS "Service Role Only" ON public.raw_odds_log;
DROP POLICY IF EXISTS "Service Role Only" ON public.live_market_state;

-- Create restrictive policies (Service Role / Internal Only)
-- This prevents anonymous users from injecting fake telemetry or deleting logs.
CREATE POLICY "Service Role Only" ON public.raw_odds_log 
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service Role Only" ON public.live_market_state 
FOR ALL TO service_role USING (true) WITH CHECK (true);


-- -----------------------------------------------------------------------------
-- 2. PERFORMANCE: Drop Redundant Index
-- -----------------------------------------------------------------------------

-- The Primary Key on live_market_state is (game_id, market, side, book).
-- The index idx_live_market_state_lookup was (game_id, book, market, side).
-- Postgres can effectively use the PK for this, making the secondary index 
-- pure write overhead (doubling I/O).
DROP INDEX IF EXISTS idx_live_market_state_lookup;


-- -----------------------------------------------------------------------------
-- 3. OPTIMIZATION: Index for Zombie Filter
-- -----------------------------------------------------------------------------

-- We query `last_update_ts` frequently to find "Zombie Books" (>10 min old).
-- This index ensures that cleanup query is O(log n) instead of O(n).
CREATE INDEX IF NOT EXISTS idx_live_market_state_updated 
ON public.live_market_state(last_update_ts);
