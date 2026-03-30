-- verify_nba_league_structural_baseline.sql
-- Purpose: fast regression checks for canonical NBA league structural layer.
-- Baseline date: 2026-03-29 PT (final-status-gated truth set).

-- 1) Contamination guard: canonical base must not contain non-final statuses.
SELECT
  COUNT(*)::int AS non_final_rows_in_base
FROM public.mv_nba_team_venue_game_lines b
JOIN public.matches m
  ON m.id = b.match_id
WHERE NOT (
  UPPER(COALESCE(m.status, '')) LIKE '%FINAL%'
  OR UPPER(COALESCE(m.status, '')) LIKE '%COMPLETE%'
);

-- 2) Snapshot assertion: expected vs actual for the locked 9-row baseline.
WITH expected AS (
  SELECT 'totals'::text AS metric_type, 'Utah Jazz'::text AS team_name, 'HOME'::text AS venue, '28-12'::text AS exp_record, 70.0::numeric AS exp_over_rate, NULL::numeric AS exp_under_rate, 10.3::numeric AS exp_avg_vs_close, NULL::numeric AS exp_ats_cover_rate
  UNION ALL SELECT 'totals','Phoenix Suns','HOME','13-27',32.5,67.5,-5.4,NULL
  UNION ALL SELECT 'totals','Minnesota Timberwolves','HOME','13-26',33.3,66.7,-4.9,NULL
  UNION ALL SELECT 'totals','Portland Trail Blazers','HOME','25-13',65.8,NULL,4.1,NULL
  UNION ALL SELECT 'totals','Golden State Warriors','HOME','23-15',60.5,NULL,4.8,NULL
  UNION ALL SELECT 'totals','Los Angeles Lakers','HOME','23-15',60.5,NULL,1.8,NULL
  UNION ALL SELECT 'ats','Boston Celtics','AWAY','24-14',NULL,NULL,NULL,63.2
  UNION ALL SELECT 'ats','Minnesota Timberwolves','AWAY','15-23',NULL,NULL,NULL,39.5
  UNION ALL SELECT 'ats','New York Knicks','HOME','25-15',NULL,NULL,NULL,62.5
),
actual AS (
  SELECT
    'totals'::text AS metric_type,
    t.team_name,
    t.venue,
    t.over_record AS record,
    t.over_rate,
    t.under_rate,
    t.avg_vs_close,
    NULL::numeric AS ats_cover_rate
  FROM public.mv_nba_team_venue_totals_trends t
  UNION ALL
  SELECT
    'ats'::text AS metric_type,
    a.team_name,
    a.venue,
    a.ats_record AS record,
    NULL::numeric,
    NULL::numeric,
    NULL::numeric,
    a.ats_cover_rate
  FROM public.mv_nba_team_venue_ats_trends a
),
comparison AS (
  SELECT
    e.metric_type,
    e.team_name,
    e.venue,
    e.exp_record,
    a.record AS actual_record,
    e.exp_over_rate,
    a.over_rate AS actual_over_rate,
    e.exp_under_rate,
    a.under_rate AS actual_under_rate,
    e.exp_avg_vs_close,
    a.avg_vs_close AS actual_avg_vs_close,
    e.exp_ats_cover_rate,
    a.ats_cover_rate AS actual_ats_cover_rate,
    (e.exp_record IS NOT DISTINCT FROM a.record) AS record_match,
    (e.exp_over_rate IS NULL OR e.exp_over_rate = a.over_rate) AS over_rate_match,
    (e.exp_under_rate IS NULL OR e.exp_under_rate = a.under_rate) AS under_rate_match,
    (e.exp_avg_vs_close IS NULL OR e.exp_avg_vs_close = a.avg_vs_close) AS avg_vs_close_match,
    (e.exp_ats_cover_rate IS NULL OR e.exp_ats_cover_rate = a.ats_cover_rate) AS ats_rate_match
  FROM expected e
  LEFT JOIN actual a
    ON a.metric_type = e.metric_type
   AND a.team_name = e.team_name
   AND a.venue = e.venue
)
SELECT
  c.*,
  (c.record_match AND c.over_rate_match AND c.under_rate_match AND c.avg_vs_close_match AND c.ats_rate_match) AS row_pass
