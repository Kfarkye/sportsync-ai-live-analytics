-- Canonical NBA league structural views (team x venue from matches safe lines)
-- Zones:
-- - DATA/ID (Amazon+Google): canonical team-game expansion and aggregation keys.
-- - MONEY (Stripe): market grading versus odds_total_safe / odds_home_spread_safe.
-- - OPS (SRE+Amazon): concurrent refresh safety + ordered refresh orchestration.

DROP VIEW IF EXISTS public.vw_nba_league_structural_cards;
DROP MATERIALIZED VIEW IF EXISTS public.mv_nba_team_venue_flip_trends;
DROP MATERIALIZED VIEW IF EXISTS public.mv_nba_team_venue_ats_trends;
DROP MATERIALIZED VIEW IF EXISTS public.mv_nba_team_venue_totals_trends;
DROP MATERIALIZED VIEW IF EXISTS public.mv_nba_team_venue_game_lines;
DROP FUNCTION IF EXISTS public.refresh_nba_league_structural_views();

CREATE MATERIALIZED VIEW public.mv_nba_team_venue_game_lines AS
WITH source AS (
  SELECT
    m.id AS match_id,
    (m.start_time AT TIME ZONE 'America/Los_Angeles')::date AS match_date_pt,
    m.home_team,
    m.away_team,
    m.home_score,
    m.away_score,
    (m.home_score + m.away_score)::numeric AS actual_total,
    m.odds_total_safe::numeric AS closing_total,
    m.odds_home_spread_safe::numeric AS closing_home_spread
  FROM public.matches m
  WHERE m.sport = 'basketball'
    AND m.league_id = 'nba'
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
    AND (
      UPPER(COALESCE(m.status, '')) LIKE '%FINAL%'
      OR UPPER(COALESCE(m.status, '')) LIKE '%COMPLETE%'
    )
),
expanded AS (
  SELECT
    s.match_id,
    s.match_date_pt,
    s.home_team AS team_name,
    s.away_team AS opponent_name,
    'HOME'::text AS venue,
    s.home_score AS team_score,
    s.away_score AS opp_score,
    s.actual_total,
    s.closing_total,
    s.closing_home_spread AS team_spread
  FROM source s
  UNION ALL
  SELECT
    s.match_id,
    s.match_date_pt,
    s.away_team AS team_name,
    s.home_team AS opponent_name,
    'AWAY'::text AS venue,
    s.away_score AS team_score,
    s.home_score AS opp_score,
    s.actual_total,
    s.closing_total,
    CASE
      WHEN s.closing_home_spread IS NULL THEN NULL
      ELSE -s.closing_home_spread
    END AS team_spread
  FROM source s
)
SELECT
  e.match_id,
  e.match_date_pt,
  e.team_name,
  e.opponent_name,
  e.venue,
  e.team_score,
  e.opp_score,
  e.actual_total,
  e.closing_total,
  CASE
    WHEN e.closing_total IS NULL THEN NULL
    WHEN e.actual_total > e.closing_total THEN 'over'
    WHEN e.actual_total < e.closing_total THEN 'under'
    ELSE 'push'
  END AS total_result,
  CASE
    WHEN e.closing_total IS NULL THEN NULL
    ELSE e.actual_total > e.closing_total
  END AS is_total_over,
  CASE
    WHEN e.closing_total IS NULL THEN NULL
    ELSE e.actual_total < e.closing_total
  END AS is_total_under,
  CASE
    WHEN e.closing_total IS NULL THEN NULL
    ELSE e.actual_total = e.closing_total
  END AS is_total_push,
  CASE
    WHEN e.closing_total IS NULL THEN NULL
    ELSE e.actual_total - e.closing_total
  END AS vs_total_close,
  e.team_spread,
  CASE
    WHEN e.team_spread IS NULL THEN NULL
    WHEN (e.team_score + e.team_spread) > e.opp_score THEN 'cover'
    WHEN (e.team_score + e.team_spread) < e.opp_score THEN 'no_cover'
    ELSE 'push'
  END AS ats_result,
  CASE
    WHEN e.team_spread IS NULL THEN NULL
    ELSE (e.team_score + e.team_spread) > e.opp_score
  END AS is_ats_cover,
  CASE
    WHEN e.team_spread IS NULL THEN NULL
    ELSE (e.team_score + e.team_spread) < e.opp_score
  END AS is_ats_no_cover,
  CASE
    WHEN e.team_spread IS NULL THEN NULL
    ELSE (e.team_score + e.team_spread) = e.opp_score
  END AS is_ats_push,
  CASE
    WHEN e.team_spread IS NULL THEN NULL
    ELSE (e.team_score + e.team_spread) - e.opp_score
  END AS ats_margin_vs_spread
