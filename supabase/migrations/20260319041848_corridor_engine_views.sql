
-- ============================================================
-- CORRIDOR ENGINE: Full view bundle mapped to real schema
-- ============================================================

-- 1. PREGAME CLV SUMMARY (off existing MV)
CREATE OR REPLACE VIEW v_pregame_clv_summary AS
SELECT
  league_id,
  total_move_class as move_class,
  COUNT(*) as games,
  ROUND(AVG(total_move), 2) as avg_move_points,
  ROUND(100.0 * COUNT(*) FILTER (WHERE 
    (total_move < 0 AND NOT over_close) OR 
    (total_move > 0 AND over_close)
  )::numeric / NULLIF(COUNT(*), 0), 1) as direction_hit_rate_pct,
  -- Middle rate: game landed between open and close
  ROUND(100.0 * COUNT(*) FILTER (WHERE 
    (total_move > 0 AND final_total > open_total AND final_total < close_total) OR
    (total_move < 0 AND final_total < open_total AND final_total > close_total)
  )::numeric / NULLIF(COUNT(*), 0), 1) as middle_rate_pct,
  -- Reversed: game went past open in wrong direction
  ROUND(100.0 * COUNT(*) FILTER (WHERE 
    (total_move > 0 AND final_total <= open_total) OR
    (total_move < 0 AND final_total >= open_total)
  )::numeric / NULLIF(COUNT(*), 0), 1) as reversed_rate_pct
FROM mv_pregame_clv
WHERE ABS(total_move) > 0
GROUP BY league_id, total_move_class;

-- 2. ESPN EXTREME TRIGGERS
-- First time ESPN over prob hits <5% or >95% per game
-- Uses sequence_number as proxy for game progression
CREATE OR REPLACE VIEW v_espn_extreme_triggers AS
WITH tagged AS (
  SELECT
    ep.match_id,
    ep.league_id,
    ep.sequence_number,
    ep.total_over_prob,
    ep.seconds_left,
    ep.created_at,
    CASE
      WHEN ep.total_over_prob <= 0.05 THEN 'under_extreme'
      WHEN ep.total_over_prob >= 0.95 THEN 'over_extreme'
      WHEN ep.total_over_prob <= 0.15 THEN 'under_window'
      WHEN ep.total_over_prob >= 0.85 THEN 'over_window'
      ELSE NULL
    END as trigger_type
  FROM espn_probabilities ep
  WHERE ep.total_over_prob IS NOT NULL
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY match_id, trigger_type 
      ORDER BY sequence_number ASC
    ) as rn
  FROM tagged
  WHERE trigger_type IS NOT NULL
)
SELECT
  match_id,
  league_id,
  trigger_type,
  sequence_number as trigger_sequence,
  total_over_prob as trigger_prob,
  seconds_left as trigger_seconds_left,
  created_at as trigger_ts
FROM ranked
WHERE rn = 1;

-- 3. OVERSHOOT SUMMARY (off existing MV)
CREATE OR REPLACE VIEW v_overshoot_summary AS
SELECT
  league_id,
  total_move_class as move_class,
  COUNT(*) as games,
  -- Overshoot: sharp move but game landed on the OTHER side of close
  ROUND(100.0 * COUNT(*) FILTER (WHERE
    (total_move_class = 'sharp_under' AND final_total > close_total AND final_total < open_total) OR
    (total_move_class = 'sharp_over' AND final_total < close_total AND final_total > open_total)
  )::numeric / NULLIF(COUNT(*), 0), 1) as overshoot_middle_pct,
  -- Catchers right: game went past close in move direction
  ROUND(100.0 * COUNT(*) FILTER (WHERE
    (total_move < 0 AND final_total <= close_total) OR
    (total_move > 0 AND final_total >= close_total)
  )::numeric / NULLIF(COUNT(*), 0), 1) as catchers_right_pct,
  ROUND(AVG(ABS(total_move)), 1) as avg_corridor
