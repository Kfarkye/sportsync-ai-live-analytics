
-- ============================================================
-- Pregame Line Movement + CLV Detection
-- Catches the sharp signal before the market pushes past ROI
-- ============================================================

-- MV: every game with open-to-close movement, outcome, and CLV classification
CREATE MATERIALIZED VIEW mv_pregame_clv AS
WITH movement AS (
  SELECT 
    o.match_id,
    m.league_id,
    m.home_team,
    m.away_team,
    m.start_time,
    m.home_score,
    m.away_score,
    m.status,
    
    -- Opening lines
    o.total as open_total,
    o.home_spread as open_spread,
    o.home_ml as open_home_ml,
    o.away_ml as open_away_ml,
    
    -- Closing lines
    c.total as close_total,
    c.home_spread as close_spread,
    c.home_ml as close_home_ml,
    c.away_ml as close_away_ml,
    
    -- Movement
    c.total - o.total as total_move,
    c.home_spread - o.home_spread as spread_move,
    
    -- Outcome
    m.home_score + m.away_score as final_total,
    m.home_score - m.away_score as home_margin
    
  FROM opening_lines o
  JOIN closing_lines c ON c.match_id = o.match_id
  JOIN matches m ON m.id = o.match_id
  WHERE o.total IS NOT NULL AND c.total IS NOT NULL
  AND m.status IN ('STATUS_FINAL', 'STATUS_FULL_TIME')
)
SELECT *,

  -- Total movement classification
  CASE 
    WHEN total_move < -3 THEN 'sharp_under'
    WHEN total_move < -1 THEN 'moderate_under'
    WHEN total_move BETWEEN -1 AND 1 THEN 'flat'
    WHEN total_move <= 3 THEN 'moderate_over'
    ELSE 'sharp_over'
  END as total_move_class,
  
  -- Spread movement classification  
  CASE 
    WHEN spread_move < -2 THEN 'sharp_home'
    WHEN spread_move < -0.5 THEN 'moderate_home'
    WHEN spread_move BETWEEN -0.5 AND 0.5 THEN 'flat'
    WHEN spread_move <= 2 THEN 'moderate_away'
    ELSE 'sharp_away'
  END as spread_move_class,
  
  -- Outcome vs open
  CASE WHEN final_total > open_total THEN true ELSE false END as over_open,
  CASE WHEN final_total > close_total THEN true ELSE false END as over_close,
  CASE WHEN home_margin > open_spread THEN true ELSE false END as home_covered_open,
  CASE WHEN home_margin > close_spread THEN true ELSE false END as home_covered_close,
  
  -- CLV: did the closing line move TOWARD what actually happened?
  -- Positive CLV = you got a better number at the open than the close
  final_total - open_total as margin_vs_open,
  final_total - close_total as margin_vs_close,
  
  -- The sweet spot: moderate move that hasn't been pushed past ROI
  CASE 
    WHEN total_move BETWEEN -3 AND -1 AND final_total < close_total THEN 'moderate_under_hit'
    WHEN total_move BETWEEN -3 AND -1 AND final_total >= close_total THEN 'moderate_under_miss'
    WHEN total_move BETWEEN 1 AND 3 AND final_total > close_total THEN 'moderate_over_hit'
    WHEN total_move BETWEEN 1 AND 3 AND final_total <= close_total THEN 'moderate_over_miss'
    WHEN ABS(total_move) > 3 AND final_total < open_total AND final_total > close_total THEN 'overshoot_bounce'
    ELSE 'other'
  END as clv_pattern

FROM movement;

CREATE UNIQUE INDEX ON mv_pregame_clv (match_id);
CREATE INDEX ON mv_pregame_clv (league_id, total_move_class);
CREATE INDEX ON mv_pregame_clv (clv_pattern);
CREATE INDEX ON mv_pregame_clv (start_time);