FROM expanded e;

CREATE UNIQUE INDEX mv_nba_team_venue_game_lines_uidx
  ON public.mv_nba_team_venue_game_lines (match_id, venue);

CREATE INDEX mv_nba_team_venue_game_lines_team_venue_date_idx
  ON public.mv_nba_team_venue_game_lines (team_name, venue, match_date_pt DESC);

CREATE MATERIALIZED VIEW public.mv_nba_team_venue_totals_trends AS
WITH aggregated AS (
  SELECT
    g.team_name,
    g.venue,
    COUNT(*) FILTER (WHERE g.is_total_over OR g.is_total_under)::int AS graded_total_games,
    COUNT(*) FILTER (WHERE g.is_total_over)::int AS over_wins,
    COUNT(*) FILTER (WHERE g.is_total_under)::int AS under_wins,
    COUNT(*) FILTER (WHERE g.is_total_push)::int AS pushes,
    ROUND(AVG(g.vs_total_close) FILTER (WHERE g.is_total_over OR g.is_total_under), 1) AS avg_vs_close,
    ROUND(AVG(g.closing_total) FILTER (WHERE g.closing_total IS NOT NULL), 1) AS avg_closing_total,
    ROUND(AVG(g.actual_total) FILTER (WHERE g.closing_total IS NOT NULL), 1) AS avg_actual_total,
    MAX(g.match_date_pt) AS last_match_date_pt
  FROM public.mv_nba_team_venue_game_lines g
  GROUP BY g.team_name, g.venue
)
SELECT
  a.team_name,
  a.venue,
  a.graded_total_games,
  a.over_wins,
  a.under_wins,
  a.pushes,
  (a.over_wins::text || '-' || a.under_wins::text) AS over_record,
  (a.under_wins::text || '-' || a.over_wins::text) AS under_record,
  CASE
    WHEN a.graded_total_games > 0 THEN ROUND(100.0 * a.over_wins::numeric / a.graded_total_games, 1)
    ELSE NULL
  END AS over_rate,
  CASE
    WHEN a.graded_total_games > 0 THEN ROUND(100.0 * a.under_wins::numeric / a.graded_total_games, 1)
    ELSE NULL
  END AS under_rate,
  a.avg_vs_close,
  a.avg_closing_total,
  a.avg_actual_total,
  a.last_match_date_pt
FROM aggregated a;

CREATE UNIQUE INDEX mv_nba_team_venue_totals_trends_uidx
  ON public.mv_nba_team_venue_totals_trends (team_name, venue);

CREATE INDEX mv_nba_team_venue_totals_trends_rate_idx
  ON public.mv_nba_team_venue_totals_trends (venue, over_rate DESC, graded_total_games DESC);

CREATE MATERIALIZED VIEW public.mv_nba_team_venue_ats_trends AS
WITH aggregated AS (
  SELECT
    g.team_name,
    g.venue,
    COUNT(*) FILTER (WHERE g.is_ats_cover OR g.is_ats_no_cover)::int AS graded_ats_games,
    COUNT(*) FILTER (WHERE g.is_ats_cover)::int AS ats_covers,
    COUNT(*) FILTER (WHERE g.is_ats_no_cover)::int AS ats_no_covers,
    COUNT(*) FILTER (WHERE g.is_ats_push)::int AS ats_pushes,
    ROUND(AVG(g.ats_margin_vs_spread) FILTER (WHERE g.is_ats_cover OR g.is_ats_no_cover), 1) AS avg_margin_vs_spread,
    MAX(g.match_date_pt) AS last_match_date_pt
  FROM public.mv_nba_team_venue_game_lines g
  GROUP BY g.team_name, g.venue
)
SELECT
  a.team_name,
  a.venue,
  a.graded_ats_games,
  a.ats_covers,
  a.ats_no_covers,
  a.ats_pushes,
  (a.ats_covers::text || '-' || a.ats_no_covers::text) AS ats_record,
  CASE
    WHEN a.graded_ats_games > 0 THEN ROUND(100.0 * a.ats_covers::numeric / a.graded_ats_games, 1)
    ELSE NULL
  END AS ats_cover_rate,
  a.avg_margin_vs_spread,
  a.last_match_date_pt
