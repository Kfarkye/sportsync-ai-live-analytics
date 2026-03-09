-- ============================================================================
-- Phase 1 NCAAB ATS performance stabilization
--  - Materialize NCAAB ATS coalesced spread stats
--  - Make get_all_trends read from MV (fast path)
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS public.mv_ncaab_ats_trends;

CREATE MATERIALIZED VIEW public.mv_ncaab_ats_trends AS
WITH raw_games AS (
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
)
SELECT
  b.entity,
  round(avg(b.dog_cover_flag)::numeric * 100.0, 1) AS hit_rate,
  count(*)::integer AS sample,
  now()::timestamptz AS refreshed_at
FROM bucketed b
WHERE b.entity IS NOT NULL
GROUP BY b.entity;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_ncaab_ats_trends_entity
  ON public.mv_ncaab_ats_trends (entity);

CREATE OR REPLACE FUNCTION public.refresh_ncaab_ats_trends()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ncaab_ats_trends;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_ncaab_ats_trends() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_ncaab_ats_trends() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-ncaab-ats-trends-30m') THEN
    PERFORM cron.unschedule('refresh-ncaab-ats-trends-30m');
  END IF;
END;
$$;

SELECT cron.schedule('refresh-ncaab-ats-trends-30m', '*/30 * * * *', $$SELECT public.refresh_ncaab_ats_trends()$$);

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
  WHERE b.layer <> 'NCAAB_ATS'
),
ncaab AS (
  SELECT
    'NCAAB_ATS'::text AS layer,
    'ncaab'::text AS league,
    m.entity,
    'DOG ATS'::text AS trend,
    m.hit_rate,
    m.sample,
    'PROPRIETARY'::text AS visibility,
    '2025-26 season'::text AS data_window,
    'rate'::text AS metric_type
  FROM public.mv_ncaab_ats_trends m
  WHERE m.sample >= 40
    AND m.hit_rate >= (SELECT min_rate_pct FROM params)
)
SELECT * FROM base
UNION ALL
SELECT * FROM ncaab;
$$;

REVOKE ALL ON FUNCTION public.get_all_trends(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_trends(numeric) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_all_trends(numeric)
IS 'Trend scanner fast path: legacy layers + materialized NCAAB ATS (opening/current coalesced), 40+ sample floor, min_rate scale compatibility.';
