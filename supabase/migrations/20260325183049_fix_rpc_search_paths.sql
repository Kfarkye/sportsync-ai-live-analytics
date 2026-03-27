
-- Fix get_todays_prop_edges: qualify all table references for empty search_path
CREATE OR REPLACE FUNCTION public.get_todays_prop_edges(
  p_date date DEFAULT CURRENT_DATE,
  p_min_history integer DEFAULT 8,
  p_min_win_pct numeric DEFAULT 53.0,
  p_provider text DEFAULT 'draftkings'::text
)
RETURNS TABLE(
  player_name text, league text, bet_type text, pick_type text, side text,
  line_value numeric, odds_american integer, provider text, match_id text,
  team text, opponent text, hist_win_pct numeric, hist_total integer,
  hist_avg_actual numeric, hist_avg_delta numeric, edge_confidence text
)
LANGUAGE sql STABLE
SET search_path TO ''
AS $function$
  SELECT
    p.player_name, p.league, p.bet_type,
    CASE WHEN p.side = 'over' THEN 'play' ELSE 'fade' END as pick_type,
    p.side, p.line_value, p.odds_american, p.provider, p.match_id, p.team, p.opponent,
    h.win_pct as hist_win_pct, h.total_graded::int as hist_total,
    h.avg_actual as hist_avg_actual, h.avg_delta as hist_avg_delta,
    CASE
      WHEN h.win_pct >= 75 AND h.total_graded >= 12 THEN 'A'
      WHEN h.win_pct >= 65 AND h.total_graded >= 10 THEN 'B'
      WHEN h.win_pct >= 53 AND h.total_graded >= p_min_history THEN 'C'
      ELSE 'D'
    END as edge_confidence
  FROM public.player_prop_bets p
  JOIN public.mv_prop_hit_rates h
    ON h.player_name = p.player_name
    AND h.league = p.league
    AND h.bet_type = p.bet_type
    AND h.side = p.side
    AND h.provider = p.provider
  JOIN public.matches m ON m.id = p.match_id
  WHERE p.event_date = p_date
    AND p.result = 'pending'
    AND p.provider = p_provider
    AND m.status = 'STATUS_SCHEDULED'
    AND h.total_graded >= p_min_history
    AND h.win_pct >= p_min_win_pct
  ORDER BY h.win_pct DESC, h.total_graded DESC;
$function$;

-- Fix get_last_game_per_team similarly
-- First get its definition
;