FROM comparison c
ORDER BY c.metric_type, c.team_name;

-- 3) One-line summary for quick CI/manual read.
WITH expected AS (
  SELECT 'totals'::text AS metric_type, 'Utah Jazz'::text AS team_name, 'HOME'::text AS venue, '28-12'::text AS exp_record, 70.0::numeric AS exp_over_rate, NULL::numeric AS exp_under_rate, 10.3::numeric AS exp_avg_vs_close, NULL::numeric AS exp_ats_cover_rate
  UNION ALL SELECT 'totals','Phoenix Suns','HOME','13-27',32.5,67.5,-5.4,NULL
  UNION ALL SELECT 'totals','Minnesota Timberwolves','HOME','13-26',33.3,66.7,-4.9,NULL
  UNION ALL SELECT 'totals','Portland Trail Blazers','HOME','25-13',65.8,NULL,4.1,NULL
  UNION ALL SELECT 'totals','Golden State Warriors','HOME','23-15',60.5,NULL,4.8,NULL
  UNION ALL SELECT 'totals','Los Angeles Lakers','HOME','23-15',60.5,NULL,1.8,NULL
  UNION ALL SELECT 'ats','Boston Celtics','AWAY','24-14',NULL,NULL,NULL,63.2
  UNION ALL SELECT 'ats','Minnesota Timberwolves','AWAY','15-23',NULL,NULL,NULL,39.5
  UNION ALL SELECT 'ats','New York Knicks','HOME','25-15',NULL,NULL,NULL,62.5
),
actual AS (
  SELECT
    'totals'::text AS metric_type,
    t.team_name,
    t.venue,
    t.over_record AS record,
    t.over_rate,
    t.under_rate,
    t.avg_vs_close,
    NULL::numeric AS ats_cover_rate
  FROM public.mv_nba_team_venue_totals_trends t
  UNION ALL
  SELECT
    'ats'::text AS metric_type,
    a.team_name,
    a.venue,
    a.ats_record AS record,
    NULL::numeric,
    NULL::numeric,
    NULL::numeric,
    a.ats_cover_rate
  FROM public.mv_nba_team_venue_ats_trends a
),
comparison AS (
  SELECT
    (e.exp_record IS NOT DISTINCT FROM a.record) AS record_match,
    (e.exp_over_rate IS NULL OR e.exp_over_rate = a.over_rate) AS over_rate_match,
    (e.exp_under_rate IS NULL OR e.exp_under_rate = a.under_rate) AS under_rate_match,
    (e.exp_avg_vs_close IS NULL OR e.exp_avg_vs_close = a.avg_vs_close) AS avg_vs_close_match,
    (e.exp_ats_cover_rate IS NULL OR e.exp_ats_cover_rate = a.ats_cover_rate) AS ats_rate_match
  FROM expected e
  LEFT JOIN actual a
    ON a.metric_type = e.metric_type
   AND a.team_name = e.team_name
   AND a.venue = e.venue
)
SELECT
  COUNT(*)::int AS checked_rows,
  COUNT(*) FILTER (WHERE record_match AND over_rate_match AND under_rate_match AND avg_vs_close_match AND ats_rate_match)::int AS passed_rows,
  COUNT(*) FILTER (WHERE NOT (record_match AND over_rate_match AND under_rate_match AND avg_vs_close_match AND ats_rate_match))::int AS failed_rows,
  (COUNT(*) FILTER (WHERE NOT (record_match AND over_rate_match AND under_rate_match AND avg_vs_close_match AND ats_rate_match)) = 0) AS all_pass
FROM comparison;
