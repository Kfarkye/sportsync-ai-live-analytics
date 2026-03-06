-- =============================================================================
-- LIVE CONTEXT SNAPSHOTS (v1)
-- Unified per-tick ledger for score + clock + odds + play/context payloads.
-- This keeps live play-by-play context and market state in a single historical row.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.live_context_snapshots (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  league_id TEXT NOT NULL,
  sport TEXT NOT NULL,

  game_status TEXT,
  period INTEGER,
  clock TEXT,
  home_score INTEGER,
  away_score INTEGER,

  odds_current JSONB,
  odds_total NUMERIC,
  odds_home_ml INTEGER,
  odds_away_ml INTEGER,

  situation JSONB,
  last_play JSONB,
  recent_plays JSONB,
  stats JSONB,
  leaders JSONB,
  momentum JSONB,
  advanced_metrics JSONB,
  match_context JSONB,
  predictor JSONB,
  deterministic_signals JSONB,

  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_context_snapshots_match_captured
  ON public.live_context_snapshots (match_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_context_snapshots_league_captured
  ON public.live_context_snapshots (league_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_context_snapshots_captured
  ON public.live_context_snapshots (captured_at DESC);

ALTER TABLE public.live_context_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read live_context_snapshots" ON public.live_context_snapshots;
CREATE POLICY "Allow public read live_context_snapshots"
ON public.live_context_snapshots FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Service role full access live_context_snapshots" ON public.live_context_snapshots;
CREATE POLICY "Service role full access live_context_snapshots"
ON public.live_context_snapshots FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON TABLE public.live_context_snapshots IS
  'Unified live tick ledger with score/clock/odds and contextual game-state payloads.';
