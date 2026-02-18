-- ═══════════════════════════════════════════════════════════════════════════
-- CHANGE RISKY ON DELETE CASCADE TO ON DELETE RESTRICT
-- Audit finding: 7 foreign keys cascade-delete analytics/audit data
-- when parent rows are removed. This protects historical data from
-- accidental deletion while still allowing explicit cleanup when needed.
--
-- Kept as CASCADE (legitimate parent-child ownership):
--   - game_officials → canonical_games/canonical_officials (join table)
--   - venue_aliases → canonical_venues (alias metadata)
--   - official_aliases → canonical_officials (alias metadata)
--   - nba_snapshots → nba_ticks (derived from ticks)
--   - team_mappings → league_config (config metadata)
--   - team_aliases → canonical_teams (alias metadata)
--   - entity_mappings → canonical_games (ID bridge)
--   - conversations → auth.users (user data ownership)
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. nba_ticks.game_id → nba_games (training data — must be preserved)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.nba_ticks
  DROP CONSTRAINT IF EXISTS nba_ticks_game_id_fkey;
ALTER TABLE public.nba_ticks
  ADD CONSTRAINT nba_ticks_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.nba_games(game_id)
  ON DELETE RESTRICT;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. nba_snapshots.game_id → nba_games (model output history)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.nba_snapshots
  DROP CONSTRAINT IF EXISTS nba_snapshots_game_id_fkey;
ALTER TABLE public.nba_snapshots
  ADD CONSTRAINT nba_snapshots_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.nba_games(game_id)
  ON DELETE RESTRICT;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. nba_decisions.game_id → nba_games (decision audit trail)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.nba_decisions
  DROP CONSTRAINT IF EXISTS nba_decisions_game_id_fkey;
ALTER TABLE public.nba_decisions
  ADD CONSTRAINT nba_decisions_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.nba_games(game_id)
  ON DELETE RESTRICT;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. live_forecast_snapshots.match_id → matches (historical forecasts)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.live_forecast_snapshots
  DROP CONSTRAINT IF EXISTS live_forecast_snapshots_match_id_fkey;
ALTER TABLE public.live_forecast_snapshots
  ADD CONSTRAINT live_forecast_snapshots_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES public.matches(id)
  ON DELETE RESTRICT;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. match_external_ids.match_id → matches (ID mapping audit trail)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.match_external_ids
  DROP CONSTRAINT IF EXISTS match_external_ids_match_id_fkey;
ALTER TABLE public.match_external_ids
  ADD CONSTRAINT match_external_ids_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES public.matches(id)
  ON DELETE RESTRICT;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. pregame_intel_cards.intel_id → pregame_intel (analytics cards)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pregame_intel_cards
  DROP CONSTRAINT IF EXISTS pregame_intel_cards_intel_id_fkey;
ALTER TABLE public.pregame_intel_cards
  ADD CONSTRAINT pregame_intel_cards_intel_id_fkey
  FOREIGN KEY (intel_id) REFERENCES public.pregame_intel(intel_id)
  ON DELETE RESTRICT;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. ai_chat_runs.conversation_id → conversations (idempotency ledger)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ai_chat_runs
  DROP CONSTRAINT IF EXISTS ai_chat_runs_conversation_id_fkey;
ALTER TABLE public.ai_chat_runs
  ADD CONSTRAINT ai_chat_runs_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
  ON DELETE RESTRICT;
