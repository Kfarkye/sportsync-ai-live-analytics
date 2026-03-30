CREATE OR REPLACE FUNCTION public.audit_prop_cache_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH
  totals AS (
    SELECT count(*) AS total_rows FROM public.prop_hit_rate_cache
  ),
  context_dist AS (
    SELECT jsonb_object_agg(context_key, cnt) AS dist
    FROM (
      SELECT context_key, count(*) AS cnt
      FROM public.prop_hit_rate_cache
      GROUP BY context_key
      ORDER BY context_key
    ) t
  ),
  player_count AS (
    SELECT count(DISTINCT player_name) AS unique_players
    FROM public.prop_hit_rate_cache
    WHERE context_key = 'all'
  ),
  bet_dist AS (
    SELECT jsonb_object_agg(bet_type, cnt) AS dist
    FROM (
      SELECT bet_type, count(*) AS cnt
      FROM public.prop_hit_rate_cache
      WHERE context_key = 'all'
      GROUP BY bet_type
      ORDER BY cnt DESC
    ) t
  ),
  sample_tiers AS (
    SELECT jsonb_build_object(
      'games_gte_15', count(*) FILTER (WHERE games >= 15),
      'games_10_14', count(*) FILTER (WHERE games >= 10 AND games < 15),
      'games_5_9', count(*) FILTER (WHERE games >= 5 AND games < 10),
      'games_3_4', count(*) FILTER (WHERE games >= 3 AND games < 5),
      'games_lt_3', count(*) FILTER (WHERE games < 3)
    ) AS tiers
    FROM public.prop_hit_rate_cache
    WHERE context_key = 'all'
  ),
  null_rates AS (
    SELECT jsonb_build_object(
      'over_pct_null', count(*) FILTER (WHERE over_pct IS NULL),
      'avg_actual_null', count(*) FILTER (WHERE avg_actual IS NULL),
      'avg_margin_null', count(*) FILTER (WHERE avg_margin IS NULL),
      'median_actual_null', count(*) FILTER (WHERE median_actual IS NULL),
      'total_checked', count(*)
    ) AS nulls
    FROM public.prop_hit_rate_cache
    WHERE context_key = 'all'
  ),
  top_players AS (
    SELECT jsonb_agg(jsonb_build_object('player', player_name, 'total_games', total_games))
    AS top10
    FROM (
      SELECT player_name, sum(games) AS total_games
      FROM public.prop_hit_rate_cache
      WHERE context_key = 'all'
      GROUP BY player_name
      ORDER BY total_games DESC
      LIMIT 10
    ) t
  ),
  bottom_players AS (
    SELECT jsonb_agg(jsonb_build_object('player', player_name, 'total_games', total_games))
    AS bottom10
    FROM (
      SELECT player_name, sum(games) AS total_games
      FROM public.prop_hit_rate_cache
      WHERE context_key = 'all'
      GROUP BY player_name
      ORDER BY total_games ASC
      LIMIT 10
    ) t
  ),
  teammate_seed AS (
    SELECT count(*) AS seed_rows FROM public.key_teammates WHERE active = true
  ),
  staleness AS (
    SELECT max(game_date) AS latest_game_date
    FROM public.player_prop_outcomes
  )
  SELECT jsonb_build_object(
    'total_cache_rows', (SELECT total_rows FROM totals),
    'context_distribution', (SELECT dist FROM context_dist),
    'unique_players', (SELECT unique_players FROM player_count),
    'bet_type_distribution', (SELECT dist FROM bet_dist),
    'sample_size_tiers', (SELECT tiers FROM sample_tiers),
    'null_rates', (SELECT nulls FROM null_rates),
    'top_10_players', (SELECT top10 FROM top_players),
    'bottom_10_players', (SELECT bottom10 FROM bottom_players),
    'active_teammate_seeds', (SELECT seed_rows FROM teammate_seed),
    'latest_outcome_date', (SELECT latest_game_date FROM staleness),
    'audit_ran_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;;
