-- ============================================================================
-- Phase 1 Perf Hotfix
--  - Keeps Phase 1 semantics while reducing RPC latency under PostgREST timeout.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_matches_ncaab_final_status
  ON public.matches (league_id, status, start_time)
  WHERE league_id IN ('mens-college-basketball', 'ncaab')
    AND status = 'STATUS_FINAL'
    AND home_score > 0
    AND away_score > 0;

CREATE OR REPLACE FUNCTION public.get_all_trends(min_rate numeric DEFAULT 53)
RETURNS TABLE(
  layer text,
  league text,
  entity text,
  trend text,
  hit_rate numeric,
  sample integer,
  visibility text,
  data_window text,
  metric_type text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
WITH params AS (
  SELECT
    CASE
      WHEN min_rate IS NULL THEN 53::numeric
      WHEN min_rate <= 1 THEN round(min_rate * 100.0, 4)
      ELSE min_rate
    END AS min_rate_pct
),
base AS (
  SELECT
    b.layer,
    b.league,
    b.entity,
    b.trend,
    b.hit_rate,
    b.sample,
    b.visibility,
    b.data_window,
    b.metric_type
  FROM public.get_all_trends__legacy((SELECT min_rate_pct FROM params)) b
),
raw_games AS (
  SELECT
    m.home_score,
    m.away_score,
    COALESCE(
      public._phase0_to_numeric(m.opening_odds ->> 'homeSpread'),
      public._phase0_to_numeric(m.current_odds ->> 'homeSpread'),
      CASE WHEN m.opening_odds ? 'awaySpread' THEN -public._phase0_to_numeric(m.opening_odds ->> 'awaySpread') END,
      CASE WHEN m.current_odds ? 'awaySpread' THEN -public._phase0_to_numeric(m.current_odds ->> 'awaySpread') END
    ) AS home_spread
  FROM public.matches m
  WHERE m.league_id IN ('mens-college-basketball', 'ncaab')
    AND m.status = 'STATUS_FINAL'
    AND m.home_score > 0
    AND m.away_score > 0
    AND (
      m.opening_odds ? 'homeSpread'
      OR m.current_odds ? 'homeSpread'
      OR m.opening_odds ? 'awaySpread'
      OR m.current_odds ? 'awaySpread'
    )
),
scored AS (
  SELECT
    CASE
      WHEN rg.home_spread > 0 THEN rg.home_spread
      WHEN rg.home_spread < 0 THEN -rg.home_spread
      ELSE NULL
    END AS dog_line,
    CASE
      WHEN rg.home_spread > 0 THEN CASE WHEN (rg.home_score + rg.home_spread) > rg.away_score THEN 1 ELSE 0 END
      WHEN rg.home_spread < 0 THEN CASE WHEN (rg.away_score - rg.home_spread) > rg.home_score THEN 1 ELSE 0 END
      ELSE NULL
    END AS dog_cover_flag
  FROM raw_games rg
  WHERE rg.home_spread IS NOT NULL
    AND rg.home_spread <> 0
),
bucketed AS (
  SELECT
    CASE
      WHEN dog_line >= 0 AND dog_line < 5 THEN 'Dog +0-5'
      WHEN dog_line >= 5 AND dog_line < 10 THEN 'Dog +5-10'
      WHEN dog_line >= 10 AND dog_line < 15 THEN 'Dog +10-15'
      WHEN dog_line >= 15 THEN 'Dog +15+'
      ELSE NULL
    END AS entity,
    dog_cover_flag
  FROM scored
),
ncaab_ats AS (
  SELECT
    'NCAAB_ATS'::text AS layer,
    'ncaab'::text AS league,
    b.entity,
    'DOG ATS'::text AS trend,
    round(avg(b.dog_cover_flag)::numeric * 100.0, 1) AS hit_rate,
    count(*)::integer AS sample,
    'PROPRIETARY'::text AS visibility,
    '2025-26 season'::text AS data_window,
    'rate'::text AS metric_type
  FROM bucketed b
  WHERE b.entity IS NOT NULL
  GROUP BY b.entity
  HAVING count(*) >= 40
     AND (avg(b.dog_cover_flag)::numeric * 100.0) >= (SELECT min_rate_pct FROM params)
)
SELECT *
FROM base
WHERE layer <> 'NCAAB_ATS'
UNION ALL
SELECT *
FROM ncaab_ats;
$$;

CREATE OR REPLACE FUNCTION public.get_daily_picks(p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  match_id text,
  home_team text,
  away_team text,
  league_id text,
  start_time timestamptz,
  play text,
  home_rate numeric,
  home_sample int,
  away_rate numeric,
  away_sample int,
  avg_rate numeric,
  pick_type text,
  last_refreshed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH mv_refresh AS (
  SELECT COALESCE(max(d.end_time), now()) AS last_refreshed_at
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE d.status = 'succeeded'
    AND (
      j.jobid = 149
      OR j.jobname ILIKE '%refresh%view%'
      OR j.command ILIKE '%refresh materialized view%'
      OR j.command ILIKE '%refresh_research_views%'
    )
),
today_matches AS (
  SELECT
    m.id,
    m.home_team,
    m.away_team,
    m.league_id,
    m.start_time,
    COALESCE(
      public._phase0_to_numeric(m.opening_odds ->> 'homeSpread'),
      public._phase0_to_numeric(m.current_odds ->> 'homeSpread'),
      CASE WHEN m.opening_odds ? 'awaySpread' THEN -public._phase0_to_numeric(m.opening_odds ->> 'awaySpread') END,
      CASE WHEN m.current_odds ? 'awaySpread' THEN -public._phase0_to_numeric(m.current_odds ->> 'awaySpread') END
    ) AS home_spread_coalesced,
    COALESCE(
      public._phase0_to_numeric(m.opening_odds ->> 'total'),
      public._phase0_to_numeric(m.opening_odds ->> 'overUnder'),
      public._phase0_to_numeric(m.current_odds ->> 'total'),
      public._phase0_to_numeric(m.current_odds ->> 'overUnder')
    ) AS total_coalesced
  FROM public.matches m
  WHERE m.start_time::date = p_date
    AND m.status NOT IN ('STATUS_FINAL','STATUS_CANCELED','STATUS_POSTPONED')
),
league_map(match_lid, trend_lid) AS (
  VALUES
    ('eng.1','eng.1'),('esp.1','esp.1'),('ita.1','ita.1'),
    ('ger.1','ger.1'),('fra.1','fra.1'),('usa.1','usa.1'),
    ('nba','nba'),('nhl','nhl'),('mlb','mlb'),
    ('mens-college-basketball','mens-college-basketball'),('ncaab','ncaab'),
    ('uefa.champions','uefa.champions'),('uefa.europa','uefa.europa'),
    ('eng.1','epl'),('esp.1','laliga'),('ita.1','seriea'),
    ('ger.1','bundesliga'),('fra.1','ligue1'),('usa.1','mls'),
    ('uefa.champions','ucl'),('uefa.europa','uel')
),
trends AS (
  SELECT * FROM public.get_all_trends(55) WHERE metric_type = 'rate' AND layer = 'TEAM'
),
convergence AS (
  SELECT m.id as mid, m.home_team as ht, m.away_team as at, m.league_id as lid, m.start_time as st,
    CASE h.trend
      WHEN 'OVER 2.5' THEN 'Over 2.5 Goals'
      WHEN 'UNDER 2.5' THEN 'Under 2.5 Goals'
      WHEN 'BTTS YES' THEN 'Both Teams to Score'
      WHEN 'BTTS NO' THEN 'Clean Sheet Expected'
    END::text as pl,
    h.hit_rate::numeric as hr, h.sample as hs,
    a.hit_rate::numeric as ar, a.sample as asamp,
    ROUND((h.hit_rate::numeric + a.hit_rate::numeric) / 2, 1) as avgr,
    'convergence'::text as pt
  FROM today_matches m
  JOIN league_map lm ON lm.match_lid = m.league_id
  JOIN trends h ON h.entity = m.home_team AND h.league = lm.trend_lid
    AND h.trend IN ('OVER 2.5','UNDER 2.5','BTTS YES','BTTS NO')
    AND h.hit_rate::numeric >= 60
  JOIN trends a ON a.entity = m.away_team AND a.league = lm.trend_lid
    AND a.trend = h.trend AND a.hit_rate::numeric >= 60
),
onesided AS (
  SELECT m.id, m.home_team, m.away_team, m.league_id, m.start_time,
    CASE t.trend
      WHEN 'OVER 2.5' THEN 'Over 2.5 Goals'
      WHEN 'UNDER 2.5' THEN 'Under 2.5 Goals'
      WHEN 'BTTS YES' THEN 'Both Teams to Score'
      WHEN 'BTTS NO' THEN 'Clean Sheet Expected'
    END::text,
    t.hit_rate::numeric, t.sample,
    CASE t.trend
      WHEN 'BTTS YES' THEN ROUND(opp.btts_count::numeric / NULLIF(opp.matches,0) * 100, 1)
      WHEN 'OVER 2.5' THEN ROUND(opp.over_25_count::numeric / NULLIF(opp.matches,0) * 100, 1)
      WHEN 'UNDER 2.5' THEN ROUND((opp.matches - opp.over_25_count)::numeric / NULLIF(opp.matches,0) * 100, 1)
      WHEN 'BTTS NO' THEN ROUND((opp.matches - opp.btts_count)::numeric / NULLIF(opp.matches,0) * 100, 1)
    END::numeric,
    opp.matches::int,
    ROUND(
      (t.hit_rate::numeric + COALESCE(
        CASE t.trend
          WHEN 'BTTS YES' THEN opp.btts_count::numeric / NULLIF(opp.matches,0) * 100
          WHEN 'OVER 2.5' THEN opp.over_25_count::numeric / NULLIF(opp.matches,0) * 100
          WHEN 'UNDER 2.5' THEN (opp.matches - opp.over_25_count)::numeric / NULLIF(opp.matches,0) * 100
          WHEN 'BTTS NO' THEN (opp.matches - opp.btts_count)::numeric / NULLIF(opp.matches,0) * 100
        END, 50
      )) / 2, 1
    ),
    'one-sided'::text
  FROM today_matches m
  JOIN league_map lm ON lm.match_lid = m.league_id
  JOIN trends t ON (t.entity = m.home_team OR t.entity = m.away_team)
    AND t.league = lm.trend_lid
    AND t.hit_rate::numeric >= 85
    AND t.trend IN ('OVER 2.5','UNDER 2.5','BTTS YES','BTTS NO')
  LEFT JOIN public.mv_team_rolling_form opp ON opp.team_name =
    CASE WHEN t.entity = m.home_team THEN m.away_team ELSE m.home_team END
    AND opp.league_id = lm.trend_lid
  WHERE COALESCE(
    CASE t.trend
      WHEN 'BTTS YES' THEN opp.btts_count::numeric / NULLIF(opp.matches,0) * 100
      WHEN 'OVER 2.5' THEN opp.over_25_count::numeric / NULLIF(opp.matches,0) * 100
      WHEN 'UNDER 2.5' THEN (opp.matches - opp.over_25_count)::numeric / NULLIF(opp.matches,0) * 100
      WHEN 'BTTS NO' THEN (opp.matches - opp.btts_count)::numeric / NULLIF(opp.matches,0) * 100
    END, 50
  ) >= 40
),
nba_unders AS (
  SELECT m.id, m.home_team, m.away_team, m.league_id, m.start_time,
    ('Under ' || COALESCE(m.total_coalesced::text, '?'))::text,
    t.hit_rate::numeric, t.sample, NULL::numeric, NULL::int,
    t.hit_rate::numeric, 'structural'::text
  FROM today_matches m
  CROSS JOIN public.get_all_trends(60) t
  WHERE m.league_id = 'nba' AND t.layer = 'NBA_SPREAD' AND t.hit_rate::numeric >= 60
    AND m.home_spread_coalesced IS NOT NULL
    AND t.entity = CASE
      WHEN ABS(m.home_spread_coalesced) >= 10 THEN 'Big fav (10+)'
      WHEN ABS(m.home_spread_coalesced) >= 6 THEN 'Solid fav (6-10)'
      WHEN ABS(m.home_spread_coalesced) >= 3 THEN 'Small fav (3-6)'
      ELSE 'Pick-em (<3)' END
),
ncaab_dogs AS (
  SELECT m.id, m.home_team, m.away_team, m.league_id, m.start_time,
    (CASE WHEN m.home_spread_coalesced > 0 THEN m.home_team ELSE m.away_team END
     || ' +' || ABS(m.home_spread_coalesced)::text)::text,
    t.hit_rate::numeric, t.sample, NULL::numeric, NULL::int,
    t.hit_rate::numeric, 'structural'::text
  FROM today_matches m
  CROSS JOIN public.get_all_trends(53) t
  WHERE m.league_id IN ('mens-college-basketball','ncaab')
    AND t.layer = 'NCAAB_ATS' AND t.hit_rate::numeric >= 65
    AND m.home_spread_coalesced IS NOT NULL
    AND ABS(m.home_spread_coalesced) >= 10
    AND t.entity = CASE
      WHEN ABS(m.home_spread_coalesced) >= 15 THEN 'Dog +15+'
      WHEN ABS(m.home_spread_coalesced) >= 10 THEN 'Dog +10-15' END
)
SELECT DISTINCT ON (mid, pl)
  mid, ht, at, lid, st, pl, hr, hs, ar, asamp, avgr, pt,
  (SELECT last_refreshed_at FROM mv_refresh) AS last_refreshed_at
FROM (
  SELECT * FROM convergence
  UNION ALL SELECT * FROM onesided
  UNION ALL SELECT * FROM nba_unders
  UNION ALL SELECT * FROM ncaab_dogs
) all_picks
ORDER BY mid, pl, avgr DESC;
$$;

COMMENT ON FUNCTION public.get_all_trends(numeric)
IS 'Trend scanner (Phase 1 hotfix): normalized min_rate scale, NCAAB ATS from opening/current coalesce, 40+ sample floor, performance-safe spread extraction.';

COMMENT ON FUNCTION public.get_daily_picks(date)
IS 'Daily picks feed with league-safe joins, contradiction filter, coalesced NCAAB spread handling, and MV freshness marker (last_refreshed_at).';
