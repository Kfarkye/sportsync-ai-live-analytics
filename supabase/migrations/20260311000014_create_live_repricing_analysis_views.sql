-- Research-grade live repricing analysis views.
-- Intent:
-- 1. enforce post-fix quality cutoffs for soccer live research
-- 2. expose analysis-ready event rows without repeated ad hoc filtering
-- 3. expose compact summary views for first-goal, red-card, and timeout studies

CREATE OR REPLACE VIEW v_soccer_first_goal_repricing_research_grade AS
SELECT
  r.*,
  '2026-03-11 18:00:00+00'::timestamptz AS research_cutoff_at,
  CASE
    WHEN r.scoring_side = 'home' THEN post_home_ml - pre_home_ml
    WHEN r.scoring_side = 'away' THEN post_away_ml - pre_away_ml
    ELSE NULL
  END AS scoring_side_ml_shift,
  CASE
    WHEN r.scoring_side = 'home' THEN post_away_ml - pre_away_ml
    WHEN r.scoring_side = 'away' THEN post_home_ml - pre_home_ml
    ELSE NULL
  END AS conceding_side_ml_shift,
  CASE
    WHEN r.scoring_side = 'home' THEN post_draw_ml - pre_draw_ml
    WHEN r.scoring_side = 'away' THEN post_draw_ml - pre_draw_ml
    ELSE NULL
  END AS draw_price_shift
FROM v_first_goal_repricing_clean r
WHERE r.pre_captured_at >= '2026-03-11 18:00:00+00'::timestamptz
  AND r.post_captured_at >= '2026-03-11 18:00:00+00'::timestamptz
  AND r.pre_home_ml IS NOT NULL
  AND r.post_home_ml IS NOT NULL
  AND r.pre_away_ml IS NOT NULL
  AND r.post_away_ml IS NOT NULL
  AND r.pre_draw_ml IS NOT NULL
  AND r.post_draw_ml IS NOT NULL
  AND r.pre_total IS NOT NULL
  AND r.post_total IS NOT NULL
  AND r.pre_over_price IS NOT NULL
  AND r.post_over_price IS NOT NULL
  AND r.pre_under_price IS NOT NULL
  AND r.post_under_price IS NOT NULL;

CREATE OR REPLACE VIEW v_soccer_first_goal_repricing_summary AS
SELECT
  league_id,
  scoring_side,
  score_state_tag,
  count(*) AS events,
  round(avg(repricing_window_sec)::numeric, 2) AS avg_repricing_window_sec,
  round(avg(home_ml_shift)::numeric, 2) AS avg_home_ml_shift,
  round(avg(away_ml_shift)::numeric, 2) AS avg_away_ml_shift,
  round(avg(draw_ml_shift)::numeric, 2) AS avg_draw_ml_shift,
  round(avg(total_shift)::numeric, 2) AS avg_total_shift,
  round(avg(scoring_side_ml_shift)::numeric, 2) AS avg_scoring_side_ml_shift,
  round(avg(conceding_side_ml_shift)::numeric, 2) AS avg_conceding_side_ml_shift,
  round(avg(post_total - pre_total)::numeric, 2) AS avg_total_reprice
FROM v_soccer_first_goal_repricing_research_grade
GROUP BY league_id, scoring_side, score_state_tag
ORDER BY events DESC, league_id, scoring_side;

CREATE OR REPLACE VIEW v_soccer_red_card_market_shift_research_grade AS
SELECT
  r.*,
  '2026-03-11 18:00:00+00'::timestamptz AS research_cutoff_at,
  CASE
    WHEN r.penalized_side = 'home' THEN post_home_ml - pre_home_ml
    WHEN r.penalized_side = 'away' THEN post_away_ml - pre_away_ml
    ELSE NULL
  END AS penalized_side_ml_shift,
  CASE
    WHEN r.penalized_side = 'home' THEN post_away_ml - pre_away_ml
    WHEN r.penalized_side = 'away' THEN post_home_ml - pre_home_ml
    ELSE NULL
  END AS advantaged_side_ml_shift
FROM v_red_card_market_shift_clean r
WHERE r.pre_captured_at >= '2026-03-11 18:00:00+00'::timestamptz
  AND r.post_captured_at >= '2026-03-11 18:00:00+00'::timestamptz
  AND r.pre_home_ml IS NOT NULL
  AND r.post_home_ml IS NOT NULL
  AND r.pre_away_ml IS NOT NULL
  AND r.post_away_ml IS NOT NULL
  AND r.pre_draw_ml IS NOT NULL
  AND r.post_draw_ml IS NOT NULL
  AND r.pre_total IS NOT NULL
  AND r.post_total IS NOT NULL;

CREATE OR REPLACE VIEW v_soccer_red_card_market_shift_summary AS
SELECT
  league_id,
  penalized_side,
  score_state_tag,
  count(*) AS events,
  round(avg(repricing_window_sec)::numeric, 2) AS avg_repricing_window_sec,
  round(avg(home_ml_shift)::numeric, 2) AS avg_home_ml_shift,
  round(avg(away_ml_shift)::numeric, 2) AS avg_away_ml_shift,
  round(avg(draw_ml_shift)::numeric, 2) AS avg_draw_ml_shift,
  round(avg(total_shift)::numeric, 2) AS avg_total_shift,
  round(avg(penalized_side_ml_shift)::numeric, 2) AS avg_penalized_side_ml_shift,
  round(avg(advantaged_side_ml_shift)::numeric, 2) AS avg_advantaged_side_ml_shift
FROM v_soccer_red_card_market_shift_research_grade
GROUP BY league_id, penalized_side, score_state_tag
ORDER BY events DESC, league_id, penalized_side;

CREATE OR REPLACE VIEW v_basketball_timeout_response_research_grade AS
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
    WHEN t.timeout_side = 'home' THEN t.home_ml_shift
    WHEN t.timeout_side = 'away' THEN t.away_ml_shift
    ELSE NULL
  END AS timeout_side_ml_shift,
  CASE
    WHEN t.timeout_side = 'home' THEN t.away_ml_shift
    WHEN t.timeout_side = 'away' THEN t.home_ml_shift
    ELSE NULL
  END AS opponent_side_ml_shift
FROM v_timeout_response_basketball_clean t
WHERE t.pre_captured_at >= '2026-03-11 00:00:00+00'::timestamptz
  AND t.post_captured_at >= '2026-03-11 00:00:00+00'::timestamptz
  AND t.pre_total IS NOT NULL
  AND t.post_total IS NOT NULL
  AND t.pre_spread_home IS NOT NULL
  AND t.post_spread_home IS NOT NULL;

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
  round(avg(timeout_side_ml_shift)::numeric, 2) AS avg_timeout_side_ml_shift,
  round(avg(opponent_side_ml_shift)::numeric, 2) AS avg_opponent_side_ml_shift
FROM v_basketball_timeout_response_research_grade
GROUP BY league_id, timeout_side, timeout_game_state, score_state_tag
ORDER BY events DESC, league_id, timeout_side;