FROM aggregated a;

CREATE UNIQUE INDEX mv_nba_team_venue_ats_trends_uidx
  ON public.mv_nba_team_venue_ats_trends (team_name, venue);

CREATE INDEX mv_nba_team_venue_ats_trends_rate_idx
  ON public.mv_nba_team_venue_ats_trends (venue, ats_cover_rate DESC, graded_ats_games DESC);

CREATE MATERIALIZED VIEW public.mv_nba_team_venue_flip_trends AS
SELECT
  h.team_name,
  h.over_rate AS home_over_rate,
  a.over_rate AS away_over_rate,
  CASE
    WHEN h.over_rate IS NULL OR a.over_rate IS NULL THEN NULL
    ELSE ROUND(h.over_rate - a.over_rate, 1)
  END AS swing_over_pct,
  h.avg_vs_close AS home_avg_vs_close,
  a.avg_vs_close AS away_avg_vs_close,
  CASE
    WHEN h.over_rate IS NULL OR a.over_rate IS NULL THEN NULL
    WHEN (h.over_rate - a.over_rate) > 0 THEN 'more_over_home'
    WHEN (h.over_rate - a.over_rate) < 0 THEN 'more_over_away'
    ELSE 'balanced'
  END AS flip_direction
FROM public.mv_nba_team_venue_totals_trends h
JOIN public.mv_nba_team_venue_totals_trends a
  ON a.team_name = h.team_name
WHERE h.venue = 'HOME'
  AND a.venue = 'AWAY';

CREATE UNIQUE INDEX mv_nba_team_venue_flip_trends_uidx
  ON public.mv_nba_team_venue_flip_trends (team_name);

CREATE OR REPLACE VIEW public.vw_nba_league_structural_cards AS
WITH team_index AS (
  SELECT team_name FROM public.mv_nba_team_venue_totals_trends
  UNION
  SELECT team_name FROM public.mv_nba_team_venue_ats_trends
  UNION
  SELECT team_name FROM public.mv_nba_team_venue_flip_trends
),
totals_home AS (
  SELECT * FROM public.mv_nba_team_venue_totals_trends WHERE venue = 'HOME'
),
totals_away AS (
  SELECT * FROM public.mv_nba_team_venue_totals_trends WHERE venue = 'AWAY'
),
ats_home AS (
  SELECT * FROM public.mv_nba_team_venue_ats_trends WHERE venue = 'HOME'
),
ats_away AS (
  SELECT * FROM public.mv_nba_team_venue_ats_trends WHERE venue = 'AWAY'
)
SELECT
  t.team_name,
  th.graded_total_games AS home_graded_total_games,
  th.over_wins AS home_over_wins,
  th.under_wins AS home_under_wins,
  th.pushes AS home_total_pushes,
  th.over_record AS home_over_record,
  th.under_record AS home_under_record,
  th.over_rate AS home_over_rate,
  th.under_rate AS home_under_rate,
  th.avg_vs_close AS home_avg_vs_close,
  th.avg_closing_total AS home_avg_closing_total,
  th.avg_actual_total AS home_avg_actual_total,
  th.last_match_date_pt AS home_last_match_date_pt,
  ta.graded_total_games AS away_graded_total_games,
  ta.over_wins AS away_over_wins,
  ta.under_wins AS away_under_wins,
  ta.pushes AS away_total_pushes,
  ta.over_record AS away_over_record,
  ta.under_record AS away_under_record,
  ta.over_rate AS away_over_rate,
  ta.under_rate AS away_under_rate,
  ta.avg_vs_close AS away_avg_vs_close,
  ta.avg_closing_total AS away_avg_closing_total,
  ta.avg_actual_total AS away_avg_actual_total,
  ta.last_match_date_pt AS away_last_match_date_pt,
  ah.graded_ats_games AS home_graded_ats_games,
  ah.ats_covers AS home_ats_covers,
  ah.ats_no_covers AS home_ats_no_covers,
  ah.ats_pushes AS home_ats_pushes,
  ah.ats_record AS home_ats_record,
  ah.ats_cover_rate AS home_ats_cover_rate,
  ah.avg_margin_vs_spread AS home_avg_margin_vs_spread,
  ah.last_match_date_pt AS home_ats_last_match_date_pt,
  aa.graded_ats_games AS away_graded_ats_games,
  aa.ats_covers AS away_ats_covers,
  aa.ats_no_covers AS away_ats_no_covers,
  aa.ats_pushes AS away_ats_pushes,
  aa.ats_record AS away_ats_record,
  aa.ats_cover_rate AS away_ats_cover_rate,
  aa.avg_margin_vs_spread AS away_avg_margin_vs_spread,
  aa.last_match_date_pt AS away_ats_last_match_date_pt,
  vf.home_over_rate AS venue_flip_home_over_rate,
  vf.away_over_rate AS venue_flip_away_over_rate,
  vf.swing_over_pct,
  vf.home_avg_vs_close AS venue_flip_home_avg_vs_close,
  vf.away_avg_vs_close AS venue_flip_away_avg_vs_close,
  vf.flip_direction
