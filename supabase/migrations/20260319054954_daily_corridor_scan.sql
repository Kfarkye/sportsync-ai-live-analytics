
-- ============================================================
-- DAILY CORRIDOR SCAN
-- The first mover's pregame scanner
-- ============================================================

CREATE OR REPLACE FUNCTION get_corridor_scan(p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  match_id text,
  league_id text,
  home_team text,
  away_team text,
  start_time timestamptz,
  -- Opening numbers
  open_total numeric,
  open_spread numeric,
  -- Current/closing numbers
  close_total numeric,
  close_spread numeric,
  -- Movement so far
  total_move numeric,
  spread_move numeric,
  -- Setup signals
  open_position text,        -- where total sits vs round numbers
  predicted_direction text,  -- which way catchers likely push
  matchup_type text,         -- competitive vs lopsided
  spread_flat boolean,       -- true = no news, pure public action
  setup_grade text,          -- A/B/C/none
  -- Historical context for this setup type
  historical_catcher_pct numeric, -- how often catchers push in predicted direction
  historical_middle_pct numeric,  -- middle rate when they do
  historical_avg_corridor numeric -- average corridor width
) LANGUAGE sql STABLE AS $$
  WITH today AS (
    SELECT 
      o.match_id as t_id,
      m.league_id as t_league,
      m.home_team as t_home,
      m.away_team as t_away,
      m.start_time as t_start,
      o.total as t_open_total,
      o.home_spread as t_open_spread,
      c.total as t_close_total,
      c.home_spread as t_close_spread,
      COALESCE(c.total - o.total, 0) as t_total_move,
      COALESCE(c.home_spread - o.home_spread, 0) as t_spread_move,
      -- Round number position
      CASE 
        WHEN MOD(o.total::int, 10) IN (8, 9) THEN 'below_round'
        WHEN MOD(o.total::int, 10) IN (0, 1, 2) THEN 'above_round'
        WHEN MOD(o.total::int, 10) IN (3, 4) THEN 'mid_low'
        ELSE 'mid_high'
      END as t_position,
      -- Predicted catcher direction based on historical patterns
      CASE 
        WHEN MOD(o.total::int, 10) IN (8, 9) THEN 'under'  -- 55% push down
        WHEN MOD(o.total::int, 10) IN (3, 4) THEN 'under'  -- 67% push down
        WHEN MOD(o.total::int, 10) IN (0, 1, 2) THEN 'over' -- 42% push up
        ELSE 'either'
      END as t_predicted_dir,
      -- Matchup
      CASE WHEN ABS(o.home_spread) < 5 THEN 'competitive' ELSE 'lopsided' END as t_matchup,
      -- Spread flat?
      CASE WHEN ABS(COALESCE(c.home_spread - o.home_spread, 0)) < 1 THEN true ELSE false END as t_spread_flat
    FROM opening_lines o
    LEFT JOIN closing_lines c ON c.match_id = o.match_id
    JOIN matches m ON m.id = o.match_id
    WHERE m.start_time::date = p_date
    AND o.total IS NOT NULL
    AND m.status NOT IN ('STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_POSTPONED')
  ),
  -- Historical rates by position + matchup
  hist AS (
    SELECT 
      CASE 
        WHEN MOD(open_total::int, 10) IN (8, 9) THEN 'below_round'
        WHEN MOD(open_total::int, 10) IN (0, 1, 2) THEN 'above_round'
        WHEN MOD(open_total::int, 10) IN (3, 4) THEN 'mid_low'
        ELSE 'mid_high'
      END as h_position,
      CASE WHEN ABS(open_spread) < 5 THEN 'competitive' ELSE 'lopsided' END as h_matchup,
      -- How often catchers push in the predicted direction
      ROUND(100.0 * COUNT(*) FILTER (WHERE 
        (MOD(open_total::int, 10) IN (8, 9, 3, 4) AND total_move < -1) OR
        (MOD(open_total::int, 10) IN (0, 1, 2) AND total_move > 1)
      )::numeric / NULLIF(COUNT(*), 0), 1) as h_catcher_pct,
      -- Middle rate on moves >= 3
      ROUND(100.0 * COUNT(*) FILTER (WHERE 
        ABS(total_move) >= 3 AND (
          (total_move > 0 AND final_total > open_total AND final_total < close_total) OR
          (total_move < 0 AND final_total < open_total AND final_total > close_total)
        )
      )::numeric / NULLIF(COUNT(*) FILTER (WHERE ABS(total_move) >= 3), 0), 1) as h_middle_pct,
      ROUND(AVG(ABS(total_move)) FILTER (WHERE ABS(total_move) >= 3), 1) as h_avg_corridor
    FROM mv_pregame_clv
    WHERE league_id IN ('nba', 'mens-college-basketball')
    GROUP BY 1, 2
  )
  SELECT 
    t.t_id,
    t.t_league,
    t.t_home,
    t.t_away,
    t.t_start,
    t.t_open_total,
    t.t_open_spread,
    t.t_close_total,
    t.t_close_spread,
    t.t_total_move,
    t.t_spread_move,
    t.t_position,
    t.t_predicted_dir,
    t.t_matchup,
    t.t_spread_flat,
    -- Setup grade
    CASE 
      WHEN t.t_position IN ('below_round', 'mid_low') 
        AND t.t_matchup = 'lopsided'
        AND h.h_middle_pct >= 40 THEN 'A'
      WHEN t.t_position IN ('mid_high')
        AND t.t_matchup = 'competitive'
        AND h.h_middle_pct >= 40 THEN 'A'
      WHEN h.h_middle_pct >= 25 THEN 'B'
      WHEN h.h_catcher_pct >= 40 THEN 'C'
      ELSE 'D'
    END,
    h.h_catcher_pct,
    h.h_middle_pct,
    h.h_avg_corridor
  FROM today t
  LEFT JOIN hist h ON h.h_position = t.t_position AND h.h_matchup = t.t_matchup
  ORDER BY 
    CASE 
      WHEN h.h_middle_pct >= 40 THEN 0
      WHEN h.h_middle_pct >= 25 THEN 1
      ELSE 2
    END,
    h.h_middle_pct DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION get_corridor_scan TO anon;
;
