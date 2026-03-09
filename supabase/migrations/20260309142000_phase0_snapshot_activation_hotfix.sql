-- ============================================================================
-- Phase 0 Snapshot Activation Hotfix
-- Fixes:
--  - soccer_live_odds_snapshots numeric overflow
--  - UUID id generation for poly_price_history/live_forecast_snapshots
--  - ai_chat_picks run_id UUID mismatch
--  - injury snapshots writer fallback (no Gemini dependency)
-- ============================================================================

CREATE OR REPLACE FUNCTION public._phase0_clamp_numeric(p_val numeric, p_abs numeric DEFAULT 9999.99)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_val IS NULL THEN NULL
    WHEN p_val > p_abs THEN p_abs
    WHEN p_val < -p_abs THEN -p_abs
    ELSE p_val
  END;
$$;

CREATE OR REPLACE FUNCTION public._phase0_uuid_from_text(p_text text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    substr(md5(COALESCE(p_text, '')), 1, 8) || '-' ||
    substr(md5(COALESCE(p_text, '')), 9, 4) || '-' ||
    substr(md5(COALESCE(p_text, '')), 13, 4) || '-' ||
    substr(md5(COALESCE(p_text, '')), 17, 4) || '-' ||
    substr(md5(COALESCE(p_text, '')), 21, 12)
  )::uuid;
$$;

-- --------------------------------------------------------------------------
-- 0-5 overflow fix: clamp all numeric writes
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
      public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(s.odds ->> 'total'), public._phase0_to_numeric(s.odds ->> 'overUnder'))),
      public._phase0_clamp_numeric(public._phase0_to_numeric(s.odds ->> 'overOdds')),
      public._phase0_clamp_numeric(public._phase0_to_numeric(s.odds ->> 'underOdds')),
      'american',
      public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(s.odds ->> 'homeWin'), public._phase0_to_numeric(s.odds ->> 'homeML'))),
      public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(s.odds ->> 'awayWin'), public._phase0_to_numeric(s.odds ->> 'awayML'))),
      public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(s.odds ->> 'draw'), public._phase0_to_numeric(s.odds ->> 'drawML'))),
      public._phase0_clamp_numeric(public._phase0_to_numeric(s.odds ->> 'homeSpread')),
      public._phase0_clamp_numeric(public._phase0_to_numeric(s.odds ->> 'homeSpreadOdds')),
      public._phase0_clamp_numeric(public._phase0_to_numeric(s.odds ->> 'awaySpreadOdds')),
      NULL,
      public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(s.odds ->> 'bttsYes'), public._phase0_to_numeric(s.odds ->> 'btts_yes'))),
      public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(s.odds ->> 'bttsNo'), public._phase0_to_numeric(s.odds ->> 'btts_no'))),
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
-- 0-7 UUID fix
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
      public._phase0_uuid_from_text(o.poly_condition_id || '|' || to_char(o.snapshot_at, 'YYYYMMDDHH24MI')),
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
-- 0-8 UUID fix
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
      public._phase0_uuid_from_text(s.match_id || '|' || to_char(date_trunc('minute', s.created_at), 'YYYYMMDDHH24MI')) AS id,
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
-- 0-9 UUID cast fix
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
      s.intel_id,
      'pregame_intel_capture_v1',
      'system',
      s.generated_at
    FROM src s
    LEFT JOIN public.matches m ON m.id = s.match_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.ai_chat_picks p
      WHERE p.run_id = s.intel_id
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- --------------------------------------------------------------------------
-- 0-10 non-LLM injury snapshot source
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_injury_snapshots_from_espn_athletes(
  p_window_hours integer DEFAULT 72,
  p_limit integer DEFAULT 20000
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
      CASE
        WHEN lower(ea.league_id) IN ('nba','basketball/nba','mens-college-basketball','ncaab') THEN 'NBA'
        WHEN lower(ea.league_id) IN ('nfl','football/nfl','college-football','ncaaf') THEN 'NFL'
        WHEN lower(ea.league_id) IN ('nhl','hockey/nhl','icehockey_nhl') THEN 'NHL'
        WHEN lower(ea.league_id) IN ('mlb','baseball/mlb') THEN 'MLB'
        ELSE upper(COALESCE(ea.league_id, 'UNKNOWN'))
      END AS sport,
      COALESCE(NULLIF(ea.team_name, ''), 'Unknown Team') AS team,
      COALESCE(NULLIF(ea.full_name, ''), NULLIF(ea.display_name, ''), 'Unknown Player') AS player_name,
      COALESCE(NULLIF(ea.status, ''), 'Questionable') AS status,
      COALESCE(NULLIF(ea.injury_detail, ''), NULLIF(ea.injury_type, ''), 'Injury report') AS report,
      'espn_athletes'::text AS source_url,
      COALESCE(ea.updated_at::date, current_date) AS report_date,
      COALESCE(ea.updated_at, now()) AS updated_at
    FROM public.espn_athletes ea
    WHERE COALESCE(ea.updated_at, now() - interval '10 years') >= now() - make_interval(hours => GREATEST(p_window_hours, 1))
      AND (
        COALESCE(ea.injury_type, '') <> ''
        OR COALESCE(ea.injury_detail, '') <> ''
        OR lower(COALESCE(ea.status, '')) IN (
          'out','questionable','doubtful','probable','inactive','suspended','day-to-day','injured reserve','ir'
        )
      )
    ORDER BY COALESCE(ea.updated_at, now()) DESC
    LIMIT GREATEST(p_limit, 1)
  ),
  ins AS (
    INSERT INTO public.injury_snapshots (
      sport,
      team,
      player_name,
      status,
      report,
      source_url,
      report_date,
      created_at
    )
    SELECT
      s.sport,
      s.team,
      s.player_name,
      s.status,
      s.report,
      s.source_url,
      s.report_date,
      now()
    FROM src s
    ON CONFLICT (player_name, team, sport, report_date)
    DO UPDATE SET
      status = EXCLUDED.status,
      report = EXCLUDED.report,
      source_url = EXCLUDED.source_url,
      created_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.capture_injury_snapshots_from_espn_athletes(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_injury_snapshots_from_espn_athletes(integer, integer) TO service_role;

-- Reschedule injury job to resilient non-LLM writer
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'injury-snapshots-daily') THEN
    PERFORM cron.unschedule('injury-snapshots-daily');
  END IF;
END;
$$;

SELECT cron.schedule('injury-snapshots-daily', '15 */6 * * *', $$SELECT public.capture_injury_snapshots_from_espn_athletes()$$);

