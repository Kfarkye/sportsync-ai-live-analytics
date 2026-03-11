DROP VIEW IF EXISTS v_basketball_timeout_response_summary;
DROP VIEW IF EXISTS v_basketball_timeout_response_research_grade;

CREATE OR REPLACE VIEW v_basketball_timeout_response_research_grade AS
WITH base AS (
  SELECT
    t.*,
    CASE
      WHEN t.score_margin >= 15 THEN 'leading_big'
      WHEN t.score_margin BETWEEN 6 AND 14 THEN 'leading_medium'
      WHEN t.score_margin BETWEEN 1 AND 5 THEN 'leading_small'
      WHEN t.score_margin = 0 THEN 'tied'
      WHEN t.score_margin BETWEEN -5 AND -1 THEN 'trailing_small'
      WHEN t.score_margin BETWEEN -14 AND -6 THEN 'trailing_medium'
      ELSE 'trailing_big'
    END AS timeout_game_state,
    CASE
      WHEN t.pre_home_ml IS NULL THEN NULL
      WHEN t.pre_home_ml > 0 THEN 100.0 / (t.pre_home_ml + 100.0)
      ELSE abs(t.pre_home_ml) / (abs(t.pre_home_ml) + 100.0)
    END AS pre_home_implied_prob,
    CASE
      WHEN t.post_home_ml IS NULL THEN NULL
      WHEN t.post_home_ml > 0 THEN 100.0 / (t.post_home_ml + 100.0)
      ELSE abs(t.post_home_ml) / (abs(t.post_home_ml) + 100.0)
    END AS post_home_implied_prob,
    CASE
      WHEN t.pre_away_ml IS NULL THEN NULL
      WHEN t.pre_away_ml > 0 THEN 100.0 / (t.pre_away_ml + 100.0)
      ELSE abs(t.pre_away_ml) / (abs(t.pre_away_ml) + 100.0)
    END AS pre_away_implied_prob,
    CASE
      WHEN t.post_away_ml IS NULL THEN NULL
      WHEN t.post_away_ml > 0 THEN 100.0 / (t.post_away_ml + 100.0)
      ELSE abs(t.post_away_ml) / (abs(t.post_away_ml) + 100.0)
    END AS post_away_implied_prob
  FROM v_timeout_response_basketball_clean t
  WHERE t.pre_captured_at >= '2026-03-11 00:00:00+00'::timestamptz
    AND t.post_captured_at >= '2026-03-11 00:00:00+00'::timestamptz
    AND t.pre_total IS NOT NULL
    AND t.post_total IS NOT NULL
    AND t.pre_spread_home IS NOT NULL
    AND t.post_spread_home IS NOT NULL
)
SELECT
  b.*,
  (b.post_home_implied_prob - b.pre_home_implied_prob) AS home_implied_prob_shift,
  (b.post_away_implied_prob - b.pre_away_implied_prob) AS away_implied_prob_shift,
  CASE
    WHEN b.timeout_side = 'home' THEN (b.post_home_implied_prob - b.pre_home_implied_prob)
    WHEN b.timeout_side = 'away' THEN (b.post_away_implied_prob - b.pre_away_implied_prob)
    ELSE NULL
  END AS timeout_side_implied_prob_shift,
  CASE
    WHEN b.timeout_side = 'home' THEN (b.post_away_implied_prob - b.pre_away_implied_prob)
    WHEN b.timeout_side = 'away' THEN (b.post_home_implied_prob - b.pre_home_implied_prob)
    ELSE NULL
  END AS opponent_side_implied_prob_shift
FROM base b;

CREATE OR REPLACE VIEW v_basketball_timeout_response_summary AS
SELECT
  league_id,
  timeout_side,
  timeout_game_state,
  score_state_tag,
  count(*) AS events,
  round(avg(response_window_sec)::numeric, 2) AS avg_response_window_sec,
  round(avg(total_shift)::numeric, 2) AS avg_total_shift,
  round(avg(spread_home_shift)::numeric, 2) AS avg_spread_home_shift,
  round(avg(home_implied_prob_shift)::numeric, 4) AS avg_home_implied_prob_shift,
  round(avg(away_implied_prob_shift)::numeric, 4) AS avg_away_implied_prob_shift,
  round(avg(timeout_side_implied_prob_shift)::numeric, 4) AS avg_timeout_side_implied_prob_shift,
  round(avg(opponent_side_implied_prob_shift)::numeric, 4) AS avg_opponent_side_implied_prob_shift
FROM v_basketball_timeout_response_research_grade
GROUP BY league_id, timeout_side, timeout_game_state, score_state_tag
ORDER BY events DESC, league_id, timeout_side;