FROM team_index t
LEFT JOIN totals_home th
  ON th.team_name = t.team_name
LEFT JOIN totals_away ta
  ON ta.team_name = t.team_name
LEFT JOIN ats_home ah
  ON ah.team_name = t.team_name
LEFT JOIN ats_away aa
  ON aa.team_name = t.team_name
LEFT JOIN public.mv_nba_team_venue_flip_trends vf
  ON vf.team_name = t.team_name;

CREATE OR REPLACE FUNCTION public.refresh_nba_league_structural_views()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_started_at timestamptz := clock_timestamp();
  v_game_lines_rows bigint;
  v_totals_rows bigint;
  v_ats_rows bigint;
  v_flip_rows bigint;
BEGIN
  IF to_regclass('public.mv_nba_team_venue_game_lines') IS NULL THEN
    RAISE EXCEPTION 'Missing dependency: public.mv_nba_team_venue_game_lines';
  END IF;

  IF to_regclass('public.mv_nba_team_venue_totals_trends') IS NULL THEN
    RAISE EXCEPTION 'Missing dependency: public.mv_nba_team_venue_totals_trends';
  END IF;

  IF to_regclass('public.mv_nba_team_venue_ats_trends') IS NULL THEN
    RAISE EXCEPTION 'Missing dependency: public.mv_nba_team_venue_ats_trends';
  END IF;

  IF to_regclass('public.mv_nba_team_venue_flip_trends') IS NULL THEN
    RAISE EXCEPTION 'Missing dependency: public.mv_nba_team_venue_flip_trends';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.mv_nba_team_venue_game_lines'::regclass
      AND i.indisunique
      AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'Concurrent refresh prerequisite missing: unique index on mv_nba_team_venue_game_lines';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.mv_nba_team_venue_totals_trends'::regclass
      AND i.indisunique
      AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'Concurrent refresh prerequisite missing: unique index on mv_nba_team_venue_totals_trends';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.mv_nba_team_venue_ats_trends'::regclass
      AND i.indisunique
      AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'Concurrent refresh prerequisite missing: unique index on mv_nba_team_venue_ats_trends';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.mv_nba_team_venue_flip_trends'::regclass
      AND i.indisunique
      AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'Concurrent refresh prerequisite missing: unique index on mv_nba_team_venue_flip_trends';
  END IF;

  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_nba_team_venue_game_lines;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Base refresh failed (mv_nba_team_venue_game_lines); dependent refresh aborted: %', SQLERRM;
  END;

  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_nba_team_venue_totals_trends;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Dependent refresh failed (mv_nba_team_venue_totals_trends) after base refresh: %', SQLERRM;
  END;

  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_nba_team_venue_ats_trends;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Dependent refresh failed (mv_nba_team_venue_ats_trends) after totals refresh: %', SQLERRM;
  END;

  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_nba_team_venue_flip_trends;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Dependent refresh failed (mv_nba_team_venue_flip_trends) after ATS refresh: %', SQLERRM;
  END;

  SELECT COUNT(*)::bigint INTO v_game_lines_rows FROM public.mv_nba_team_venue_game_lines;
  SELECT COUNT(*)::bigint INTO v_totals_rows FROM public.mv_nba_team_venue_totals_trends;
  SELECT COUNT(*)::bigint INTO v_ats_rows FROM public.mv_nba_team_venue_ats_trends;
  SELECT COUNT(*)::bigint INTO v_flip_rows FROM public.mv_nba_team_venue_flip_trends;

  RETURN jsonb_build_object(
    'status', 'refreshed',
    'mv_nba_team_venue_game_lines', v_game_lines_rows,
    'mv_nba_team_venue_totals_trends', v_totals_rows,
    'mv_nba_team_venue_ats_trends', v_ats_rows,
    'mv_nba_team_venue_flip_trends', v_flip_rows,
    'duration_ms', ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - v_started_at)) * 1000)::int,
    'refreshed_at', NOW()
  );
