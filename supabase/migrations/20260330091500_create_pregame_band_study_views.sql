-- Pregame market-structure band study (pregame-only, no live odds).
-- ZONES: DATA/ID (Amazon+Google) + OPS (SRE+Amazon)

CREATE OR REPLACE FUNCTION public.american_payout_units(odds numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN odds IS NULL OR odds = 0 THEN NULL
    WHEN odds < 0 THEN 100.0 / ABS(odds)
    ELSE odds / 100.0
  END;
$$;
CREATE OR REPLACE FUNCTION public.classify_favorite_ml_band(ml numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN ml IS NULL THEN NULL
    WHEN ml BETWEEN -130 AND -101 THEN '-101 to -130'
    WHEN ml BETWEEN -159 AND -131 THEN '-131 to -159'
    WHEN ml BETWEEN -199 AND -160 THEN '-160 to -199'
    WHEN ml BETWEEN -249 AND -200 THEN '-200 to -249'
    WHEN ml <= -250 THEN '-250+'
    ELSE 'other'
  END;
$$;
CREATE OR REPLACE FUNCTION public.classify_dog_ml_band(ml numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN ml IS NULL THEN NULL
    WHEN ml BETWEEN 100 AND 129 THEN '+100 to +129'
    WHEN ml BETWEEN 130 AND 159 THEN '+130 to +159'
    WHEN ml BETWEEN 160 AND 199 THEN '+160 to +199'
    WHEN ml >= 200 THEN '+200+'
    ELSE 'other'
  END;
$$;
CREATE OR REPLACE FUNCTION public.classify_spread_band(abs_spread numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN abs_spread IS NULL THEN NULL
    WHEN ROUND(abs_spread, 1) = 1.5 THEN '1.5'
    WHEN ROUND(abs_spread, 1) = 2.5 THEN '2.5'
    WHEN ROUND(abs_spread, 1) = 3.5 THEN '3.5'
    WHEN abs_spread BETWEEN 4.5 AND 5.5 THEN '4.5-5.5'
    WHEN abs_spread BETWEEN 6.5 AND 7.5 THEN '6.5-7.5'
    WHEN abs_spread BETWEEN 8.5 AND 10.5 THEN '8.5-10.5'
    WHEN abs_spread >= 11 THEN '11+'
    ELSE 'other'
  END;
$$;
DROP VIEW IF EXISTS public.vw_nba_pregame_band_study;
DROP VIEW IF EXISTS public.vw_nhl_pregame_band_study;
DROP VIEW IF EXISTS public.vw_mlb_pregame_band_study;
DROP VIEW IF EXISTS public.vw_soccer_pregame_band_study;
DROP VIEW IF EXISTS public.vw_pregame_band_study_all;
CREATE VIEW public.vw_pregame_band_study_all AS
WITH source_rows AS (
  SELECT
    'nba'::text AS sport,
    n.id AS match_id,
    n.start_time,
    n.home_team,
    n.away_team,
    n.home_score::numeric AS home_score,
    n.away_score::numeric AS away_score,
    n.dk_home_ml::numeric AS home_ml,
    n.dk_away_ml::numeric AS away_ml,
    n.dk_spread::numeric AS home_spread,
    n.dk_total::numeric AS total,
    n.dk_home_spread_price::numeric AS home_spread_price,
    n.dk_away_spread_price::numeric AS away_spread_price,
    n.match_status
  FROM public.nba_postgame n
  WHERE n.id LIKE '%_nba'
    AND n.start_time IS NOT NULL
    AND n.home_score IS NOT NULL
    AND n.away_score IS NOT NULL
    AND (
      UPPER(COALESCE(n.match_status, '')) LIKE '%FINAL%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%FULL_TIME%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%AET%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%PEN%'
    )

  UNION ALL

  SELECT
    'nhl'::text AS sport,
    n.id AS match_id,
    n.start_time,
    n.home_team,
    n.away_team,
    n.home_score::numeric AS home_score,
    n.away_score::numeric AS away_score,
    n.dk_home_ml::numeric AS home_ml,
    n.dk_away_ml::numeric AS away_ml,
    n.dk_spread::numeric AS home_spread,
    n.dk_total::numeric AS total,
    NULL::numeric AS home_spread_price,
    NULL::numeric AS away_spread_price,
    n.match_status
  FROM public.nhl_postgame n
  WHERE n.id LIKE '%_nhl'
    AND n.start_time IS NOT NULL
    AND n.home_score IS NOT NULL
    AND n.away_score IS NOT NULL
    AND (
      UPPER(COALESCE(n.match_status, '')) LIKE '%FINAL%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%FULL_TIME%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%AET%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%PEN%'
    )

  UNION ALL

  SELECT
    'mlb'::text AS sport,
    n.id AS match_id,
    n.start_time,
    n.home_team,
    n.away_team,
    n.home_score::numeric AS home_score,
    n.away_score::numeric AS away_score,
    n.dk_home_ml::numeric AS home_ml,
    n.dk_away_ml::numeric AS away_ml,
    n.dk_spread::numeric AS home_spread,
    n.dk_total::numeric AS total,
    NULL::numeric AS home_spread_price,
    NULL::numeric AS away_spread_price,
    n.match_status
  FROM public.mlb_postgame n
  WHERE n.id LIKE '%_mlb'
    AND n.start_time IS NOT NULL
    AND n.home_score IS NOT NULL
    AND n.away_score IS NOT NULL
    AND (
      UPPER(COALESCE(n.match_status, '')) LIKE '%FINAL%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%FULL_TIME%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%AET%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%PEN%'
    )

  UNION ALL

  SELECT
    'soccer'::text AS sport,
    n.id AS match_id,
    n.start_time,
    n.home_team,
    n.away_team,
    n.home_score::numeric AS home_score,
    n.away_score::numeric AS away_score,
    n.dk_home_ml::numeric AS home_ml,
    n.dk_away_ml::numeric AS away_ml,
    n.dk_spread::numeric AS home_spread,
    n.dk_total::numeric AS total,
    n.dk_home_spread_price::numeric AS home_spread_price,
    n.dk_away_spread_price::numeric AS away_spread_price,
    n.match_status
  FROM public.soccer_postgame n
  WHERE n.start_time IS NOT NULL
    AND n.home_score IS NOT NULL
    AND n.away_score IS NOT NULL
    AND (
      UPPER(COALESCE(n.match_status, '')) LIKE '%FINAL%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%FULL_TIME%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%AET%'
      OR UPPER(COALESCE(n.match_status, '')) LIKE '%PEN%'
    )
), implied AS (
  SELECT
    s.*,
    CASE
      WHEN s.home_ml < 0 THEN ABS(s.home_ml) / (ABS(s.home_ml) + 100.0)
      WHEN s.home_ml > 0 THEN 100.0 / (s.home_ml + 100.0)
      ELSE NULL
    END AS home_implied_prob,
    CASE
      WHEN s.away_ml < 0 THEN ABS(s.away_ml) / (ABS(s.away_ml) + 100.0)
      WHEN s.away_ml > 0 THEN 100.0 / (s.away_ml + 100.0)
      ELSE NULL
    END AS away_implied_prob
  FROM source_rows s
  WHERE s.home_ml IS NOT NULL
    AND s.away_ml IS NOT NULL
), favored AS (
  SELECT
    i.*,
    CASE
      WHEN i.home_implied_prob > i.away_implied_prob THEN 'home'
      WHEN i.away_implied_prob > i.home_implied_prob THEN 'away'
      WHEN i.home_ml < i.away_ml THEN 'home'
      WHEN i.away_ml < i.home_ml THEN 'away'
      WHEN i.home_ml = i.away_ml THEN 'home'
      ELSE NULL
    END AS favorite_side
  FROM implied i
), enriched AS (
  SELECT
    f.*,
    CASE WHEN f.favorite_side = 'home' THEN f.home_ml ELSE f.away_ml END AS favorite_ml,
    CASE WHEN f.favorite_side = 'home' THEN f.away_ml ELSE f.home_ml END AS underdog_ml,
    CASE WHEN f.favorite_side = 'home' THEN 'home' ELSE 'road' END AS favorite_location,
    CASE WHEN f.favorite_side = 'home' THEN 'road' ELSE 'home' END AS dog_location,
    CASE
      WHEN f.home_spread IS NULL THEN NULL
      WHEN f.favorite_side = 'home' THEN f.home_spread
      ELSE -f.home_spread
    END AS favorite_spread,
    CASE
      WHEN f.favorite_side = 'home' THEN (f.home_score - f.away_score)
      ELSE (f.away_score - f.home_score)
    END AS favorite_margin,
    CASE
      WHEN f.favorite_side = 'home' THEN f.home_spread_price
      ELSE f.away_spread_price
    END AS favorite_ats_price
  FROM favored f
  WHERE f.favorite_side IS NOT NULL
)
SELECT
  e.sport,
  e.match_id,
  e.start_time,
  CASE
    WHEN e.sport = 'mlb' THEN TO_CHAR(e.start_time, 'YYYY')
    WHEN EXTRACT(MONTH FROM e.start_time) >= 7
      THEN CONCAT(EXTRACT(YEAR FROM e.start_time)::int, '-', RIGHT((EXTRACT(YEAR FROM e.start_time)::int + 1)::text, 2))
    ELSE CONCAT((EXTRACT(YEAR FROM e.start_time)::int - 1), '-', RIGHT(EXTRACT(YEAR FROM e.start_time)::int::text, 2))
  END AS season_tag,
  e.home_team,
  e.away_team,
  e.home_ml,
  e.away_ml,
  e.home_spread AS spread,
  e.total,
  e.favorite_side,
  e.favorite_ml,
  e.underdog_ml,
  public.classify_favorite_ml_band(e.favorite_ml) AS favorite_ml_band,
  public.classify_dog_ml_band(e.underdog_ml) AS dog_ml_band,
  e.favorite_spread,
  public.classify_spread_band(ABS(e.favorite_spread)) AS favorite_spread_band,
  e.favorite_location,
  e.dog_location,
  e.favorite_margin AS final_margin,
  (e.favorite_margin > 0) AS favorite_won_su,
  CASE
    WHEN e.favorite_spread IS NULL THEN NULL
    WHEN ABS(e.favorite_margin + e.favorite_spread) < 1e-9 THEN NULL
    ELSE (e.favorite_margin + e.favorite_spread) > 0
  END AS favorite_covered_ats,
  CASE
    WHEN e.favorite_spread IS NULL THEN NULL
    ELSE ABS(e.favorite_margin + e.favorite_spread) < 1e-9
  END AS favorite_ats_push,
  CASE
    WHEN e.favorite_margin > 0 THEN public.american_payout_units(e.favorite_ml)
    ELSE -1::numeric
  END AS favorite_ml_unit_pl,
  e.favorite_ats_price,
  CASE
    WHEN e.favorite_spread IS NULL OR e.favorite_ats_price IS NULL THEN NULL
    WHEN ABS(e.favorite_margin + e.favorite_spread) < 1e-9 THEN 0::numeric
    WHEN (e.favorite_margin + e.favorite_spread) > 0 THEN public.american_payout_units(e.favorite_ats_price)
    ELSE -1::numeric
  END AS favorite_ats_unit_pl
FROM enriched e;
CREATE VIEW public.vw_nba_pregame_band_study AS
SELECT *
FROM public.vw_pregame_band_study_all
WHERE sport = 'nba';
CREATE VIEW public.vw_nhl_pregame_band_study AS
SELECT *
FROM public.vw_pregame_band_study_all
WHERE sport = 'nhl';
CREATE VIEW public.vw_mlb_pregame_band_study AS
SELECT *
FROM public.vw_pregame_band_study_all
WHERE sport = 'mlb';
CREATE VIEW public.vw_soccer_pregame_band_study AS
SELECT *
FROM public.vw_pregame_band_study_all
WHERE sport = 'soccer';
GRANT SELECT ON public.vw_pregame_band_study_all TO anon, authenticated;
GRANT SELECT ON public.vw_nba_pregame_band_study TO anon, authenticated;
GRANT SELECT ON public.vw_nhl_pregame_band_study TO anon, authenticated;
GRANT SELECT ON public.vw_mlb_pregame_band_study TO anon, authenticated;
GRANT SELECT ON public.vw_soccer_pregame_band_study TO anon, authenticated;
