-- ============================================================================
-- Phase 0 Snapshot Activation + Restoration + Health Monitor
-- Tasks: 0-3 .. 0-11
-- ============================================================================

-- --------------------------------------------------------------------------
-- Shared helpers
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._phase0_to_numeric(p_val text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text;
BEGIN
  IF p_val IS NULL OR btrim(p_val) = '' THEN
    RETURN NULL;
  END IF;

  v_clean := lower(btrim(p_val));
  IF v_clean IN ('pk', 'pick', 'even', 'ev') THEN
    RETURN 0;
  END IF;

  v_clean := regexp_replace(v_clean, '[^0-9.+-]+', '', 'g');
  IF v_clean = '' OR v_clean = '+' OR v_clean = '-' THEN
    RETURN NULL;
  END IF;

  RETURN v_clean::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public._phase0_to_numeric(text)
IS 'Parses numeric values from JSON/text odds formats safely (supports PK/EV/EVEN).';

-- --------------------------------------------------------------------------
-- 0-3: Activate live_signal_snapshots
-- Root cause: no active writer/schedule.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_live_signal_snapshots(
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
  WITH candidates AS (
    SELECT
      lgs.id AS game_id,
      COALESCE(NULLIF(lgs.league_id, ''), NULLIF(m.league_id, ''), 'unknown') AS league,
      COALESCE(NULLIF(m.home_team, ''), 'HOME') AS home_team,
      COALESCE(NULLIF(m.away_team, ''), 'AWAY') AS away_team,
      COALESCE(lgs.home_score, 0) AS home_score,
      COALESCE(lgs.away_score, 0) AS away_score,
      NULLIF(lgs.clock, '') AS clock,
      NULLIF(lgs.period::text, '') AS period,
      CASE
        WHEN COALESCE(lgs.sport, m.sport, '') ILIKE '%soccer%' THEN LEAST(100, GREATEST(0, public._phase0_to_numeric(regexp_replace(COALESCE(lgs.clock, ''), '[^0-9]', '', 'g'))))
        ELSE NULL
      END AS elapsed_pct,
      COALESCE(lgs.odds -> 'current', '{}'::jsonb) AS odds_current,
      COALESCE(lgs.deterministic_signals, '{}'::jsonb) AS sig,
      COALESCE(lgs.updated_at, now()) AS snapshot_at
    FROM public.live_game_state lgs
    LEFT JOIN public.matches m ON m.id = lgs.id
    WHERE COALESCE(lgs.updated_at, now() - interval '10 days') >= now() - make_interval(mins => GREATEST(p_window_minutes, 1))
      AND COALESCE(lgs.game_status, '') <> ''
    ORDER BY COALESCE(lgs.updated_at, now()) DESC
    LIMIT GREATEST(p_limit, 1)
  ),
  prepared AS (
    SELECT
      c.game_id,
      c.league,
      c.home_team,
      c.away_team,
      c.home_score,
      c.away_score,
      c.clock,
      c.period,
      c.elapsed_pct,
      COALESCE(
        public._phase0_to_numeric(c.sig ->> 'market_total'),
        public._phase0_to_numeric(c.odds_current ->> 'total'),
        public._phase0_to_numeric(c.odds_current ->> 'overUnder')
      ) AS market_total,
      public._phase0_to_numeric(c.odds_current ->> 'homeSpread') AS market_spread,
      public._phase0_to_numeric(c.sig ->> 'deterministic_fair_total') AS model_fair_total,
      public._phase0_to_numeric(c.sig #>> '{ppm,projected}') AS pace_projection,
      COALESCE(
        public._phase0_to_numeric(c.sig ->> 'edge_points'),
        public._phase0_to_numeric(c.sig ->> 'composite_edge')
      ) AS composite_edge,
      public._phase0_to_numeric(c.sig #>> '{blueprint,confidence}') AS confidence_pct,
      COALESCE(
        NULLIF(c.sig #>> '{blueprint,direction}', ''),
        CASE
          WHEN COALESCE(public._phase0_to_numeric(c.sig ->> 'edge_points'), 0) > 0 THEN 'OVER'
          WHEN COALESCE(public._phase0_to_numeric(c.sig ->> 'edge_points'), 0) < 0 THEN 'UNDER'
          ELSE 'NEUTRAL'
        END
      ) AS signal_direction,
      COALESCE(
        NULLIF(c.sig ->> 'edge_state', ''),
        NULLIF(c.sig #>> '{blueprint,status}', ''),
        'NEUTRAL'
      ) AS signal_grade,
      CASE
        WHEN jsonb_typeof(c.sig -> 'debug_trace') = 'array' THEN c.sig -> 'debug_trace'
        ELSE '[]'::jsonb
      END AS drivers,
      CASE
        WHEN jsonb_typeof(c.sig -> 'narrative') = 'object' THEN jsonb_build_array(c.sig -> 'narrative')
        ELSE '[]'::jsonb
      END AS watchouts,
      'deterministic_signals_v1'::text AS model_source,
      md5(c.game_id || '|' || to_char(date_trunc('minute', c.snapshot_at), 'YYYYMMDDHH24MI')) AS state_id,
      c.snapshot_at
    FROM candidates c
  ),
  ins AS (
    INSERT INTO public.live_signal_snapshots (
      game_id, league, home_team, away_team,
      home_score, away_score, clock, period, elapsed_pct,
      market_total, market_spread, model_fair_total, pace_projection,
      composite_edge, confidence_pct, signal_direction, signal_grade,
      drivers, watchouts, model_source, state_id,
      snapshot_at, created_at
    )
    SELECT
      p.game_id, p.league, p.home_team, p.away_team,
      p.home_score, p.away_score, p.clock, p.period, p.elapsed_pct,
      p.market_total, p.market_spread, p.model_fair_total, p.pace_projection,
      p.composite_edge, p.confidence_pct, p.signal_direction, p.signal_grade,
      p.drivers, p.watchouts, p.model_source, p.state_id,
      p.snapshot_at, now()
    FROM prepared p
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.live_signal_snapshots s
      WHERE s.game_id = p.game_id
        AND date_trunc('minute', s.snapshot_at) = date_trunc('minute', p.snapshot_at)
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.capture_live_signal_snapshots(integer, integer)
IS 'Captures live deterministic signal snapshots from live_game_state into live_signal_snapshots.';

-- --------------------------------------------------------------------------
-- 0-4: Activate ai_pick_snapshots
-- Root cause: no writer/trigger from ai_chat_picks.
-- --------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_pick_snapshots_game_target_direction_time
  ON public.ai_pick_snapshots (game_id, pick_target, pick_direction, picked_at);

CREATE OR REPLACE FUNCTION public.capture_ai_pick_snapshots(
  p_window_hours integer DEFAULT 720,
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
      p.id,
      COALESCE(NULLIF(p.match_id, ''), 'unknown:' || p.id) AS game_id,
      COALESCE(NULLIF(p.league, ''), 'unknown') AS league,
      COALESCE(NULLIF(p.home_team, ''), 'Unknown Home') AS home_team,
      COALESCE(NULLIF(p.away_team, ''), 'Unknown Away') AS away_team,
      UPPER(COALESCE(NULLIF(p.pick_side, ''), 'UNKNOWN')) AS pick_direction,
      LOWER(COALESCE(NULLIF(p.pick_type, ''), 'unknown')) AS pick_target,
      COALESCE(NULLIF(p.ai_confidence, ''), 'MEDIUM') AS confidence,
      LEFT(COALESCE(NULLIF(p.reasoning_summary, ''), NULLIF(p.ai_response_snippet, ''), 'AI pick snapshot'), 1000) AS narrative,
      CASE WHEN LOWER(COALESCE(p.pick_type, '')) = 'spread' THEN p.pick_line END AS spread,
      CASE WHEN LOWER(COALESCE(p.pick_type, '')) = 'total' THEN p.pick_line END AS total,
      NULLIF(p.pick_game_clock, '') AS clock,
      CASE WHEN jsonb_typeof(p.sharp_signals) = 'object' THEN p.sharp_signals ELSE NULL END AS watchouts,
      COALESCE(p.created_at, now()) AS picked_at,
      p.graded_at,
      m.home_score AS final_home,
      m.away_score AS final_away,
      CASE WHEN m.home_score IS NOT NULL AND m.away_score IS NOT NULL THEN (m.home_score + m.away_score) END AS final_total,
      CASE
        WHEN lower(COALESCE(p.result, '')) = 'win' THEN true
        WHEN lower(COALESCE(p.result, '')) = 'loss' THEN false
        ELSE NULL
      END AS pick_hit
    FROM public.ai_chat_picks p
    LEFT JOIN public.matches m ON m.id = p.match_id
    WHERE COALESCE(p.created_at, now() - interval '10 years') >= now() - make_interval(hours => GREATEST(p_window_hours, 1))
    ORDER BY COALESCE(p.created_at, now()) DESC
    LIMIT GREATEST(p_limit, 1)
  ),
  ins AS (
    INSERT INTO public.ai_pick_snapshots (
      game_id, league, home_team, away_team,
      pick_direction, pick_target, confidence, narrative,
      spread, total, home_score, away_score, clock,
      watchouts, user_action,
      final_home, final_away, final_total, pick_hit,
      picked_at, graded_at, created_at
    )
    SELECT
      s.game_id, s.league, s.home_team, s.away_team,
      s.pick_direction, s.pick_target, s.confidence, s.narrative,
      s.spread, s.total, NULL::integer, NULL::integer, s.clock,
      s.watchouts, 'AUTO_CAPTURE',
      s.final_home, s.final_away, s.final_total, s.pick_hit,
      s.picked_at, s.graded_at, now()
    FROM src s
    ON CONFLICT (game_id, pick_target, pick_direction, picked_at) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public._mirror_ai_chat_pick_to_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.ai_pick_snapshots (
    game_id, league, home_team, away_team,
    pick_direction, pick_target, confidence, narrative,
    spread, total, home_score, away_score, clock,
    watchouts, user_action,
    picked_at, graded_at, created_at
  )
  VALUES (
    COALESCE(NULLIF(NEW.match_id, ''), 'unknown:' || NEW.id),
    COALESCE(NULLIF(NEW.league, ''), 'unknown'),
    COALESCE(NULLIF(NEW.home_team, ''), 'Unknown Home'),
    COALESCE(NULLIF(NEW.away_team, ''), 'Unknown Away'),
    UPPER(COALESCE(NULLIF(NEW.pick_side, ''), 'UNKNOWN')),
    LOWER(COALESCE(NULLIF(NEW.pick_type, ''), 'unknown')),
    COALESCE(NULLIF(NEW.ai_confidence, ''), 'MEDIUM'),
    LEFT(COALESCE(NULLIF(NEW.reasoning_summary, ''), NULLIF(NEW.ai_response_snippet, ''), 'AI pick snapshot'), 1000),
    CASE WHEN LOWER(COALESCE(NEW.pick_type, '')) = 'spread' THEN NEW.pick_line END,
    CASE WHEN LOWER(COALESCE(NEW.pick_type, '')) = 'total' THEN NEW.pick_line END,
    NULL,
    NULL,
    NULLIF(NEW.pick_game_clock, ''),
    CASE WHEN jsonb_typeof(NEW.sharp_signals) = 'object' THEN NEW.sharp_signals ELSE NULL END,
    'AUTO_TRIGGER',
    COALESCE(NEW.created_at, now()),
    NEW.graded_at,
    now()
  )
  ON CONFLICT (game_id, pick_target, pick_direction, picked_at) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_chat_picks_to_ai_pick_snapshots ON public.ai_chat_picks;
CREATE TRIGGER trg_ai_chat_picks_to_ai_pick_snapshots
AFTER INSERT ON public.ai_chat_picks
FOR EACH ROW
EXECUTE FUNCTION public._mirror_ai_chat_pick_to_snapshot();

-- --------------------------------------------------------------------------
-- 0-5: Activate soccer_live_odds_snapshots
-- Root cause: no writer (only live_odds_snapshots was being written).
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_soccer_live_odds_snapshots(
  p_window_minutes integer DEFAULT 360,
  p_limit integer DEFAULT 600
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
      m.id AS match_id,
      COALESCE(NULLIF(m.league_id, ''), 'unknown') AS league_id,
      COALESCE(NULLIF(m.current_odds ->> 'provider', ''), 'live_odds_tracker') AS source,
      date_trunc('minute', COALESCE(m.last_updated, now())) AS captured_at,
      NULLIF(m.display_clock, '') AS game_clock,
      public._phase0_to_numeric(regexp_replace(COALESCE(m.display_clock, ''), '[^0-9]', '', 'g'))::integer AS match_minute,
      CASE
        WHEN upper(COALESCE(m.status, '')) LIKE '%IN_PROGRESS%' OR upper(COALESCE(m.status, '')) LIKE '%LIVE%' OR upper(COALESCE(m.status, '')) LIKE '%HALF%' THEN 'LIVE_TICK'
        WHEN upper(COALESCE(m.status, '')) LIKE '%FINAL%' THEN 'FINAL_SNAPSHOT'
        ELSE 'PREGAME_TICK'
      END AS trigger_type,
      COALESCE(m.status, 'STATUS_UNKNOWN') AS trigger_detail,
      COALESCE(m.home_score, 0) AS home_score,
      COALESCE(m.away_score, 0) AS away_score,
      COALESCE(m.current_odds, '{}'::jsonb) AS odds
    FROM public.matches m
    WHERE (
      COALESCE(m.sport, '') ILIKE '%soccer%'
      OR COALESCE(m.league_id, '') IN ('eng.1','esp.1','ita.1','ger.1','fra.1','usa.1','mls','epl','laliga','seriea','bundesliga','ligue1','ucl','uel','uefa.champions','uefa.europa')
    )
      AND m.current_odds IS NOT NULL
      AND COALESCE(m.last_updated, now() - interval '10 years') >= now() - make_interval(mins => GREATEST(p_window_minutes, 1))
    ORDER BY COALESCE(m.last_updated, now()) DESC
    LIMIT GREATEST(p_limit, 1)
  ),
  ins AS (
    INSERT INTO public.soccer_live_odds_snapshots (
      id,
      match_id, league_id, source, captured_at,
      game_clock, match_minute,
      trigger_type, trigger_detail,
      home_score, away_score,
      live_total, live_over_price, live_under_price,
      odds_format,
      live_home_ml, live_away_ml, live_draw_ml,
      live_spread, live_home_spread_price, live_away_spread_price,
      alt_lines,
      live_btts_yes, live_btts_no,
      player_props,
      drain_version,
      created_at
    )
    SELECT
      md5(s.match_id || '|' || to_char(s.captured_at, 'YYYYMMDDHH24MI')),
      s.match_id, s.league_id, s.source, s.captured_at,
      s.game_clock, s.match_minute,
      s.trigger_type, s.trigger_detail,
      s.home_score, s.away_score,
      COALESCE(public._phase0_to_numeric(s.odds ->> 'total'), public._phase0_to_numeric(s.odds ->> 'overUnder')),
      public._phase0_to_numeric(s.odds ->> 'overOdds'),
      public._phase0_to_numeric(s.odds ->> 'underOdds'),
      'american',
      COALESCE(public._phase0_to_numeric(s.odds ->> 'homeWin'), public._phase0_to_numeric(s.odds ->> 'homeML')),
      COALESCE(public._phase0_to_numeric(s.odds ->> 'awayWin'), public._phase0_to_numeric(s.odds ->> 'awayML')),
      COALESCE(public._phase0_to_numeric(s.odds ->> 'draw'), public._phase0_to_numeric(s.odds ->> 'drawML')),
      public._phase0_to_numeric(s.odds ->> 'homeSpread'),
      public._phase0_to_numeric(s.odds ->> 'homeSpreadOdds'),
      public._phase0_to_numeric(s.odds ->> 'awaySpreadOdds'),
      NULL,
      COALESCE(public._phase0_to_numeric(s.odds ->> 'bttsYes'), public._phase0_to_numeric(s.odds ->> 'btts_yes')),
      COALESCE(public._phase0_to_numeric(s.odds ->> 'bttsNo'), public._phase0_to_numeric(s.odds ->> 'btts_no')),
      NULL,
      'phase0_capture_v1',
      now()
    FROM src s
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- --------------------------------------------------------------------------
-- 0-6: Activate prediction_market_snapshots
-- Root cause: no writer from poly_odds -> prediction snapshot table.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_prediction_market_snapshots(
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
      COALESCE(NULLIF(po.game_id, ''), NULLIF(po.poly_event_id, ''), 'poly:' || po.poly_condition_id) AS match_id,
      'poly_odds'::text AS source,
      po.home_prob,
      po.away_prob,
      po.draw_prob,
      po.volume,
      po.spread_line,
      po.poly_event_slug,
      COALESCE(lgs.home_score, 0) AS home_score,
      COALESCE(lgs.away_score, 0) AS away_score,
      NULLIF(lgs.clock, '') AS game_clock,
      lgs.period,
      COALESCE(po.poly_updated_at, now()) AS captured_at
    FROM public.poly_odds po
    LEFT JOIN public.live_game_state lgs ON lgs.id = po.game_id
    WHERE COALESCE(po.market_active, true)
      AND COALESCE(po.poly_updated_at, now() - interval '10 years') >= now() - make_interval(mins => GREATEST(p_window_minutes, 1))
      AND COALESCE(po.market_type, 'moneyline') IN ('moneyline', 'h2h')
    ORDER BY COALESCE(po.poly_updated_at, now()) DESC
    LIMIT GREATEST(p_limit, 1)
  ),
  ins AS (
    INSERT INTO public.prediction_market_snapshots (
      match_id, source,
      home_prob, away_prob, draw_prob,
      volume,
      spread,
      event_slug,
      home_score, away_score,
      game_clock, period,
      captured_at
    )
    SELECT
      s.match_id, s.source,
      s.home_prob, s.away_prob, s.draw_prob,
      s.volume,
      s.spread_line,
      s.poly_event_slug,
      s.home_score, s.away_score,
      s.game_clock, s.period,
      s.captured_at
    FROM src s
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.prediction_market_snapshots pms
      WHERE pms.match_id = s.match_id
        AND pms.source = s.source
        AND date_trunc('minute', pms.captured_at) = date_trunc('minute', s.captured_at)
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- --------------------------------------------------------------------------
-- 0-7: Activate poly_price_history append pipeline
-- Root cause: poly ingest updated current-state table only, no append ledger writes.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_poly_price_history(
  p_window_minutes integer DEFAULT 360,
  p_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH ordered AS (
    SELECT
      po.poly_condition_id,
      po.game_id,
      po.home_team_name,
      po.away_team_name,
      po.local_league_id,
      po.game_start_time,
      date_trunc('minute', COALESCE(po.poly_updated_at, now())) AS snapshot_at,
      po.home_prob,
      po.away_prob,
      po.draw_prob,
      po.volume,
      po.market_active,
      lag(po.volume) OVER (
        PARTITION BY po.poly_condition_id
        ORDER BY COALESCE(po.poly_updated_at, now())
      ) AS prev_volume
    FROM public.poly_odds po
    WHERE COALESCE(po.market_active, true)
      AND COALESCE(po.poly_updated_at, now() - interval '10 years') >= now() - make_interval(mins => GREATEST(p_window_minutes, 1))
      AND po.poly_condition_id IS NOT NULL
    ORDER BY COALESCE(po.poly_updated_at, now()) DESC
    LIMIT GREATEST(p_limit, 1)
  ),
  ins AS (
    INSERT INTO public.poly_price_history (
      id,
      poly_condition_id,
      game_id,
      home_team_name,
      away_team_name,
      local_league_id,
      game_start_time,
      snapshot_at,
      home_prob,
      away_prob,
      draw_prob,
      volume_cumulative,
      volume_since_last,
      liquidity,
      market_active,
      market_closed
    )
    SELECT
      md5(o.poly_condition_id || '|' || to_char(o.snapshot_at, 'YYYYMMDDHH24MI')),
      o.poly_condition_id,
      o.game_id,
      o.home_team_name,
      o.away_team_name,
      o.local_league_id,
      o.game_start_time,
      o.snapshot_at,
      o.home_prob,
      o.away_prob,
      o.draw_prob,
      o.volume,
      GREATEST(COALESCE(o.volume, 0) - COALESCE(o.prev_volume, o.volume, 0), 0),
      NULL,
      COALESCE(o.market_active, true),
      NOT COALESCE(o.market_active, true)
    FROM ordered o
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- --------------------------------------------------------------------------
-- 0-8: Restore live_forecast_snapshots
-- Root cause: deterministic outputs existed but no active writer path.
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
      lgs.period,
      NULLIF(lgs.clock, '') AS clock,
      COALESCE(lgs.away_score, 0) AS away_score,
      COALESCE(lgs.home_score, 0) AS home_score,
      COALESCE(lgs.deterministic_signals, '{}'::jsonb) AS sig,
      COALESCE(lgs.odds -> 'current', '{}'::jsonb) AS odds_current,
      COALESCE(lgs.updated_at, now()) AS created_at
    FROM public.live_game_state lgs
    WHERE lgs.deterministic_signals IS NOT NULL
      AND COALESCE(lgs.updated_at, now() - interval '10 years') >= now() - make_interval(mins => GREATEST(p_window_minutes, 1))
    ORDER BY COALESCE(lgs.updated_at, now()) DESC
    LIMIT GREATEST(p_limit, 1)
  ),
  prepared AS (
    SELECT
      md5(s.match_id || '|' || to_char(date_trunc('minute', s.created_at), 'YYYYMMDDHH24MI')) AS id,
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
        public._phase0_to_numeric(s.sig #>> '{blueprint,model_number}')
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
    ON CONFLICT (id) DO UPDATE SET
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

-- --------------------------------------------------------------------------
-- 0-9: Restore ai_chat_picks supply path + keep grader fed
-- Root cause: no active producer path in current runtime usage.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_ai_chat_picks_from_pregame_intel(
  p_window_hours integer DEFAULT 48,
  p_limit integer DEFAULT 200
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
      pi.intel_id,
      pi.match_id,
      pi.home_team,
      pi.away_team,
      pi.league_id,
      COALESCE(NULLIF(lower(pi.grading_metadata ->> 'type'), ''), 'spread') AS pick_type,
      COALESCE(
        NULLIF(upper(pi.grading_metadata ->> 'side'), ''),
        NULLIF(upper(split_part(pi.recommended_pick, ' ', 1)), ''),
        'UNKNOWN'
      ) AS pick_side,
      public._phase0_to_numeric(pi.grading_metadata ->> 'line') AS pick_line,
      public._phase0_to_numeric(pi.grading_metadata ->> 'price')::integer AS pick_odds,
      pi.generated_at,
      LEFT(COALESCE(NULLIF(pi.briefing, ''), NULLIF(pi.logic_authority, ''), COALESCE(pi.recommended_pick, 'Pregame intel pick')), 500) AS reasoning,
      COALESCE(NULLIF(pi.confidence_tier, ''), 'LOW') AS confidence
    FROM public.pregame_intel pi
    WHERE COALESCE(pi.generated_at, now() - interval '10 years') >= now() - make_interval(hours => GREATEST(p_window_hours, 1))
      AND COALESCE(pi.recommended_pick, '') <> ''
      AND lower(pi.recommended_pick) NOT LIKE '%pass%'
      AND lower(COALESCE(pi.pick_result, 'pending')) IN ('pending', 'not_graded')
    ORDER BY pi.generated_at DESC
    LIMIT GREATEST(p_limit, 1)
  ),
  ins AS (
    INSERT INTO public.ai_chat_picks (
      session_id,
      conversation_id,
      match_id,
      home_team,
      away_team,
      league,
      pick_type,
      pick_side,
      pick_line,
      pick_odds,
      user_query,
      ai_response_snippet,
      ai_confidence,
      reasoning_summary,
      game_start_time,
      result,
      run_id,
      model_id,
      pick_kind,
      created_at
    )
    SELECT
      'system:pregame-intel',
      NULL,
      s.match_id,
      s.home_team,
      s.away_team,
      s.league_id,
      s.pick_type,
      s.pick_side,
      s.pick_line,
      s.pick_odds,
      '[system] pregame_intel_capture',
      LEFT(s.reasoning, 500),
      s.confidence,
      s.reasoning,
      m.start_time,
      'pending',
      s.intel_id::text,
      'pregame_intel_capture_v1',
      'system',
      s.generated_at
    FROM src s
    LEFT JOIN public.matches m ON m.id = s.match_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.ai_chat_picks p
      WHERE p.run_id = s.intel_id::text
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- --------------------------------------------------------------------------
-- 0-10: Restore injury_snapshots writer
-- Root cause: scan-injuries function exists but no active cron schedule.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invoke_scan_injuries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  v_url := public._vault_secret('supabase_url');
  v_key := public._vault_secret('supabase_service_role_key');

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/scan-injuries',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$$;

-- --------------------------------------------------------------------------
-- 0-11: Snapshot health monitor
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snapshot_health_audit (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  table_name text not null,
  row_count bigint not null,
  last_record timestamptz,
  expected_cadence interval not null,
  status text not null check (status in ('HEALTHY', 'STALE', 'NEVER_ACTIVATED'))
);

CREATE INDEX IF NOT EXISTS idx_snapshot_health_audit_run_at ON public.snapshot_health_audit (run_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshot_health_audit_status ON public.snapshot_health_audit (status, run_at DESC);

CREATE OR REPLACE FUNCTION public.snapshot_health_check()
RETURNS TABLE (
  table_name text,
  row_count bigint,
  last_record timestamptz,
  expected_cadence interval,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.table_name,
    s.row_count,
    s.last_record,
    s.expected_cadence,
    CASE
      WHEN s.last_record IS NULL THEN 'NEVER_ACTIVATED'
      WHEN s.last_record < now() - (s.expected_cadence * 3) THEN 'STALE'
      ELSE 'HEALTHY'
    END AS status
  FROM (
    SELECT 'live_game_state'::text AS table_name, count(*)::bigint AS row_count, max(updated_at) AS last_record, interval '6 minutes' AS expected_cadence FROM public.live_game_state
    UNION ALL
    SELECT 'espn_summary_snapshots', count(*)::bigint, max(snapshot_at), interval '24 hours' FROM public.espn_summary_snapshots
    UNION ALL
    SELECT 'price_snapshots', count(*)::bigint, max(captured_at), interval '24 hours' FROM public.price_snapshots
    UNION ALL
    SELECT 'live_forecast_snapshots', count(*)::bigint, max(created_at), interval '6 minutes' FROM public.live_forecast_snapshots
    UNION ALL
    SELECT 'ai_chat_picks', count(*)::bigint, max(created_at), interval '24 hours' FROM public.ai_chat_picks
    UNION ALL
    SELECT 'injury_snapshots', count(*)::bigint, max(report_date::timestamptz), interval '24 hours' FROM public.injury_snapshots
    UNION ALL
    SELECT 'prediction_market_snapshots', count(*)::bigint, max(captured_at), interval '6 minutes' FROM public.prediction_market_snapshots
    UNION ALL
    SELECT 'live_signal_snapshots', count(*)::bigint, max(snapshot_at), interval '6 minutes' FROM public.live_signal_snapshots
    UNION ALL
    SELECT 'ai_pick_snapshots', count(*)::bigint, max(created_at), interval '24 hours' FROM public.ai_pick_snapshots
    UNION ALL
    SELECT 'soccer_live_odds_snapshots', count(*)::bigint, max(captured_at), interval '10 minutes' FROM public.soccer_live_odds_snapshots
    UNION ALL
    SELECT 'live_context_snapshots', count(*)::bigint, max(captured_at), interval '6 minutes' FROM public.live_context_snapshots
    UNION ALL
    SELECT 'poly_price_history', count(*)::bigint, max(snapshot_at), interval '6 minutes' FROM public.poly_price_history
  ) s
  ORDER BY
    CASE
      WHEN s.last_record IS NULL THEN 1
      WHEN s.last_record < now() - (s.expected_cadence * 3) THEN 2
      ELSE 3
    END,
    s.table_name;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_health_record()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.snapshot_health_audit (
      run_at,
      table_name,
      row_count,
      last_record,
      expected_cadence,
      status
    )
    SELECT
      now(),
      shc.table_name,
      shc.row_count,
      shc.last_record,
      shc.expected_cadence,
      shc.status
    FROM public.snapshot_health_check() shc
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- --------------------------------------------------------------------------
-- Wrapper for manual/cron orchestrated capture cycle
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invoke_snapshot_capture_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_live_signal integer;
  v_ai_pick integer;
  v_soccer_odds integer;
  v_pred_market integer;
  v_poly_history integer;
  v_forecast integer;
  v_ai_chat_from_intel integer;
BEGIN
  v_live_signal := public.capture_live_signal_snapshots();
  v_ai_pick := public.capture_ai_pick_snapshots();
  v_soccer_odds := public.capture_soccer_live_odds_snapshots();
  v_pred_market := public.capture_prediction_market_snapshots();
  v_poly_history := public.capture_poly_price_history();
  v_forecast := public.capture_live_forecast_snapshots();
  v_ai_chat_from_intel := public.capture_ai_chat_picks_from_pregame_intel();

  RETURN jsonb_build_object(
    'ok', true,
    'live_signal_snapshots', v_live_signal,
    'ai_pick_snapshots', v_ai_pick,
    'soccer_live_odds_snapshots', v_soccer_odds,
    'prediction_market_snapshots', v_pred_market,
    'poly_price_history', v_poly_history,
    'live_forecast_snapshots', v_forecast,
    'ai_chat_picks_from_pregame_intel', v_ai_chat_from_intel,
    'captured_at', now()
  );
END;
$$;

-- --------------------------------------------------------------------------
-- Privileges (service-role only)
-- --------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.capture_live_signal_snapshots(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_ai_pick_snapshots(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_soccer_live_odds_snapshots(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_prediction_market_snapshots(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_poly_price_history(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_live_forecast_snapshots(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_ai_chat_picks_from_pregame_intel(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoke_scan_injuries() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_health_check() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_health_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoke_snapshot_capture_cycle() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.capture_live_signal_snapshots(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_ai_pick_snapshots(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_soccer_live_odds_snapshots(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_prediction_market_snapshots(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_poly_price_history(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_live_forecast_snapshots(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_ai_chat_picks_from_pregame_intel(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_scan_injuries() TO service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_health_check() TO service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_health_record() TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_snapshot_capture_cycle() TO service_role;

-- --------------------------------------------------------------------------
-- Cron wiring (idempotent reschedule)
-- --------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'live-signal-snapshots-2m') THEN
    PERFORM cron.unschedule('live-signal-snapshots-2m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-pick-snapshots-30m') THEN
    PERFORM cron.unschedule('ai-pick-snapshots-30m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'soccer-live-odds-snapshots-5m') THEN
    PERFORM cron.unschedule('soccer-live-odds-snapshots-5m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prediction-market-snapshots-2m') THEN
    PERFORM cron.unschedule('prediction-market-snapshots-2m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poly-price-history-2m') THEN
    PERFORM cron.unschedule('poly-price-history-2m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'live-forecast-snapshots-2m') THEN
    PERFORM cron.unschedule('live-forecast-snapshots-2m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-chat-picks-from-intel-hourly') THEN
    PERFORM cron.unschedule('ai-chat-picks-from-intel-hourly');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'injury-snapshots-daily') THEN
    PERFORM cron.unschedule('injury-snapshots-daily');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-health-monitor-daily') THEN
    PERFORM cron.unschedule('snapshot-health-monitor-daily');
  END IF;
END;
$$;

SELECT cron.schedule('live-signal-snapshots-2m', '*/2 * * * *', $$SELECT public.capture_live_signal_snapshots()$$);
SELECT cron.schedule('ai-pick-snapshots-30m', '*/30 * * * *', $$SELECT public.capture_ai_pick_snapshots()$$);
SELECT cron.schedule('soccer-live-odds-snapshots-5m', '*/5 * * * *', $$SELECT public.capture_soccer_live_odds_snapshots()$$);
SELECT cron.schedule('prediction-market-snapshots-2m', '*/2 * * * *', $$SELECT public.capture_prediction_market_snapshots()$$);
SELECT cron.schedule('poly-price-history-2m', '*/2 * * * *', $$SELECT public.capture_poly_price_history()$$);
SELECT cron.schedule('live-forecast-snapshots-2m', '*/2 * * * *', $$SELECT public.capture_live_forecast_snapshots()$$);
SELECT cron.schedule('ai-chat-picks-from-intel-hourly', '7 * * * *', $$SELECT public.capture_ai_chat_picks_from_pregame_intel()$$);
SELECT cron.schedule('injury-snapshots-daily', '15 9 * * *', $$SELECT public.invoke_scan_injuries()$$);
SELECT cron.schedule('snapshot-health-monitor-daily', '20 9 * * *', $$SELECT public.snapshot_health_record()$$);

