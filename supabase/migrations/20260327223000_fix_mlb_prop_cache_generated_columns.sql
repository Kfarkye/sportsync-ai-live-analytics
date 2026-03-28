-- Fix MLB prop cache refresh to respect generated columns on public.prop_hit_rate_cache.
-- sample_tier and margin_abs are generated ALWAYS columns and must not be inserted explicitly.

CREATE OR REPLACE FUNCTION public.refresh_prop_hit_rate_cache_by_league(
  p_league text DEFAULT 'mlb',
  p_since_date date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
  v_league text := lower(coalesce(p_league, 'mlb'));
BEGIN
  IF p_since_date IS NULL THEN
    DELETE FROM public.prop_hit_rate_cache
    WHERE lower(coalesce(league_id, '')) = v_league;
  ELSE
    DELETE FROM public.prop_hit_rate_cache
    WHERE lower(coalesce(league_id, '')) = v_league
      AND (last_game_date IS NULL OR last_game_date >= p_since_date);
  END IF;

  WITH src AS (
    SELECT
      o.espn_player_id,
      o.player_name,
      lower(o.bet_type) AS bet_type,
      o.line_value::numeric AS line_bucket,
      lower(o.side) AS side,
      lower(o.result) AS result,
      o.actual_value,
      o.margin,
      o.venue,
      o.opponent,
      o.season_phase,
      o.game_date,
      o.season
    FROM public.player_prop_outcomes o
    WHERE lower(coalesce(o.league_id, '')) = v_league
      AND lower(coalesce(o.result, '')) IN ('won', 'lost', 'push')
      AND o.game_date IS NOT NULL
      AND (p_since_date IS NULL OR o.game_date >= p_since_date)
  ),
  expanded AS (
    SELECT espn_player_id, player_name, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'all'::text AS context_key, 'all'::text AS context_value
    FROM src
    UNION ALL
    SELECT espn_player_id, player_name, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'venue', coalesce(venue, 'UNKNOWN')
    FROM src
    WHERE venue IS NOT NULL
    UNION ALL
    SELECT espn_player_id, player_name, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'opponent', coalesce(opponent, 'UNKNOWN')
    FROM src
    WHERE opponent IS NOT NULL
    UNION ALL
    SELECT espn_player_id, player_name, bet_type, line_bucket, side, result, actual_value, margin, game_date, season,
           'season_phase', coalesce(season_phase, 'UNKNOWN')
    FROM src
    WHERE season_phase IS NOT NULL
  ),
  agg AS (
    SELECT
      e.espn_player_id,
      e.player_name,
      v_league AS league_id,
      max(e.season) AS season,
      e.bet_type,
      e.line_bucket,
      e.context_key,
      e.context_value,
      count(*)::int AS games,
      sum(CASE WHEN (e.side = 'over' AND e.result = 'won') OR (e.side = 'under' AND e.result = 'lost') THEN 1 ELSE 0 END)::int AS overs,
      sum(CASE WHEN (e.side = 'under' AND e.result = 'won') OR (e.side = 'over' AND e.result = 'lost') THEN 1 ELSE 0 END)::int AS unders,
      sum(CASE WHEN e.result = 'push' THEN 1 ELSE 0 END)::int AS pushes,
      round(100.0 * avg(CASE WHEN (e.side = 'over' AND e.result = 'won') OR (e.side = 'under' AND e.result = 'lost') THEN 1.0 ELSE 0.0 END), 2) AS over_pct,
      round(avg(e.actual_value)::numeric, 3) AS avg_actual,
      round(avg(e.margin)::numeric, 3) AS avg_margin,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY e.actual_value)::numeric, 3) AS median_actual,
      max(e.game_date) AS last_game_date
    FROM expanded e
    GROUP BY e.espn_player_id, e.player_name, e.bet_type, e.line_bucket, e.context_key, e.context_value
  )
  INSERT INTO public.prop_hit_rate_cache (
    espn_player_id,
    player_name,
    league_id,
    season,
    bet_type,
    line_bucket,
    context_key,
    context_value,
    games,
    overs,
    unders,
    pushes,
    over_pct,
    avg_actual,
    avg_margin,
    median_actual,
    last_game_date,
    updated_at
  )
  SELECT
    a.espn_player_id,
    a.player_name,
    a.league_id,
    a.season,
    a.bet_type,
    a.line_bucket,
    a.context_key,
    a.context_value,
    a.games,
    a.overs,
    a.unders,
    a.pushes,
    a.over_pct,
    a.avg_actual,
    a.avg_margin,
    a.median_actual,
    a.last_game_date,
    now()
  FROM agg a;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;
