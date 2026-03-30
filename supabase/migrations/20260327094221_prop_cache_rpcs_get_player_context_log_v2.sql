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
$$;;
