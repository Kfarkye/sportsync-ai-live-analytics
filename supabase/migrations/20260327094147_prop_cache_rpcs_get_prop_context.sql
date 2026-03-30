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
$$;;