FROM mv_pregame_clv
WHERE total_move_class IN ('sharp_under', 'sharp_over')
GROUP BY league_id, total_move_class;

-- 4. MIDDLE WINDOWS MV (using ESPN probs as live total proxy)
-- ESPN prob extremes define the corridor — DK live total reprices proportionally
-- We estimate DK live deviation from the ESPN prob extreme:
--   prob < 5% → live total ~18 pts below pregame
--   prob 5-15% → ~12 pts below
--   prob > 95% → ~18 pts above
--   prob 85-95% → ~12 pts above
CREATE MATERIALIZED VIEW mv_middle_windows AS
WITH game_extremes AS (
  SELECT 
    ep.match_id,
    MIN(ep.total_over_prob) as min_over_prob,
    MAX(ep.total_over_prob) as max_over_prob,
    -- First under extreme sequence
    MIN(CASE WHEN ep.total_over_prob < 0.15 THEN ep.sequence_number END) as first_under_window_seq,
    -- First over extreme sequence
    MIN(CASE WHEN ep.total_over_prob > 0.85 THEN ep.sequence_number END) as first_over_window_seq
  FROM espn_probabilities ep
  WHERE ep.total_over_prob IS NOT NULL
  GROUP BY ep.match_id
),
with_context AS (
  SELECT
    mv.*,
    ge.min_over_prob,
    ge.max_over_prob,
    ge.first_under_window_seq,
    ge.first_over_window_seq,
    -- Estimated max corridor from ESPN prob extremes
    CASE 
      WHEN ge.min_over_prob < 0.05 THEN 18
      WHEN ge.min_over_prob < 0.10 THEN 14
      WHEN ge.min_over_prob < 0.15 THEN 10
      WHEN ge.min_over_prob < 0.25 THEN 6
      ELSE 0
    END as est_under_deviation,
    CASE 
      WHEN ge.max_over_prob > 0.95 THEN 18
      WHEN ge.max_over_prob > 0.90 THEN 14
      WHEN ge.max_over_prob > 0.85 THEN 10
      WHEN ge.max_over_prob > 0.75 THEN 6
      ELSE 0
    END as est_over_deviation
  FROM mv_pregame_clv mv
  JOIN game_extremes ge ON ge.match_id = mv.match_id
)
SELECT
  match_id, league_id, home_team, away_team, start_time,
  open_total, close_total, final_total, total_move, total_move_class,
  min_over_prob, max_over_prob,
  first_under_window_seq, first_over_window_seq,
  est_under_deviation, est_over_deviation,
  
  -- Estimated DK live total at each extreme
  close_total - est_under_deviation as est_live_low,
  close_total + est_over_deviation as est_live_high,
  
  -- Window classification
  CASE WHEN est_under_deviation >= 10 OR est_over_deviation >= 10 THEN true ELSE false END as has_10pt_window,
  CASE WHEN est_under_deviation >= 6 OR est_over_deviation >= 6 THEN true ELSE false END as has_6pt_window,
  CASE WHEN est_under_deviation > 0 AND est_over_deviation > 0 THEN true ELSE false END as has_both_windows,
  
  -- Did the final land inside the trigger corridor?
  -- Strategy A: UNDER pregame + OVER live (when prob dipped)
  CASE WHEN est_under_deviation > 0 
    AND final_total < close_total 
    AND final_total > (close_total - est_under_deviation) 
  THEN true ELSE false END as strategy_a_middle,
  
  -- Strategy B: OVER pregame + UNDER live (when prob spiked)
  CASE WHEN est_over_deviation > 0 
    AND final_total > close_total 
    AND final_total < (close_total + est_over_deviation) 
  THEN true ELSE false END as strategy_b_middle,
  
  -- Either strategy middle
  CASE WHEN 
    (est_under_deviation > 0 AND final_total < close_total AND final_total > (close_total - est_under_deviation)) OR
    (est_over_deviation > 0 AND final_total > close_total AND final_total < (close_total + est_over_deviation))
  THEN true ELSE false END as any_middle