END;
$$;

GRANT SELECT ON public.mv_nba_team_venue_game_lines TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_nba_team_venue_totals_trends TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_nba_team_venue_ats_trends TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_nba_team_venue_flip_trends TO anon, authenticated, service_role;
GRANT SELECT ON public.vw_nba_league_structural_cards TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_nba_league_structural_views() TO service_role;

COMMENT ON MATERIALIZED VIEW public.mv_nba_team_venue_game_lines IS
'Canonical NBA team x match grading base sourced from public.matches using odds_total_safe and odds_home_spread_safe.';

COMMENT ON MATERIALIZED VIEW public.mv_nba_team_venue_totals_trends IS
'NBA team + venue totals trends derived from mv_nba_team_venue_game_lines with pushes excluded from rates.';

COMMENT ON MATERIALIZED VIEW public.mv_nba_team_venue_ats_trends IS
'NBA team + venue ATS trends derived from mv_nba_team_venue_game_lines with pushes excluded from ATS cover rate.';

COMMENT ON MATERIALIZED VIEW public.mv_nba_team_venue_flip_trends IS
'NBA venue flip summary built from HOME and AWAY totals trends by team.';

COMMENT ON VIEW public.vw_nba_league_structural_cards IS
'Stable NBA league structural card read layer exposing metrics-only totals, ATS, and venue-flip fields per team.';

COMMENT ON FUNCTION public.refresh_nba_league_structural_views() IS
'Refreshes NBA structural materialized views in strict dependency order with concurrent-refresh guards, row counts, and duration.';

-- Final-status-gated baseline snapshot (as of 2026-03-29 PT):
-- Totals:
--   Utah Jazz HOME:              28-12 | over_rate 70.0 | avg_vs_close +10.3
--   Phoenix Suns HOME:           13-27 | over_rate 32.5 | under_rate 67.5 | avg_vs_close -5.4
--   Minnesota Timberwolves HOME: 13-26 | over_rate 33.3 | under_rate 66.7 | avg_vs_close -4.9
--   Portland Trail Blazers HOME: 25-13 | over_rate 65.8 | avg_vs_close +4.1
--   Golden State Warriors HOME:  23-15 | over_rate 60.5 | avg_vs_close +4.8
--   Los Angeles Lakers HOME:     23-15 | over_rate 60.5 | avg_vs_close +1.8
-- ATS:
--   Boston Celtics AWAY:         24-14 | ats_cover_rate 63.2
--   Minnesota Timberwolves AWAY: 15-23 | ats_cover_rate 39.5
--   New York Knicks HOME:        25-15 | ats_cover_rate 62.5
--
-- Regression assertion SQL:
--   supabase/sql/verify_nba_league_structural_baseline.sql
