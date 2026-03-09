-- ============================================================================
-- Phase 0 Hotfix #2
--  - Fix soccer_live_odds_snapshots FK target (soccer_postgame -> matches)
--  - Handle live_forecast_snapshots unique_match_clock conflicts
-- ============================================================================

-- --------------------------------------------------------------------------
-- Fix bad FK wiring for soccer live odds snapshots
-- --------------------------------------------------------------------------

ALTER TABLE public.soccer_live_odds_snapshots
  DROP CONSTRAINT IF EXISTS soccer_live_odds_snapshots_match_id_fkey;

ALTER TABLE public.soccer_live_odds_snapshots
  ADD CONSTRAINT soccer_live_odds_snapshots_match_id_fkey
  FOREIGN KEY (match_id)
  REFERENCES public.matches(id)
  ON DELETE CASCADE;

-- --------------------------------------------------------------------------
-- Replace live forecast capture with conflict-safe upsert on unique_match_clock
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_live_forecast_snapshots(
  p_window_minutes integer DEFAULT 360,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH src AS (
    SELECT
      lgs.id AS match_id,
      COALESCE(NULLIF(lgs.league_id, ''), 'unknown') AS league_id,
      COALESCE(lgs.period, 0) AS period,
      COALESCE(NULLIF(lgs.clock, ''), '00:00') AS clock,
      COALESCE(lgs.away_score, 0) AS away_score,
      COALESCE(lgs.home_score, 0) AS home_score,
      COALESCE(lgs.deterministic_signals, '{}'::jsonb) AS sig,
      COALESCE(lgs.odds -> 'current', '{}'::jsonb) AS odds_current,
      COALESCE(lgs.updated_at, now()) AS created_at
    FROM public.live_game_state lgs
    WHERE COALESCE(lgs.updated_at, now() - interval '10 years') >= now() - make_interval(mins => GREATEST(p_window_minutes, 1))
      AND (
        lgs.deterministic_signals IS NOT NULL
        OR lgs.odds IS NOT NULL
      )
    ORDER BY COALESCE(lgs.updated_at, now()) DESC
    LIMIT GREATEST(p_limit, 1)
  ),
  prepared AS (
    SELECT
      public._phase0_uuid_from_text(s.match_id || '|' || s.period::text || '|' || s.clock) AS id,
      s.match_id,
      s.league_id,
      s.period,
      s.clock,
      s.away_score,
      s.home_score,
      COALESCE(
        public._phase0_to_numeric(s.sig ->> 'market_total'),
        public._phase0_to_numeric(s.odds_current ->> 'total'),
        public._phase0_to_numeric(s.odds_current ->> 'overUnder')
      ) AS market_total,
      COALESCE(
        public._phase0_to_numeric(s.sig ->> 'deterministic_fair_total'),
        public._phase0_to_numeric(s.sig #>> '{blueprint,model_number}'),
        public._phase0_to_numeric(s.odds_current ->> 'total'),
        public._phase0_to_numeric(s.odds_current ->> 'overUnder')
      ) AS fair_total,
      public._phase0_to_numeric(s.sig #>> '{ppm,observed}') AS observed_ppm,
      public._phase0_to_numeric(s.sig #>> '{ppm,projected}') AS projected_ppm,
      COALESCE(public._phase0_to_numeric(s.sig ->> 'edge_points'), 0) AS edge_points,
      COALESCE(NULLIF(s.sig ->> 'edge_state', ''), 'NEUTRAL') AS edge_state,
      COALESCE(NULLIF(s.sig ->> 'deterministic_regime', ''), 'NORMAL') AS regime,
      s.created_at
    FROM src s
  ),
  ins AS (
    INSERT INTO public.live_forecast_snapshots (
      id,
      match_id, league_id,
      period, clock,
      away_score, home_score,
      market_total, fair_total,
      p10_total, p90_total,
      variance_sd,
      edge_points, edge_state, regime,
      observed_ppm, projected_ppm,
      created_at
    )
    SELECT
      p.id,
      p.match_id, p.league_id,
      p.period, p.clock,
      p.away_score, p.home_score,
      p.market_total, p.fair_total,
      CASE WHEN p.fair_total IS NOT NULL THEN p.fair_total - 1.5 END,
      CASE WHEN p.fair_total IS NOT NULL THEN p.fair_total + 1.5 END,
      CASE
        WHEN p.market_total IS NOT NULL AND p.fair_total IS NOT NULL THEN abs(p.fair_total - p.market_total)
        ELSE NULL
      END,
      p.edge_points, p.edge_state, p.regime,
      p.observed_ppm, p.projected_ppm,
      p.created_at
    FROM prepared p
    ON CONFLICT ON CONSTRAINT unique_match_clock
    DO UPDATE SET
      id = EXCLUDED.id,
      market_total = EXCLUDED.market_total,
      fair_total = EXCLUDED.fair_total,
      p10_total = EXCLUDED.p10_total,
      p90_total = EXCLUDED.p90_total,
      variance_sd = EXCLUDED.variance_sd,
      edge_points = EXCLUDED.edge_points,
      edge_state = EXCLUDED.edge_state,
      regime = EXCLUDED.regime,
      observed_ppm = EXCLUDED.observed_ppm,
      projected_ppm = EXCLUDED.projected_ppm,
      created_at = EXCLUDED.created_at
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$$;