FROM with_context;

CREATE UNIQUE INDEX ON mv_middle_windows (match_id);
CREATE INDEX ON mv_middle_windows (league_id, start_time);
CREATE INDEX ON mv_middle_windows (has_both_windows);

-- 5. MIDDLE WINDOW PERFORMANCE SUMMARY
CREATE OR REPLACE VIEW v_middle_window_summary AS
SELECT
  league_id,
  COUNT(*) as games,
  COUNT(*) FILTER (WHERE has_6pt_window) as games_with_6pt_window,
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_6pt_window)::numeric / COUNT(*), 1) as pct_6pt_window,
  COUNT(*) FILTER (WHERE has_10pt_window) as games_with_10pt_window,
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_10pt_window)::numeric / COUNT(*), 1) as pct_10pt_window,
  COUNT(*) FILTER (WHERE has_both_windows) as games_with_both,
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_both_windows)::numeric / COUNT(*), 1) as pct_both_windows,
  -- Strategy A: under pregame + over live on cold run
  COUNT(*) FILTER (WHERE est_under_deviation > 0) as strategy_a_eligible,
  COUNT(*) FILTER (WHERE strategy_a_middle) as strategy_a_middles,
  ROUND(100.0 * COUNT(*) FILTER (WHERE strategy_a_middle)::numeric / 
    NULLIF(COUNT(*) FILTER (WHERE est_under_deviation > 0), 0), 1) as strategy_a_middle_pct,
  -- Strategy B: over pregame + under live on hot run
  COUNT(*) FILTER (WHERE est_over_deviation > 0) as strategy_b_eligible,
  COUNT(*) FILTER (WHERE strategy_b_middle) as strategy_b_middles,
  ROUND(100.0 * COUNT(*) FILTER (WHERE strategy_b_middle)::numeric / 
    NULLIF(COUNT(*) FILTER (WHERE est_over_deviation > 0), 0), 1) as strategy_b_middle_pct,
  -- Either
  COUNT(*) FILTER (WHERE any_middle) as any_middle_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE any_middle)::numeric / COUNT(*), 1) as any_middle_pct
FROM mv_middle_windows
GROUP BY league_id;

-- 6. CORRIDOR SETUP SCANNER (competitive + over move + flat spread = best middle)
CREATE OR REPLACE VIEW v_corridor_setups AS
SELECT
  match_id, league_id, home_team, away_team, start_time,
  open_total, close_total, total_move, open_spread, close_spread, spread_move,
  final_total, total_move_class,
  -- Setup quality
  CASE 
    WHEN ABS(open_spread) < 10 AND total_move > 5 AND ABS(spread_move) < 1 
      THEN 'A_GRADE'  -- competitive, over move, no news
    WHEN ABS(open_spread) < 10 AND total_move > 5 
      THEN 'B_GRADE'  -- competitive, over move, spread moved
    WHEN ABS(open_spread) < 10 AND total_move < -5 AND ABS(spread_move) < 1
      THEN 'B_GRADE'  -- competitive, under move, no news
    WHEN ABS(total_move) > 5
      THEN 'C_GRADE'  -- any big move
    ELSE 'NO_SETUP'
  END as setup_grade,
  -- Middle result
  CASE WHEN 
    (total_move > 0 AND final_total > open_total AND final_total < close_total) OR
    (total_move < 0 AND final_total < open_total AND final_total > close_total)
  THEN true ELSE false END as pregame_middle_hit
FROM mv_pregame_clv
WHERE ABS(total_move) >= 3;

-- 7. REFRESH FUNCTION
CREATE OR REPLACE FUNCTION refresh_corridor_engine()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pregame_clv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_middle_windows;
END;
$$;
;
