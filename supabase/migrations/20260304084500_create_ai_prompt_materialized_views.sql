-- AI prompt context materialized views
-- Source table: public.matches

-- 1) League structural profiles
DROP MATERIALIZED VIEW IF EXISTS public.mv_league_structural_profiles;

CREATE MATERIALIZED VIEW public.mv_league_structural_profiles AS
WITH completed AS (
  SELECT
    league_id,
    home_score,
    away_score
  FROM public.matches
  WHERE home_score IS NOT NULL
    AND away_score IS NOT NULL
    AND status IN ('STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_FINAL_AET')
    AND league_id IS NOT NULL
)
SELECT
  league_id,
  COUNT(*)::int AS matches_played,
  ROUND(AVG((home_score + away_score)::numeric), 3) AS avg_total_goals,
  ROUND(AVG(home_score::numeric), 3) AS avg_home_goals,
  ROUND(AVG(away_score::numeric), 3) AS avg_away_goals,
  ROUND(100.0 * AVG(CASE WHEN (home_score + away_score) >= 3 THEN 1 ELSE 0 END), 2) AS over_25_pct,
  ROUND(100.0 * AVG(CASE WHEN (home_score + away_score) >= 4 THEN 1 ELSE 0 END), 2) AS over_35_pct,
  ROUND(100.0 * AVG(CASE WHEN home_score >= 1 AND away_score >= 1 THEN 1 ELSE 0 END), 2) AS btts_pct,
  ROUND(100.0 * AVG(CASE WHEN home_score > away_score THEN 1 ELSE 0 END), 2) AS home_win_pct,
  ROUND(100.0 * AVG(CASE WHEN home_score = away_score THEN 1 ELSE 0 END), 2) AS draw_pct,
  ROUND(100.0 * AVG(CASE WHEN home_score < away_score THEN 1 ELSE 0 END), 2) AS away_win_pct,
  ROUND(AVG((home_score - away_score)::numeric), 3) AS avg_home_margin,
  ROUND(100.0 * AVG(CASE WHEN home_score = 0 OR away_score = 0 THEN 1 ELSE 0 END), 2) AS clean_sheet_pct,
  NOW() AS updated_at
FROM completed
GROUP BY league_id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_league_structural_profiles_league_id_uidx
  ON public.mv_league_structural_profiles (league_id);


-- 2) Team rolling form (last 10 matches, home+away perspective)
DROP MATERIALIZED VIEW IF EXISTS public.mv_team_rolling_form;

CREATE MATERIALIZED VIEW public.mv_team_rolling_form AS
WITH completed AS (
  SELECT
    id,
    league_id,
    start_time,
    home_team,
    away_team,
    home_score,
    away_score
  FROM public.matches
  WHERE home_score IS NOT NULL
    AND away_score IS NOT NULL
    AND status IN ('STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_FINAL_AET')
    AND league_id IS NOT NULL
    AND home_team IS NOT NULL
    AND away_team IS NOT NULL
),
team_rows AS (
  SELECT
    id AS match_id,
    league_id,
    start_time,
    home_team AS team_name,
    away_team AS opponent_name,
    home_score AS goals_scored,
    away_score AS goals_conceded,
    CASE
      WHEN home_score > away_score THEN 'W'
      WHEN home_score = away_score THEN 'D'
      ELSE 'L'
    END AS result
  FROM completed

  UNION ALL

  SELECT
    id AS match_id,
    league_id,
    start_time,
    away_team AS team_name,
    home_team AS opponent_name,
    away_score AS goals_scored,
    home_score AS goals_conceded,
    CASE
      WHEN away_score > home_score THEN 'W'
      WHEN away_score = home_score THEN 'D'
      ELSE 'L'
    END AS result
  FROM completed
),
ranked AS (
  SELECT
    tr.*,
    ROW_NUMBER() OVER (
      PARTITION BY tr.league_id, tr.team_name
      ORDER BY tr.start_time DESC, tr.match_id DESC
    ) AS rn
  FROM team_rows tr
),
last10 AS (
  SELECT *
  FROM ranked
  WHERE rn <= 10
)
SELECT
  l10.team_name,
  l10.league_id,
  COUNT(*)::int AS matches,
  SUM(CASE WHEN l10.result = 'W' THEN 1 ELSE 0 END)::int AS wins,
  SUM(CASE WHEN l10.result = 'D' THEN 1 ELSE 0 END)::int AS draws,
  SUM(CASE WHEN l10.result = 'L' THEN 1 ELSE 0 END)::int AS losses,
  SUM(l10.goals_scored)::int AS goals_scored,
  SUM(l10.goals_conceded)::int AS goals_conceded,
  ROUND(AVG(l10.goals_scored::numeric), 3) AS avg_goals_scored,
  ROUND(AVG(l10.goals_conceded::numeric), 3) AS avg_goals_conceded,
  ROUND(AVG((l10.goals_scored + l10.goals_conceded)::numeric), 3) AS avg_total_goals,
  SUM(CASE WHEN l10.goals_scored >= 1 AND l10.goals_conceded >= 1 THEN 1 ELSE 0 END)::int AS btts_count,
  SUM(CASE WHEN (l10.goals_scored + l10.goals_conceded) >= 3 THEN 1 ELSE 0 END)::int AS over_25_count,
  SUM(CASE WHEN l10.goals_conceded = 0 THEN 1 ELSE 0 END)::int AS clean_sheets_kept,
  COALESCE(
    STRING_AGG(
      CASE WHEN l10.rn <= 5 THEN l10.result ELSE NULL END,
      '' ORDER BY l10.start_time DESC, l10.match_id DESC
    ) FILTER (WHERE l10.rn <= 5),
    ''
  ) AS form_string,
  MAX(l10.start_time) AS last_match_date
