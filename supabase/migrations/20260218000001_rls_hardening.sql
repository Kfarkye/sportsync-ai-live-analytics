-- ═══════════════════════════════════════════════════════════════════════════
-- RLS HARDENING: Restrict write access to service_role only
-- Audit finding: 14+ tables allowed unrestricted writes via anon key
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. NBA Model Core Tables (from 20251231000009_nba_model_core.sql)
--    Previous: FOR ALL USING (true) — anyone could read AND write
--    Fix: Split into read-only public + write for service_role only
-- ───────────────────────────────────────────────────────────────────────────

-- nba_games
DROP POLICY IF EXISTS "Service role full access" ON nba_games;
CREATE POLICY "Public read nba_games" ON nba_games
  FOR SELECT USING (true);
CREATE POLICY "Service write nba_games" ON nba_games
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- nba_ticks
DROP POLICY IF EXISTS "Service role full access" ON nba_ticks;
CREATE POLICY "Public read nba_ticks" ON nba_ticks
  FOR SELECT USING (true);
CREATE POLICY "Service write nba_ticks" ON nba_ticks
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- nba_snapshots
DROP POLICY IF EXISTS "Service role full access" ON nba_snapshots;
CREATE POLICY "Public read nba_snapshots" ON nba_snapshots
  FOR SELECT USING (true);
CREATE POLICY "Service write nba_snapshots" ON nba_snapshots
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- nba_decisions
DROP POLICY IF EXISTS "Service role full access" ON nba_decisions;
CREATE POLICY "Public read nba_decisions" ON nba_decisions
  FOR SELECT USING (true);
CREATE POLICY "Service write nba_decisions" ON nba_decisions
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- nba_team_priors
DROP POLICY IF EXISTS "Service role full access" ON nba_team_priors;
CREATE POLICY "Public read nba_team_priors" ON nba_team_priors
  FOR SELECT USING (true);
CREATE POLICY "Service write nba_team_priors" ON nba_team_priors
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- nba_player_epm
DROP POLICY IF EXISTS "Service role full access" ON nba_player_epm;
CREATE POLICY "Public read nba_player_epm" ON nba_player_epm
  FOR SELECT USING (true);
CREATE POLICY "Service write nba_player_epm" ON nba_player_epm
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- nba_calibration_runs
DROP POLICY IF EXISTS "Service role full access" ON nba_calibration_runs;
CREATE POLICY "Public read nba_calibration_runs" ON nba_calibration_runs
  FOR SELECT USING (true);
CREATE POLICY "Service write nba_calibration_runs" ON nba_calibration_runs
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Telemetry Tables (from 20260109000009_telemetry_schema.sql)
--    Previous: FOR ALL USING (true) WITH CHECK (true)
--    Fix: Read-only public + service_role writes
-- ───────────────────────────────────────────────────────────────────────────

-- raw_odds_log
DROP POLICY IF EXISTS "Enable all access" ON raw_odds_log;
CREATE POLICY "Public read raw_odds_log" ON raw_odds_log
  FOR SELECT USING (true);
CREATE POLICY "Service write raw_odds_log" ON raw_odds_log
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- live_market_state
DROP POLICY IF EXISTS "Enable all access" ON live_market_state;
CREATE POLICY "Public read live_market_state" ON live_market_state
  FOR SELECT USING (true);
CREATE POLICY "Service write live_market_state" ON live_market_state
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- derived_consensus_log
DROP POLICY IF EXISTS "Enable all access" ON derived_consensus_log;
CREATE POLICY "Public read derived_consensus_log" ON derived_consensus_log
  FOR SELECT USING (true);
CREATE POLICY "Service write derived_consensus_log" ON derived_consensus_log
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- derived_lag_metrics
DROP POLICY IF EXISTS "Enable all access" ON derived_lag_metrics;
CREATE POLICY "Public read derived_lag_metrics" ON derived_lag_metrics
  FOR SELECT USING (true);
CREATE POLICY "Service write derived_lag_metrics" ON derived_lag_metrics
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Sharp Movements (from 20260109000008_grading_schema_rls.sql)
--    Previous: FOR ALL USING (true) WITH CHECK (true) — marked "TEMPORARY"
--    Fix: Remove temporary policy, restrict to service_role
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Enable write access for all users" ON sharp_movements;
CREATE POLICY "Public read sharp_movements" ON sharp_movements
  FOR SELECT USING (true);
CREATE POLICY "Service write sharp_movements" ON sharp_movements
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Starting Goalies (from 20260101000004_starting_goalies.sql)
--    Previous: INSERT WITH CHECK (true), UPDATE USING (true) — anon writes
--    Fix: Restrict insert/update to service_role
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Service insert starting_goalies" ON starting_goalies;
DROP POLICY IF EXISTS "Service update starting_goalies" ON starting_goalies;
CREATE POLICY "Service write starting_goalies" ON starting_goalies
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 5. AI Chat Picks (from 20260116000002_fix_conversation_persistence.sql)
--    Previous: INSERT WITH CHECK (true) — anon can insert picks
--    Fix: Client inserts via ai-chat edge function (service_role), not direct
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Anon can insert picks" ON ai_chat_picks;
-- The "Service role full access" policy already exists and is correct
