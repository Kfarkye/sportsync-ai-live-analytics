CREATE OR REPLACE FUNCTION public.get_trend_record(
  p_trend_id uuid,
  p_season text DEFAULT '2024-25'
)
RETURNS TABLE(
  wins int,
  losses int,
  pushes int
) AS $$
DECLARE
  v_trend_name text;
BEGIN
  SELECT trend_name INTO v_trend_name
  FROM trend_definitions
  WHERE id = p_trend_id;

  -- 1. Half-point soccer markets (pushes mathematically impossible)
  IF v_trend_name IN ('Man City Unders', 'Getafe Unders') THEN
    RETURN QUERY
      SELECT
        sum(CASE WHEN total_goals < 2.5 THEN 1 ELSE 0 END)::int AS wins,
        sum(CASE WHEN total_goals > 2.5 THEN 1 ELSE 0 END)::int AS losses,
        0::int AS pushes
      FROM soccer_postgame
      WHERE season = p_season
        AND status = 'completed'
        AND (
          (v_trend_name = 'Man City Unders' AND (home_team = 'Manchester City' OR away_team = 'Manchester City'))
          OR
          (v_trend_name = 'Getafe Unders' AND (home_team = 'Getafe' OR away_team = 'Getafe'))
        );

  -- 2. EPL Low SOT structural under (needs stats join)
  ELSIF v_trend_name = 'EPL Low SOT Match' THEN
    RETURN QUERY
      WITH low_sot_matches AS (
        SELECT sp.total_goals
        FROM soccer_postgame sp
        JOIN espn_team_season_stats h_stats
          ON sp.home_team = h_stats.team_name
         AND h_stats.season = p_season
        JOIN espn_team_season_stats a_stats
          ON sp.away_team = a_stats.team_name
         AND a_stats.season = p_season
        WHERE sp.season = p_season
          AND sp.league = 'epl'
          AND sp.status = 'completed'
          AND (h_stats.stats->>'shots_on_target_per90')::numeric < 4.5
          AND (a_stats.stats->>'shots_on_target_per90')::numeric < 4.5
      )
      SELECT
        sum(CASE WHEN total_goals < 2.5 THEN 1 ELSE 0 END)::int AS wins,
        sum(CASE WHEN total_goals > 2.5 THEN 1 ELSE 0 END)::int AS losses,
        0::int AS pushes
      FROM low_sot_matches;

  -- 3. Whole-number NBA markets (pushes possible)
  ELSIF v_trend_name = 'B2B Road Under' THEN
    RETURN QUERY
      SELECT
        sum(CASE WHEN (home_score + away_score) < closing_total THEN 1 ELSE 0 END)::int AS wins,
        sum(CASE WHEN (home_score + away_score) > closing_total THEN 1 ELSE 0 END)::int AS losses,
        sum(CASE WHEN (home_score + away_score) = closing_total THEN 1 ELSE 0 END)::int AS pushes
      FROM nba_postgame
      WHERE season = p_season
        AND status = 'completed';

  -- 4. NCAAB spread covers (pushes possible on whole numbers)
  ELSIF v_trend_name = 'Home Dog Cover' THEN
    RETURN QUERY
      SELECT
        sum(CASE WHEN (home_score - away_score) + spread > 0 THEN 1 ELSE 0 END)::int AS wins,
        sum(CASE WHEN (home_score - away_score) + spread < 0 THEN 1 ELSE 0 END)::int AS losses,
        sum(CASE WHEN (home_score - away_score) + spread = 0 THEN 1 ELSE 0 END)::int AS pushes
      FROM ncaamb_games
      WHERE season = p_season
        AND status = 'completed'
        AND spread BETWEEN 4 AND 10;

  -- Fallback
  ELSE
    RETURN QUERY SELECT 0::int, 0::int, 0::int;
  END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.get_trend_record(uuid, text) TO anon;