FROM last10 l10
GROUP BY l10.team_name, l10.league_id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_team_rolling_form_team_league_uidx
  ON public.mv_team_rolling_form (team_name, league_id);


-- 3) H2H summary (canonical alphabetical pair)
DROP MATERIALIZED VIEW IF EXISTS public.mv_h2h_summary;

CREATE MATERIALIZED VIEW public.mv_h2h_summary AS
WITH completed AS (
  SELECT
    id,
    league_id,
    start_time,
    home_team,
    away_team,
    home_score,
    away_score
  FROM public.matches
  WHERE home_score IS NOT NULL
    AND away_score IS NOT NULL
    AND status IN ('STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_FINAL_AET')
    AND league_id IS NOT NULL
    AND home_team IS NOT NULL
    AND away_team IS NOT NULL
),
canon AS (
  SELECT
    c.id,
    c.league_id,
    c.start_time,
    CASE WHEN lower(c.home_team) <= lower(c.away_team) THEN c.home_team ELSE c.away_team END AS team_a,
    CASE WHEN lower(c.home_team) <= lower(c.away_team) THEN c.away_team ELSE c.home_team END AS team_b,
    CASE WHEN lower(c.home_team) <= lower(c.away_team) THEN c.home_score ELSE c.away_score END AS team_a_goals,
    CASE WHEN lower(c.home_team) <= lower(c.away_team) THEN c.away_score ELSE c.home_score END AS team_b_goals
  FROM completed c
),
ranked AS (
  SELECT
    c.*,
    ROW_NUMBER() OVER (
      PARTITION BY c.league_id, c.team_a, c.team_b
      ORDER BY c.start_time DESC, c.id DESC
    ) AS rn
  FROM canon c
)
SELECT
  r.team_a,
  r.team_b,
  r.league_id,
  COUNT(*)::int AS meetings,
  SUM(CASE WHEN r.team_a_goals > r.team_b_goals THEN 1 ELSE 0 END)::int AS team_a_wins,
  SUM(CASE WHEN r.team_a_goals = r.team_b_goals THEN 1 ELSE 0 END)::int AS draws,
  SUM(CASE WHEN r.team_a_goals < r.team_b_goals THEN 1 ELSE 0 END)::int AS team_b_wins,
  ROUND(AVG((r.team_a_goals + r.team_b_goals)::numeric), 3) AS avg_total_goals,
  SUM(CASE WHEN r.team_a_goals >= 1 AND r.team_b_goals >= 1 THEN 1 ELSE 0 END)::int AS btts_count,
  MAX(r.start_time) AS last_meeting_date,
  MAX(CASE WHEN r.rn = 1 THEN CONCAT(r.team_a_goals, '-', r.team_b_goals) END) AS last_score
FROM ranked r
GROUP BY r.team_a, r.team_b, r.league_id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_h2h_summary_pair_league_uidx
  ON public.mv_h2h_summary (team_a, team_b, league_id);


-- Refresh helper
CREATE OR REPLACE FUNCTION public.refresh_ai_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_league_structural_profiles;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_team_rolling_form;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_h2h_summary;
END;
$$;

-- Optional automation: refresh every 30 minutes
DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR r IN
      SELECT jobid
      FROM cron.job
      WHERE jobname = 'refresh-ai-views-30m'
    LOOP
      PERFORM cron.unschedule(r.jobid);
    END LOOP;

    PERFORM cron.schedule(
      'refresh-ai-views-30m',
      '*/30 * * * *',
      $cmd$select public.refresh_ai_views();$cmd$
    );
  END IF;
END
$$;
