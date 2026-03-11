CREATE OR REPLACE FUNCTION public.capture_soccer_live_odds_snapshots(
  p_window_minutes integer DEFAULT 360,
  p_limit integer DEFAULT 600
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  WITH src AS (
    SELECT
      m.id AS match_id,
      COALESCE(NULLIF(m.league_id, ''), 'unknown') AS league_id,
      date_trunc('minute', COALESCE(los.captured_at, m.last_updated, now())) AS captured_at,
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
      CASE
        WHEN los.id IS NOT NULL THEN COALESCE(NULLIF(los.provider, ''), NULLIF(los.source, ''), 'live_odds_snapshots')
        ELSE COALESCE(
          NULLIF(m.current_odds ->> 'provider', ''),
          NULLIF(m.current_odds ->> 'provider_name', ''),
          NULLIF(m.current_odds ->> 'source_detail', ''),
          'live_odds_tracker'
        )
      END AS source,
      los.id AS live_snapshot_id,
      COALESCE(los.home_ml, public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'home_ml'), public._phase0_to_numeric(m.current_odds ->> 'homeML'), public._phase0_to_numeric(m.current_odds ->> 'homeWin'), public._phase0_to_numeric(m.current_odds ->> 'moneylineHome')))) AS live_home_ml,
      COALESCE(los.away_ml, public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'away_ml'), public._phase0_to_numeric(m.current_odds ->> 'awayML'), public._phase0_to_numeric(m.current_odds ->> 'awayWin'), public._phase0_to_numeric(m.current_odds ->> 'moneylineAway')))) AS live_away_ml,
      COALESCE(los.draw_ml, public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'draw_ml'), public._phase0_to_numeric(m.current_odds ->> 'drawML'), public._phase0_to_numeric(m.current_odds ->> 'drawWin'), public._phase0_to_numeric(m.current_odds ->> 'draw')))) AS live_draw_ml,
      COALESCE(los.total, public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'total'), public._phase0_to_numeric(m.current_odds ->> 'overUnder'), public._phase0_to_numeric(m.current_odds ->> 'over_under')))) AS live_total,
      COALESCE(los.over_price, public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'over_price'), public._phase0_to_numeric(m.current_odds ->> 'overOdds')))) AS live_over_price,
      COALESCE(los.under_price, public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'under_price'), public._phase0_to_numeric(m.current_odds ->> 'underOdds')))) AS live_under_price,
      COALESCE(los.spread_home, public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'spread_home'), public._phase0_to_numeric(m.current_odds ->> 'homeSpread')))) AS live_spread,
      COALESCE(los.spread_home_price, public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'spread_home_price'), public._phase0_to_numeric(m.current_odds ->> 'homeSpreadOdds')))) AS live_home_spread_price,
      COALESCE(los.spread_away_price, public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'spread_away_price'), public._phase0_to_numeric(m.current_odds ->> 'awaySpreadOdds')))) AS live_away_spread_price,
      public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'bttsYes'), public._phase0_to_numeric(m.current_odds ->> 'btts_yes'))) AS live_btts_yes,
      public._phase0_clamp_numeric(COALESCE(public._phase0_to_numeric(m.current_odds ->> 'bttsNo'), public._phase0_to_numeric(m.current_odds ->> 'btts_no'))) AS live_btts_no,
      COALESCE(los.raw_payload, m.current_odds, '{}'::jsonb) AS raw_payload
    FROM public.matches m
    LEFT JOIN LATERAL (
      SELECT l.*
      FROM public.live_odds_snapshots l
      WHERE l.match_id = m.id
        AND COALESCE(l.sport, '') = 'soccer'
        AND l.captured_at >= now() - make_interval(mins => GREATEST(p_window_minutes, 1))
      ORDER BY
        CASE
          WHEN l.source = 'odds_api' THEN 0
          WHEN l.source = 'espn_core' THEN 1
          WHEN l.source = 'match_current_odds' THEN 2
          WHEN l.source = 'espn_summary' THEN 3
          ELSE 4
        END ASC,
        CASE
          WHEN l.market_type = 'main' THEN 0
          WHEN l.market_type = 'live' THEN 1
          WHEN l.market_type = 'close' THEN 2
          WHEN l.market_type = 'open' THEN 3
          ELSE 4
        END ASC,
        l.captured_at DESC
      LIMIT 1
    ) los ON true
    WHERE (
      COALESCE(m.sport, '') ILIKE '%soccer%'
      OR COALESCE(m.league_id, '') IN ('eng.1','esp.1','ita.1','ger.1','fra.1','usa.1','mls','epl','laliga','seriea','bundesliga','ligue1','ucl','uel','uefa.champions','uefa.europa')
    )
      AND (
        m.current_odds IS NOT NULL
        OR los.id IS NOT NULL
      )
      AND COALESCE(los.captured_at, m.last_updated, now() - interval '10 years') >= now() - make_interval(mins => GREATEST(p_window_minutes, 1))
    ORDER BY COALESCE(los.captured_at, m.last_updated, now()) DESC
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
      s.live_total,
      s.live_over_price,
      s.live_under_price,
      'american',
      s.live_home_ml,
      s.live_away_ml,
      s.live_draw_ml,
      s.live_spread,
      s.live_home_spread_price,
      s.live_away_spread_price,
      NULL,
      s.live_btts_yes,
      s.live_btts_no,
      NULL,
      CASE
        WHEN s.live_snapshot_id IS NOT NULL THEN 'phase0_capture_v2_live_odds_snapshots'
        ELSE 'phase0_capture_v2_current_odds_fallback'
      END,
      now()
    FROM src s
    ON CONFLICT (id) DO UPDATE
    SET source = EXCLUDED.source,
        captured_at = EXCLUDED.captured_at,
        game_clock = EXCLUDED.game_clock,
        match_minute = EXCLUDED.match_minute,
        trigger_type = EXCLUDED.trigger_type,
        trigger_detail = EXCLUDED.trigger_detail,
        home_score = EXCLUDED.home_score,
        away_score = EXCLUDED.away_score,
        live_total = COALESCE(EXCLUDED.live_total, soccer_live_odds_snapshots.live_total),
        live_over_price = COALESCE(EXCLUDED.live_over_price, soccer_live_odds_snapshots.live_over_price),
        live_under_price = COALESCE(EXCLUDED.live_under_price, soccer_live_odds_snapshots.live_under_price),
        live_home_ml = COALESCE(EXCLUDED.live_home_ml, soccer_live_odds_snapshots.live_home_ml),
        live_away_ml = COALESCE(EXCLUDED.live_away_ml, soccer_live_odds_snapshots.live_away_ml),
        live_draw_ml = COALESCE(EXCLUDED.live_draw_ml, soccer_live_odds_snapshots.live_draw_ml),
        live_spread = COALESCE(EXCLUDED.live_spread, soccer_live_odds_snapshots.live_spread),
        live_home_spread_price = COALESCE(EXCLUDED.live_home_spread_price, soccer_live_odds_snapshots.live_home_spread_price),
        live_away_spread_price = COALESCE(EXCLUDED.live_away_spread_price, soccer_live_odds_snapshots.live_away_spread_price),
        live_btts_yes = COALESCE(EXCLUDED.live_btts_yes, soccer_live_odds_snapshots.live_btts_yes),
        live_btts_no = COALESCE(EXCLUDED.live_btts_no, soccer_live_odds_snapshots.live_btts_no),
        drain_version = EXCLUDED.drain_version,
        created_at = soccer_live_odds_snapshots.created_at
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN COALESCE(v_count, 0);
END;
$function$;
