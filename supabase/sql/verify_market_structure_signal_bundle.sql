-- verify_market_structure_signal_bundle.sql
-- Run after applying 20260319001000_market_structure_signal_bundle.sql

-- 1) Object row counts
SELECT 'mv_pregame_clv' AS object_name, count(*) AS rows FROM public.mv_pregame_clv
UNION ALL
SELECT 'mv_middle_windows', count(*) FROM public.mv_middle_windows
UNION ALL
SELECT 'v_pregame_clv_summary', count(*) FROM public.v_pregame_clv_summary
UNION ALL
SELECT 'v_clob_repricing_delta', count(*) FROM public.v_clob_repricing_delta
UNION ALL
SELECT 'v_espn_extreme_triggers', count(*) FROM public.v_espn_extreme_triggers
UNION ALL
SELECT 'v_trigger_hedge_windows', count(*) FROM public.v_trigger_hedge_windows
UNION ALL
SELECT 'v_trigger_performance_summary', count(*) FROM public.v_trigger_performance_summary
UNION ALL
SELECT 'v_overshoot_summary', count(*) FROM public.v_overshoot_summary
UNION ALL
SELECT 'v_dk_risk_steam_maturity', count(*) FROM public.v_dk_risk_steam_maturity;

-- 2) Null rates / quality checks
SELECT
  round(100.0 * avg(CASE WHEN open_total IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_open_total_null,
  round(100.0 * avg(CASE WHEN close_total IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_close_total_null,
  round(100.0 * avg(CASE WHEN final_total IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_final_total_null
FROM public.mv_pregame_clv;

SELECT
  round(100.0 * avg(CASE WHEN pregame_anchor_total IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_anchor_null,
  round(100.0 * avg(CASE WHEN min_live_total IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_min_live_null,
  round(100.0 * avg(CASE WHEN max_live_total IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_max_live_null
FROM public.mv_middle_windows;

SELECT
  round(100.0 * avg(CASE WHEN match_id IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_match_id_null,
  round(100.0 * avg(CASE WHEN latest_clob_prob IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_latest_clob_null,
  round(100.0 * avg(CASE WHEN snapshot_count IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_snapshot_count_null
FROM public.v_clob_repricing_delta;

SELECT
  round(100.0 * avg(CASE WHEN trigger_ts IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_trigger_ts_null,
  round(100.0 * avg(CASE WHEN total_over_prob IS NULL THEN 1.0 ELSE 0.0 END), 2) AS pct_trigger_prob_null
FROM public.v_espn_extreme_triggers;

SELECT
  round(100.0 * avg(CASE WHEN trigger_seen THEN 1.0 ELSE 0.0 END), 2) AS pct_trigger_seen,
  round(100.0 * avg(CASE WHEN nearest_live_quote_found THEN 1.0 ELSE 0.0 END), 2) AS pct_nearest_live_quote_found,
  round(100.0 * avg(CASE WHEN corridor_observed THEN 1.0 ELSE 0.0 END), 2) AS pct_corridor_observed
FROM public.v_trigger_hedge_windows;

-- 3) Sample 10 joined games per view
SELECT *
FROM public.mv_pregame_clv
ORDER BY game_date DESC, match_id
LIMIT 10;

SELECT *
FROM public.v_clob_repricing_delta
WHERE match_id IS NOT NULL
ORDER BY latest_snapshot_ts DESC NULLS LAST
LIMIT 10;

SELECT *
FROM public.v_trigger_hedge_windows
ORDER BY trigger_ts DESC NULLS LAST
LIMIT 10;

SELECT *
FROM public.mv_middle_windows
ORDER BY game_date DESC, match_id
LIMIT 10;

-- 4) One-day sanity check for NBA/NCAAB
-- Replace CURRENT_DATE - 1 with a known active date if needed.
WITH d AS (
  SELECT (CURRENT_DATE - 1) AS target_date
)
SELECT
  c.sport,
  c.game_date,
  count(*) AS games,
  round(avg(c.move_points), 2) AS avg_move_points,
  round(avg(abs(c.move_points)), 2) AS avg_abs_move_points,
  round(100.0 * avg(CASE WHEN c.move_direction_hit THEN 1.0 ELSE 0.0 END), 1) AS direction_hit_rate_pct
FROM public.mv_pregame_clv c
JOIN d ON d.target_date = c.game_date
WHERE c.league_id IN ('nba', 'mens-college-basketball')
GROUP BY c.sport, c.game_date
ORDER BY c.sport;

WITH d AS (
  SELECT (CURRENT_DATE - 1) AS target_date
)
SELECT
  h.sport,
  h.game_date,
  h.trigger_type,
  count(*) AS trigger_games,
  round(avg(h.corridor_width_points), 2) AS avg_corridor,
  round(100.0 * avg(CASE WHEN h.final_landed_in_trigger_corridor THEN 1.0 ELSE 0.0 END), 1) AS middle_rate_pct
FROM public.v_trigger_hedge_windows h
JOIN d ON d.target_date = h.game_date
WHERE h.league_id IN ('nba', 'mens-college-basketball')
GROUP BY h.sport, h.game_date, h.trigger_type
ORDER BY h.sport, h.trigger_type;

-- 5) Function smoke test
SELECT *
FROM public.get_pregame_sharp_signals(CURRENT_DATE)
LIMIT 25;
