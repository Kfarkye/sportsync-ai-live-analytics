-- Canonical refresh path for APP_REF_TENDENCIES_CURRENT
-- Zone: DATA/ID (Amazon+Google) + OPS (SRE+Amazon)
-- Rebuilds ref_team_records / ref_coach_records / ref_player_records from finalized NBA data.

DROP FUNCTION IF EXISTS public.refresh_ref_tendencies_records(text);

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

  -- Guardrail: avoid writing empty snapshots if source joins are unavailable.
  IF NOT EXISTS (
    SELECT 1
    FROM public.mv_nba_team_game_master tgm
    JOIN public.game_officials go ON go.match_id = tgm.match_id
    WHERE tgm.is_final = true
      AND coalesce(go.official_name, '') <> ''
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'refresh_ref_tendencies_records aborted: no finalized NBA official-team samples in source';
  END IF;

  -- 1) Ref x Team (all/home/away) ------------------------------------------------
  DELETE FROM public.ref_team_records
  WHERE sport = p_sport;

  WITH base_samples AS (
    SELECT DISTINCT
      go.match_id,
      go.official_name AS ref_name,
      tgm.team_name AS team,
      tgm.is_home,
      tgm.total_points,
      tgm.total_result_close,
      tgm.spread_result_close,
      tgm.spread_result_vs_close
    FROM public.mv_nba_team_game_master tgm
    JOIN public.game_officials go
      ON go.match_id = tgm.match_id
    WHERE tgm.is_final = true
      AND lower(coalesce(go.sport, 'basketball')) = 'basketball'
      AND lower(coalesce(go.league_id, 'nba')) = 'nba'
      AND coalesce(go.official_name, '') <> ''
      AND coalesce(tgm.team_name, '') <> ''
      AND tgm.total_result_close IS NOT NULL
      AND tgm.spread_result_close IS NOT NULL
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
  ), base_samples AS (
    SELECT DISTINCT
      go.match_id,
      go.official_name AS ref_name,
      tgm.team_name AS team,
      cm.coach_name AS coach,
      tgm.total_points,
      tgm.total_result_close,
      tgm.spread_result_close,
      tgm.spread_result_vs_close
    FROM public.mv_nba_team_game_master tgm
    JOIN public.game_officials go
      ON go.match_id = tgm.match_id
    JOIN coach_map cm
      ON cm.team_name = tgm.team_name
    WHERE tgm.is_final = true
      AND lower(coalesce(go.sport, 'basketball')) = 'basketball'
      AND lower(coalesce(go.league_id, 'nba')) = 'nba'
      AND coalesce(go.official_name, '') <> ''
      AND coalesce(tgm.team_name, '') <> ''
      AND tgm.total_result_close IS NOT NULL
      AND tgm.spread_result_close IS NOT NULL
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
  -- Uses graded prop outcomes when available (same source used by the live app).
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

GRANT EXECUTE ON FUNCTION public.refresh_ref_tendencies_records(text) TO service_role;

COMMENT ON FUNCTION public.refresh_ref_tendencies_records(text) IS
'Rebuilds APP_REF_TENDENCIES_CURRENT tables from finalized NBA game/team master data and official assignments.';
