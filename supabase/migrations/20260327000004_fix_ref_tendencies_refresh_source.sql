-- Fix refresh_ref_tendencies_records source logic
-- Use finalized matches + closing_odds directly (not mv_nba_team_game_master spread fields).
-- Zone: DATA/ID (Amazon+Google) + OPS (SRE+Amazon)

CREATE OR REPLACE FUNCTION public.refresh_ref_tendencies_records(p_sport text DEFAULT 'basketball')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_rows integer := 0;
  v_coach_rows integer := 0;
  v_player_rows integer := 0;
BEGIN
  IF lower(coalesce(p_sport, '')) <> 'basketball' THEN
    RAISE EXCEPTION 'refresh_ref_tendencies_records currently supports only basketball (received: %)', p_sport;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.game_officials go ON go.match_id = m.id
    WHERE m.league_id = 'nba'
      AND m.id LIKE '%_nba'
      AND upper(coalesce(m.status, '')) = 'STATUS_FINAL'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND coalesce(go.official_name, '') <> ''
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'refresh_ref_tendencies_records aborted: no finalized NBA official-team samples in source';
  END IF;

  -- 1) Ref x Team (all/home/away) ------------------------------------------------
  DELETE FROM public.ref_team_records
  WHERE sport = p_sport;

  WITH nba_games AS (
    SELECT
      m.id AS match_id,
      m.home_team,
      m.away_team,
      (m.home_score + m.away_score)::numeric AS total_points,
      (m.home_score - m.away_score)::numeric AS home_margin,
      public.jsonb_numeric_any(
        m.closing_odds,
        ARRAY['total', 'total_value', 'overUnder', 'line']
      ) AS total_close,
      coalesce(
        public.jsonb_numeric_any(
          m.closing_odds,
          ARRAY['spread_home_value', 'spread_home', 'homeSpread', 'home_spread', 'spread']
        ),
        -public.jsonb_numeric_any(
          m.closing_odds,
          ARRAY['spread_away_value', 'spread_away', 'awaySpread', 'away_spread']
        )
      ) AS home_spread_close,
      coalesce(
        public.jsonb_numeric_any(
          m.closing_odds,
          ARRAY['spread_away_value', 'spread_away', 'awaySpread', 'away_spread']
        ),
        -public.jsonb_numeric_any(
          m.closing_odds,
          ARRAY['spread_home_value', 'spread_home', 'homeSpread', 'home_spread', 'spread']
        )
      ) AS away_spread_close
    FROM public.matches m
    WHERE m.league_id = 'nba'
      AND m.id LIKE '%_nba'
      AND upper(coalesce(m.status, '')) = 'STATUS_FINAL'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND m.closing_odds IS NOT NULL
  ), team_perspective AS (
    SELECT
      g.match_id,
      g.home_team AS team,
      true AS is_home,
      g.home_margin AS team_margin,
      g.total_points,
      g.total_close,
      g.home_spread_close AS team_spread_close
    FROM nba_games g

    UNION ALL

    SELECT
      g.match_id,
      g.away_team AS team,
      false AS is_home,
      -g.home_margin AS team_margin,
      g.total_points,
      g.total_close,
      g.away_spread_close AS team_spread_close
    FROM nba_games g
  ), base_samples AS (
    SELECT DISTINCT
      go.match_id,
      go.official_name AS ref_name,
      tp.team,
      tp.is_home,
      tp.total_points,
      CASE
        WHEN tp.total_points > tp.total_close THEN 'OVER'
        WHEN tp.total_points < tp.total_close THEN 'UNDER'
        ELSE 'PUSH'
      END AS total_result_close,
      CASE
        WHEN (tp.team_margin + tp.team_spread_close) > 0 THEN 'COVER'
        WHEN (tp.team_margin + tp.team_spread_close) < 0 THEN 'NO_COVER'
        ELSE 'PUSH'
      END AS spread_result_close,
      (tp.team_margin + tp.team_spread_close) AS spread_result_vs_close
    FROM team_perspective tp
    JOIN public.game_officials go
      ON go.match_id = tp.match_id
    WHERE lower(coalesce(go.sport, 'basketball')) = 'basketball'
      AND lower(coalesce(go.league_id, 'nba')) = 'nba'
      AND coalesce(go.official_name, '') <> ''
      AND coalesce(tp.team, '') <> ''
      AND tp.total_close IS NOT NULL
      AND tp.team_spread_close IS NOT NULL
  ), exploded AS (
    SELECT
      bs.ref_name,
      bs.team,
      'all'::text AS venue,
      bs.total_points,
      bs.total_result_close,
      bs.spread_result_close,
      bs.spread_result_vs_close
    FROM base_samples bs

    UNION ALL

    SELECT
      bs.ref_name,
      bs.team,
      CASE WHEN bs.is_home THEN 'home' ELSE 'away' END AS venue,
      bs.total_points,
      bs.total_result_close,
      bs.spread_result_close,
      bs.spread_result_vs_close
    FROM base_samples bs
  ), rollup AS (
    SELECT
      e.ref_name,
      e.team,
      e.venue,
      count(*)::integer AS games,
      count(*) FILTER (WHERE e.total_result_close = 'OVER')::integer AS overs,
      count(*) FILTER (WHERE e.total_result_close = 'UNDER')::integer AS unders,
      count(*) FILTER (WHERE e.total_result_close = 'PUSH')::integer AS ou_pushes,
      round(100.0 * count(*) FILTER (WHERE e.total_result_close = 'OVER')::numeric / nullif(count(*), 0), 1) AS over_pct,
      round(avg(e.total_points)::numeric, 1) AS avg_total,
      count(*) FILTER (WHERE e.spread_result_close = 'COVER')::integer AS ats_covers,
      count(*) FILTER (WHERE e.spread_result_close = 'NO_COVER')::integer AS ats_fails,
      count(*) FILTER (WHERE e.spread_result_close = 'PUSH')::integer AS ats_pushes,
      round(100.0 * count(*) FILTER (WHERE e.spread_result_close = 'COVER')::numeric / nullif(count(*), 0), 1) AS ats_cover_pct,
      round(avg(e.spread_result_vs_close)::numeric, 2) AS avg_margin
    FROM exploded e
    GROUP BY e.ref_name, e.team, e.venue
  )
  INSERT INTO public.ref_team_records (
    id,
    ref_name,
    team,
    sport,
    venue,
    games,
    overs,
    unders,
    ou_pushes,
    over_pct,
    avg_total,
    ats_covers,
    ats_fails,
    ats_pushes,
    ats_cover_pct,
    avg_margin,
    updated_at
  )
  SELECT
    concat_ws('::', r.ref_name, r.team, p_sport, r.venue) AS id,
    r.ref_name,
    r.team,
    p_sport,
    r.venue,
    r.games,
    r.overs,
    r.unders,
    r.ou_pushes,
    r.over_pct,
    r.avg_total,
    r.ats_covers,
    r.ats_fails,
    r.ats_pushes,
    r.ats_cover_pct,
    r.avg_margin,
    now()
  FROM rollup r
  WHERE r.games > 0;

  GET DIAGNOSTICS v_team_rows = ROW_COUNT;

  -- 2) Ref x Coach --------------------------------------------------------------
  DELETE FROM public.ref_coach_records
  WHERE sport = p_sport;

  WITH coach_map AS (
    SELECT DISTINCT ON (c.team_name)
      c.team_name,
      c.coach_name
    FROM public.coaches c
    WHERE c.sport = 'basketball'
      AND (c.league_id = 'nba' OR c.league_id IS NULL)
      AND c.team_name IS NOT NULL
      AND c.coach_name IS NOT NULL
    ORDER BY c.team_name, c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST, c.id DESC
  ), nba_games AS (
    SELECT
      m.id AS match_id,
      m.home_team,
      m.away_team,
      (m.home_score + m.away_score)::numeric AS total_points,
      (m.home_score - m.away_score)::numeric AS home_margin,
      public.jsonb_numeric_any(
        m.closing_odds,
        ARRAY['total', 'total_value', 'overUnder', 'line']
      ) AS total_close,
      coalesce(
        public.jsonb_numeric_any(
          m.closing_odds,
          ARRAY['spread_home_value', 'spread_home', 'homeSpread', 'home_spread', 'spread']
        ),
        -public.jsonb_numeric_any(
          m.closing_odds,
          ARRAY['spread_away_value', 'spread_away', 'awaySpread', 'away_spread']
        )
      ) AS home_spread_close,
      coalesce(
        public.jsonb_numeric_any(
          m.closing_odds,
          ARRAY['spread_away_value', 'spread_away', 'awaySpread', 'away_spread']
        ),
        -public.jsonb_numeric_any(
          m.closing_odds,
          ARRAY['spread_home_value', 'spread_home', 'homeSpread', 'home_spread', 'spread']
        )
      ) AS away_spread_close
    FROM public.matches m
    WHERE m.league_id = 'nba'
      AND m.id LIKE '%_nba'
      AND upper(coalesce(m.status, '')) = 'STATUS_FINAL'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND m.closing_odds IS NOT NULL
  ), team_perspective AS (
    SELECT
      g.match_id,
      g.home_team AS team,
      g.home_margin AS team_margin,
      g.total_points,
      g.total_close,
      g.home_spread_close AS team_spread_close
    FROM nba_games g

    UNION ALL

    SELECT
      g.match_id,
      g.away_team AS team,
      -g.home_margin AS team_margin,
      g.total_points,
      g.total_close,
      g.away_spread_close AS team_spread_close
    FROM nba_games g
  ), base_samples AS (
    SELECT DISTINCT
      go.match_id,
      go.official_name AS ref_name,
      cm.coach_name AS coach,
      tp.team,
      tp.total_points,
      CASE
        WHEN tp.total_points > tp.total_close THEN 'OVER'
        WHEN tp.total_points < tp.total_close THEN 'UNDER'
        ELSE 'PUSH'
      END AS total_result_close,
      CASE
        WHEN (tp.team_margin + tp.team_spread_close) > 0 THEN 'COVER'
        WHEN (tp.team_margin + tp.team_spread_close) < 0 THEN 'NO_COVER'
        ELSE 'PUSH'
      END AS spread_result_close,
      (tp.team_margin + tp.team_spread_close) AS spread_result_vs_close
    FROM team_perspective tp
    JOIN public.game_officials go
      ON go.match_id = tp.match_id
    JOIN coach_map cm
      ON cm.team_name = tp.team
    WHERE lower(coalesce(go.sport, 'basketball')) = 'basketball'
      AND lower(coalesce(go.league_id, 'nba')) = 'nba'
      AND coalesce(go.official_name, '') <> ''
      AND coalesce(tp.team, '') <> ''
      AND tp.total_close IS NOT NULL
      AND tp.team_spread_close IS NOT NULL
  ), rollup AS (
    SELECT
      bs.ref_name,
      bs.coach,
      bs.team,
      count(*)::integer AS games,
      count(*) FILTER (WHERE bs.total_result_close = 'OVER')::integer AS overs,
      count(*) FILTER (WHERE bs.total_result_close = 'UNDER')::integer AS unders,
      count(*) FILTER (WHERE bs.total_result_close = 'PUSH')::integer AS ou_pushes,
      round(100.0 * count(*) FILTER (WHERE bs.total_result_close = 'OVER')::numeric / nullif(count(*), 0), 1) AS over_pct,
      round(avg(bs.total_points)::numeric, 1) AS avg_total,
      count(*) FILTER (WHERE bs.spread_result_close = 'COVER')::integer AS ats_covers,
      count(*) FILTER (WHERE bs.spread_result_close = 'NO_COVER')::integer AS ats_fails,
      count(*) FILTER (WHERE bs.spread_result_close = 'PUSH')::integer AS ats_pushes,
      round(100.0 * count(*) FILTER (WHERE bs.spread_result_close = 'COVER')::numeric / nullif(count(*), 0), 1) AS ats_cover_pct,
      round(avg(bs.spread_result_vs_close)::numeric, 2) AS avg_margin
    FROM base_samples bs
    GROUP BY bs.ref_name, bs.coach, bs.team
  )
  INSERT INTO public.ref_coach_records (
    id,
    ref_name,
    coach,
    team,
    sport,
    games,
    overs,
    unders,
    ou_pushes,
    over_pct,
    avg_total,
    ats_covers,
    ats_fails,
    ats_pushes,
    ats_cover_pct,
    avg_margin,
    updated_at
  )
  SELECT
    concat_ws('::', r.ref_name, r.coach, r.team, p_sport) AS id,
    r.ref_name,
    r.coach,
    r.team,
    p_sport,
    r.games,
    r.overs,
    r.unders,
    r.ou_pushes,
    r.over_pct,
    r.avg_total,
    r.ats_covers,
    r.ats_fails,
    r.ats_pushes,
    r.ats_cover_pct,
    r.avg_margin,
    now()
  FROM rollup r
  WHERE r.games > 0;

  GET DIAGNOSTICS v_coach_rows = ROW_COUNT;

  -- 3) Ref x Player -------------------------------------------------------------
  IF to_regclass('public.ref_player_props_graded') IS NOT NULL THEN
    DELETE FROM public.ref_player_records
    WHERE sport = p_sport;

    WITH source_rows AS (
      SELECT
        r.ref_name,
        r.player_name,
        r.team,
        r.games,
        r.avg_actual,
        r.avg_line,
        r.line_diff,
        r.overs,
        r.unders,
        r.over_pct
      FROM public.ref_player_props_graded r
      WHERE r.sport = p_sport
        AND r.games > 0
    ), deduped AS (
      SELECT DISTINCT ON (sr.ref_name, sr.player_name)
        sr.ref_name,
        sr.player_name,
        sr.team,
        sr.games,
        sr.avg_actual,
        sr.avg_line,
        sr.line_diff,
        sr.overs,
        sr.unders,
        sr.over_pct
      FROM source_rows sr
      ORDER BY sr.ref_name, sr.player_name, sr.games DESC, sr.team
    )
    INSERT INTO public.ref_player_records (
      id,
      ref_name,
      player_name,
      team,
      sport,
      games,
      avg_points,
      avg_points_career,
      pts_delta,
      overs,
      unders,
      over_pct,
      avg_total,
      ats_covers,
      ats_fails,
      ats_cover_pct,
      updated_at
    )
    SELECT
      concat_ws('::', d.ref_name, d.player_name, p_sport) AS id,
      d.ref_name,
      d.player_name,
      d.team,
      p_sport,
      d.games,
      d.avg_actual::numeric,
      d.avg_line::numeric,
      d.line_diff::numeric,
      d.overs,
      d.unders,
      round(coalesce(d.over_pct, 100.0 * d.overs::numeric / nullif(d.games, 0))::numeric, 1),
      NULL,
      0,
      0,
      NULL,
      now()
    FROM deduped d;

    GET DIAGNOSTICS v_player_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'status', 'refreshed',
    'sport', p_sport,
    'team_rows', v_team_rows,
    'coach_rows', v_coach_rows,
    'player_rows', v_player_rows,
    'refreshed_at', now()
  );
END;
$$;