-- ============================================================
-- RPC: Get today's pregame signals for upcoming games
-- Joins opening_lines to ESPN opening prob to spot divergence
-- ============================================================
CREATE OR REPLACE FUNCTION get_pregame_sharp_signals(p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  match_id text,
  league_id text,
  home_team text,
  away_team text,
  start_time timestamptz,
  -- Opening lines
  open_total numeric,
  open_spread numeric,
  open_home_ml integer,
  -- Current closing / latest lines
  close_total numeric,
  close_spread numeric,
  -- Movement
  total_move numeric,
  spread_move numeric,
  total_move_class text,
  spread_move_class text,
  -- ESPN fair line assessment at tipoff (if available)
  espn_open_over_prob numeric,
  -- Signal strength
  signal_direction text,
  signal_strength text,
  -- Historical CLV for this move class
  historical_hit_rate numeric,
  historical_games integer
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH today_movement AS (
    SELECT 
      o.match_id,
      m.league_id,
      m.home_team,
      m.away_team,
      m.start_time,
      o.total as open_total,
      o.home_spread as open_spread,
      o.home_ml as open_home_ml,
      c.total as close_total,
      c.home_spread as close_spread,
      c.total - o.total as total_move,
      c.home_spread - o.home_spread as spread_move,
      CASE 
        WHEN (c.total - o.total) < -3 THEN 'sharp_under'
        WHEN (c.total - o.total) < -1 THEN 'moderate_under'
        WHEN (c.total - o.total) BETWEEN -1 AND 1 THEN 'flat'
        WHEN (c.total - o.total) <= 3 THEN 'moderate_over'
        ELSE 'sharp_over'
      END as total_move_class,
      CASE 
        WHEN (c.home_spread - o.home_spread) < -2 THEN 'sharp_home'
        WHEN (c.home_spread - o.home_spread) < -0.5 THEN 'moderate_home'
        WHEN (c.home_spread - o.home_spread) BETWEEN -0.5 AND 0.5 THEN 'flat'
        WHEN (c.home_spread - o.home_spread) <= 2 THEN 'moderate_away'
        ELSE 'sharp_away'
      END as spread_move_class
    FROM opening_lines o
    JOIN closing_lines c ON c.match_id = o.match_id
    JOIN matches m ON m.id = o.match_id
    WHERE m.start_time::date = p_date
    AND o.total IS NOT NULL AND c.total IS NOT NULL
    AND m.status NOT IN ('STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_POSTPONED')
  ),
  -- ESPN opening prob for these games
  espn_open AS (
    SELECT DISTINCT ON (ep.match_id) ep.match_id, ep.total_over_prob
    FROM espn_probabilities ep
    WHERE ep.total_over_prob IS NOT NULL
    ORDER BY ep.match_id, ep.sequence_number
  ),
  -- Historical hit rates by move class
  hist AS (
    SELECT total_move_class,
      COUNT(*) as games,
      -- For under moves: how often did the under hit vs close?
      ROUND(COUNT(*) FILTER (WHERE NOT over_close)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as under_vs_close_pct,
      -- For over moves: how often did the over hit vs close?
      ROUND(COUNT(*) FILTER (WHERE over_close)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as over_vs_close_pct
    FROM mv_pregame_clv
    GROUP BY total_move_class
  )
  SELECT 
    tm.match_id,
    tm.league_id,
    tm.home_team,
    tm.away_team,
    tm.start_time,
    tm.open_total,
    tm.open_spread,
    tm.open_home_ml,
    tm.close_total,
    tm.close_spread,
    tm.total_move,
    tm.spread_move,
    tm.total_move_class,
    tm.spread_move_class,
    eo.total_over_prob as espn_open_over_prob,
    -- Direction: which way is the signal pointing?
    CASE 
      WHEN tm.total_move < -1 THEN 'under'
      WHEN tm.total_move > 1 THEN 'over'
      ELSE 'neutral'
    END as signal_direction,
    -- Strength: moderate move = strongest signal (hasn't been pushed past ROI)
    CASE
      WHEN tm.total_move_class IN ('moderate_under', 'moderate_over') THEN 'strong'
      WHEN tm.total_move_class IN ('sharp_under', 'sharp_over') THEN 'fading'
      ELSE 'none'
    END as signal_strength,
    -- Historical hit rate for this move class
    CASE 
      WHEN tm.total_move < -1 THEN h.under_vs_close_pct
      WHEN tm.total_move > 1 THEN h.over_vs_close_pct
      ELSE 50.0
    END as historical_hit_rate,
    h.games as historical_games
  FROM today_movement tm
  LEFT JOIN espn_open eo ON eo.match_id = tm.match_id
  LEFT JOIN hist h ON h.total_move_class = tm.total_move_class
  WHERE tm.total_move_class != 'flat'
  ORDER BY 
    CASE WHEN tm.total_move_class IN ('moderate_under', 'moderate_over') THEN 0 ELSE 1 END,
    ABS(tm.total_move) DESC;
END;
$$;

-- Grant to anon for consumer access
GRANT EXECUTE ON FUNCTION get_pregame_sharp_signals TO anon;

-- Refresh cron: every 30 min
SELECT cron.schedule(
  'refresh-mv-pregame-clv',
  '*/30 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pregame_clv;$$
);
;
