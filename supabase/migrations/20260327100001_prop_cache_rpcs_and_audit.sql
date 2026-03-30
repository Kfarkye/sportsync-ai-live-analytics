-- ============================================================
-- RPC 1: get_prop_context
-- Consumer-facing: returns hit rates for a player/bet_type/line
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_prop_context(
  p_player text,
  p_bet_type text,
  p_line numeric
)
RETURNS TABLE(
  context_key text,
  context_value text,
  games integer,
  overs integer,
  unders integer,
  pushes integer,
  over_pct numeric,
  avg_actual numeric,
  avg_margin numeric,
  median_actual numeric,
  sample_tier text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT
    c.context_key,
    c.context_value,
    c.games,
    c.overs,
    c.unders,
    c.pushes,
    c.over_pct,
    c.avg_actual,
    c.avg_margin,
    c.median_actual,
    CASE
      WHEN c.games >= 15 THEN 'STRONG'
      WHEN c.games >= 8  THEN 'MODERATE'
      WHEN c.games >= 3  THEN 'THIN'
      ELSE 'INSUFFICIENT'
    END AS sample_tier
  FROM public.prop_hit_rate_cache c
  WHERE c.player_name = p_player
    AND c.bet_type = p_bet_type
    AND c.line_bucket = p_line
  ORDER BY
    CASE c.context_key
      WHEN 'all' THEN 0
      WHEN 'venue' THEN 1
      WHEN 'rest_days' THEN 2
      WHEN 'opp_pace_tier' THEN 3
      WHEN 'teammate_out' THEN 4
      WHEN 'crew_chief' THEN 5
      WHEN 'season_phase' THEN 6
      WHEN 'travel_pattern' THEN 7
      ELSE 8
    END,
    c.games DESC;
$$;

-- ============================================================
-- RPC 2: get_player_context_log
-- Consumer-facing: recent game log with context tags
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_player_context_log(
  p_player text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(
  game_date date,
  match_id text,
  team text,
  opponent text,
  venue text,
  minutes integer,
  points integer,
  rebounds integer,
  assists integer,
  steals integer,
  blocks integer,
  turnovers integer,
  three_pm integer,
  personal_fouls integer,
  rest_days integer,
  travel_pattern text,
  opp_pace_rank integer,
  crew_chief text,
  season_phase text,
  key_teammate_out text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT
    pgs.game_date,
    pgs.match_id,
    pgs.team,
    pgs.opponent,
    pgs.venue,
    pgs.minutes,
    pgs.points,
    pgs.rebounds,
    pgs.assists,
    pgs.steals,
    pgs.blocks,
    pgs.turnovers,
    pgs.three_pm,
    pgs.personal_fouls,
    CASE
      WHEN pgs.venue = 'HOME' THEN gc.home_rest_days
      ELSE gc.away_rest_days
    END AS rest_days,
    CASE
      WHEN pgs.venue = 'HOME' THEN gc.home_travel_pattern
      ELSE gc.away_travel_pattern
    END AS travel_pattern,
    CASE
      WHEN pgs.venue = 'HOME' THEN gc.away_pace_rank
      ELSE gc.home_pace_rank
    END AS opp_pace_rank,
    gc.crew_chief,
    gc.season_phase,
    (
      SELECT ptl.teammate_name
      FROM public.player_teammate_log ptl
      WHERE ptl.match_id = pgs.match_id
        AND ptl.player_name = pgs.player_name
        AND ptl.teammate_played = false
      ORDER BY ptl.teammate_name
      LIMIT 1
    ) AS key_teammate_out
  FROM public.player_game_stats pgs
  LEFT JOIN public.game_context gc
    ON gc.match_id = pgs.match_id
  WHERE pgs.player_name = p_player
    AND COALESCE(pgs.is_dnp, false) = false
  ORDER BY pgs.game_date DESC
  LIMIT p_limit;
$$;

-- ============================================================
-- RPC 3: audit_prop_cache_health
-- Internal: deep cache quality audit in a single DB call
-- ============================================================
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
  -- 1. Total rows
  totals AS (
    SELECT count(*) AS total_rows FROM public.prop_hit_rate_cache
  ),
  -- 2. Context dimension distribution
  context_dist AS (
    SELECT jsonb_object_agg(context_key, cnt) AS dist
    FROM (
      SELECT context_key, count(*) AS cnt
      FROM public.prop_hit_rate_cache
      GROUP BY context_key
      ORDER BY context_key
    ) t
  ),
  -- 3. Unique players
  player_count AS (
    SELECT count(DISTINCT player_name) AS unique_players
    FROM public.prop_hit_rate_cache
    WHERE context_key = 'all'
  ),
  -- 4. Bet type distribution
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
  -- 5. Sample size tiers (on 'all' context)
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
  -- 6. Null rates
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
  -- 7. Top 10 players by total games (coverage check)
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
  -- 8. Bottom 10 players by total games (thin coverage)
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
  -- 9. Key teammates seed count
  teammate_seed AS (
    SELECT count(*) AS seed_rows FROM public.key_teammates WHERE active = true
  ),
  -- 10. Staleness: latest outcome date
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
$$;
