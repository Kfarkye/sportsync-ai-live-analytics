-- Band Intelligence V1
-- Self-updating structural market map views for pregame + live entry studies.
-- Sports in-scope for v1 UI: NBA, NHL.

-- -----------------------------------------------------------------------------
-- Helper functions (deterministic, no table access)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.band_profit_units(odds numeric, won boolean)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN odds IS NULL OR odds = 0 THEN NULL
    WHEN won THEN
      CASE
        WHEN odds > 0 THEN ROUND(odds / 100.0, 6)
        ELSE ROUND(100.0 / ABS(odds), 6)
      END
    ELSE -1.0
  END;
$$;

CREATE OR REPLACE FUNCTION public.classify_favorite_ml_band(odds numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN odds IS NULL THEN 'Unknown'
    WHEN odds BETWEEN -130 AND -101 THEN '-101 to -130'
    WHEN odds BETWEEN -159 AND -131 THEN '-131 to -159'
    WHEN odds BETWEEN -199 AND -160 THEN '-160 to -199'
    WHEN odds BETWEEN -249 AND -200 THEN '-200 to -249'
    WHEN odds <= -250 THEN '-250+'
    ELSE 'Other favorite'
  END;
$$;

CREATE OR REPLACE FUNCTION public.classify_dog_ml_band(odds numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN odds IS NULL THEN 'Unknown'
    WHEN odds BETWEEN 100 AND 129 THEN '+100 to +129'
    WHEN odds BETWEEN 130 AND 159 THEN '+130 to +159'
    WHEN odds BETWEEN 160 AND 199 THEN '+160 to +199'
    WHEN odds >= 200 THEN '+200+'
    ELSE 'Other dog'
  END;
$$;

CREATE OR REPLACE FUNCTION public.classify_spread_band(spread_abs numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN spread_abs IS NULL THEN 'Unknown'
    WHEN ABS(spread_abs - 1.5) < 0.001 THEN '1.5'
    WHEN ABS(spread_abs - 2.5) < 0.001 THEN '2.5'
    WHEN ABS(spread_abs - 3.5) < 0.001 THEN '3.5'
    WHEN spread_abs BETWEEN 4.5 AND 5.5 THEN '4.5-5.5'
    WHEN spread_abs BETWEEN 6.5 AND 7.5 THEN '6.5-7.5'
    WHEN spread_abs BETWEEN 8.5 AND 10.5 THEN '8.5-10.5'
    WHEN spread_abs >= 11 THEN '11+'
    ELSE 'Other'
  END;
$$;

-- -----------------------------------------------------------------------------
-- Canonical pregame game facts
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.vw_band_game_facts CASCADE;
CREATE OR REPLACE VIEW public.vw_band_game_facts AS
WITH base AS (
  SELECT
    'nba'::text AS sport,
    np.id AS match_id,
    np.start_time,
    np.home_team,
    np.away_team,
    np.home_score::numeric AS home_score,
    np.away_score::numeric AS away_score,
    np.dk_home_ml::numeric AS home_ml,
    np.dk_away_ml::numeric AS away_ml,
    np.dk_spread::numeric AS home_spread,
    np.dk_home_spread_price::numeric AS home_spread_price,
    np.dk_away_spread_price::numeric AS away_spread_price,
    np.dk_total::numeric AS total_line,
    np.dk_over_price::numeric AS over_price,
    np.dk_under_price::numeric AS under_price
  FROM public.nba_postgame np
  WHERE np.home_score IS NOT NULL
    AND np.away_score IS NOT NULL
    AND np.dk_home_ml IS NOT NULL
    AND np.dk_away_ml IS NOT NULL

  UNION ALL

  SELECT
    'nhl'::text AS sport,
    np.id AS match_id,
    np.start_time,
    np.home_team,
    np.away_team,
    np.home_score::numeric AS home_score,
    np.away_score::numeric AS away_score,
    np.dk_home_ml::numeric AS home_ml,
    np.dk_away_ml::numeric AS away_ml,
    np.dk_spread::numeric AS home_spread,
    NULL::numeric AS home_spread_price,
    NULL::numeric AS away_spread_price,
    np.dk_total::numeric AS total_line,
    np.dk_over_price::numeric AS over_price,
    np.dk_under_price::numeric AS under_price
  FROM public.nhl_postgame np
  WHERE np.home_score IS NOT NULL
    AND np.away_score IS NOT NULL
    AND np.dk_home_ml IS NOT NULL
    AND np.dk_away_ml IS NOT NULL
),
normalized AS (
  SELECT
    b.*,
    (b.home_ml <= b.away_ml) AS favorite_is_home,
    LEAST(b.home_ml, b.away_ml) AS favorite_ml,
    GREATEST(b.home_ml, b.away_ml) AS dog_ml,
    CASE WHEN b.home_ml <= b.away_ml THEN 'home' ELSE 'road' END AS favorite_location,
    CASE WHEN b.home_ml <= b.away_ml THEN b.home_team ELSE b.away_team END AS favorite_team,
    CASE WHEN b.home_ml <= b.away_ml THEN b.away_team ELSE b.home_team END AS dog_team,
    CASE WHEN b.home_ml <= b.away_ml THEN b.home_score ELSE b.away_score END AS favorite_score,
    CASE WHEN b.home_ml <= b.away_ml THEN b.away_score ELSE b.home_score END AS dog_score,
    CASE WHEN b.home_ml <= b.away_ml THEN b.home_spread ELSE -b.home_spread END AS favorite_spread,
    CASE WHEN b.home_ml <= b.away_ml THEN b.home_spread_price ELSE b.away_spread_price END AS favorite_spread_price
  FROM base b
)
SELECT
  n.sport,
  'pregame'::text AS study_type,
  n.match_id,
  n.start_time,
  n.home_team,
  n.away_team,
  n.home_score,
  n.away_score,
  n.home_ml,
  n.away_ml,
  n.home_spread,
  n.total_line,
  n.over_price,
  n.under_price,
  n.favorite_location,
  n.favorite_team,
  n.dog_team,
  n.favorite_ml,
  n.dog_ml,
  n.favorite_spread,
  public.classify_favorite_ml_band(n.favorite_ml) AS favorite_ml_band,
  public.classify_dog_ml_band(n.dog_ml) AS dog_ml_band,
  public.classify_spread_band(ABS(n.favorite_spread)) AS favorite_spread_band,
  (n.favorite_score - n.dog_score) AS favorite_margin,
  CASE WHEN n.favorite_score > n.dog_score THEN true ELSE false END AS favorite_won_su,
  CASE WHEN n.favorite_score > n.dog_score THEN false ELSE true END AS dog_won_su,
  CASE WHEN n.favorite_score > n.dog_score THEN 'W' ELSE 'L' END AS favorite_su_result,
  CASE WHEN n.favorite_score > n.dog_score THEN 'L' ELSE 'W' END AS dog_su_result,
  public.band_profit_units(n.favorite_ml, n.favorite_score > n.dog_score) AS favorite_su_profit_units,
  public.band_profit_units(n.dog_ml, n.dog_score > n.favorite_score) AS dog_su_profit_units,
  CASE
    WHEN n.favorite_spread IS NULL THEN NULL
    WHEN (n.favorite_score - n.dog_score) + n.favorite_spread > 0 THEN 'W'
    WHEN (n.favorite_score - n.dog_score) + n.favorite_spread < 0 THEN 'L'
    ELSE 'P'
  END AS favorite_ats_result,
  CASE
    WHEN n.favorite_spread IS NULL THEN NULL
    WHEN (n.favorite_score - n.dog_score) + n.favorite_spread > 0 THEN true
    WHEN (n.favorite_score - n.dog_score) + n.favorite_spread < 0 THEN false
    ELSE NULL
  END AS favorite_covered_ats,
  CASE
    WHEN n.favorite_spread IS NULL OR n.favorite_spread_price IS NULL THEN NULL
    WHEN (n.favorite_score - n.dog_score) + n.favorite_spread > 0
      THEN public.band_profit_units(n.favorite_spread_price, true)
    WHEN (n.favorite_score - n.dog_score) + n.favorite_spread < 0
      THEN public.band_profit_units(n.favorite_spread_price, false)
    ELSE 0.0
  END AS favorite_ats_profit_units,
  n.favorite_spread_price
FROM normalized n;

GRANT SELECT ON public.vw_band_game_facts TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Pregame band map (supports all/home/road filters without client recompute)
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.vw_pregame_band_map CASCADE;
CREATE OR REPLACE VIEW public.vw_pregame_band_map AS
WITH scoped AS (
  SELECT sport, 'all'::text AS location_scope, favorite_ml_band AS band, start_time,
         favorite_won_su, favorite_su_profit_units,
         favorite_ats_result, favorite_ats_profit_units,
         favorite_location
  FROM public.vw_band_game_facts

  UNION ALL

  SELECT sport, 'home'::text AS location_scope, favorite_ml_band AS band, start_time,
         favorite_won_su, favorite_su_profit_units,
         favorite_ats_result, favorite_ats_profit_units,
         favorite_location
  FROM public.vw_band_game_facts
  WHERE favorite_location = 'home'

  UNION ALL

  SELECT sport, 'road'::text AS location_scope, favorite_ml_band AS band, start_time,
         favorite_won_su, favorite_su_profit_units,
         favorite_ats_result, favorite_ats_profit_units,
         favorite_location
  FROM public.vw_band_game_facts
  WHERE favorite_location = 'road'
),
agg AS (
  SELECT
    s.sport,
    s.location_scope,
    'pregame'::text AS study_type,
    s.band,
    COUNT(*)::integer AS sample_size,
    COUNT(*) FILTER (WHERE s.favorite_won_su)::integer AS wins,
    COUNT(*) FILTER (WHERE NOT s.favorite_won_su)::integer AS losses,
    0::integer AS pushes,
    ROUND(100.0 * (COUNT(*) FILTER (WHERE s.favorite_won_su)) / NULLIF(COUNT(*), 0), 3) AS win_rate_pct,
    ROUND(100.0 * SUM(COALESCE(s.favorite_su_profit_units, 0)) / NULLIF(COUNT(*), 0), 3) AS roi_pct,

    COUNT(*) FILTER (WHERE s.favorite_ats_result = 'W')::integer AS ats_wins,
    COUNT(*) FILTER (WHERE s.favorite_ats_result = 'L')::integer AS ats_losses,
    COUNT(*) FILTER (WHERE s.favorite_ats_result = 'P')::integer AS ats_pushes,
    COUNT(*) FILTER (WHERE s.favorite_ats_result IS NOT NULL)::integer AS ats_sample,
    COUNT(*) FILTER (WHERE s.favorite_ats_profit_units IS NOT NULL)::integer AS ats_priced_sample,
    ROUND(
      100.0 * (COUNT(*) FILTER (WHERE s.favorite_ats_result = 'W'))
      / NULLIF((COUNT(*) FILTER (WHERE s.favorite_ats_result IN ('W','L'))), 0),
      3
    ) AS ats_win_pct,
    ROUND(
      100.0 * SUM(COALESCE(s.favorite_ats_profit_units, 0))
      / NULLIF((COUNT(*) FILTER (WHERE s.favorite_ats_profit_units IS NOT NULL)), 0),
      3
    ) AS ats_roi_pct,

    COUNT(*) FILTER (WHERE s.favorite_location = 'home')::integer AS home_sample,
    COUNT(*) FILTER (WHERE s.favorite_location = 'road')::integer AS road_sample,

    COUNT(*) FILTER (WHERE s.favorite_location = 'home' AND s.favorite_won_su)::integer AS home_wins,
    COUNT(*) FILTER (WHERE s.favorite_location = 'home' AND NOT s.favorite_won_su)::integer AS home_losses,
    ROUND(
      100.0 * SUM(COALESCE(s.favorite_su_profit_units, 0)) FILTER (WHERE s.favorite_location = 'home')
      / NULLIF((COUNT(*) FILTER (WHERE s.favorite_location = 'home')), 0),
      3
    ) AS home_roi_pct,

    COUNT(*) FILTER (WHERE s.favorite_location = 'road' AND s.favorite_won_su)::integer AS road_wins,
    COUNT(*) FILTER (WHERE s.favorite_location = 'road' AND NOT s.favorite_won_su)::integer AS road_losses,
    ROUND(
      100.0 * SUM(COALESCE(s.favorite_su_profit_units, 0)) FILTER (WHERE s.favorite_location = 'road')
      / NULLIF((COUNT(*) FILTER (WHERE s.favorite_location = 'road')), 0),
      3
    ) AS road_roi_pct,

    MIN(s.start_time) AS first_game_at,
    MAX(s.start_time) AS last_game_at,

    CASE
      WHEN (COUNT(*) FILTER (WHERE s.favorite_ats_result IS NOT NULL)) > (COUNT(*) FILTER (WHERE s.favorite_ats_profit_units IS NOT NULL))
        THEN 'partial_ats_price_coverage'
      ELSE NULL
    END AS data_quality_flag
  FROM scoped s
  GROUP BY s.sport, s.location_scope, s.band
)
SELECT * FROM agg;

GRANT SELECT ON public.vw_pregame_band_map TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.vw_nba_pregame_band_map CASCADE;
CREATE OR REPLACE VIEW public.vw_nba_pregame_band_map AS
SELECT *
FROM public.vw_pregame_band_map
WHERE sport = 'nba';

GRANT SELECT ON public.vw_nba_pregame_band_map TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.vw_nhl_pregame_band_map CASCADE;
CREATE OR REPLACE VIEW public.vw_nhl_pregame_band_map AS
SELECT *
FROM public.vw_pregame_band_map
WHERE sport = 'nhl';

GRANT SELECT ON public.vw_nhl_pregame_band_map TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Pregame ML band -> spread band distribution
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.vw_pregame_band_spread_distribution CASCADE;
CREATE OR REPLACE VIEW public.vw_pregame_band_spread_distribution AS
WITH scoped AS (
  SELECT sport, 'all'::text AS location_scope, favorite_ml_band, favorite_spread_band, favorite_won_su, favorite_su_profit_units, start_time, favorite_location
  FROM public.vw_band_game_facts

  UNION ALL
  SELECT sport, 'home'::text AS location_scope, favorite_ml_band, favorite_spread_band, favorite_won_su, favorite_su_profit_units, start_time, favorite_location
  FROM public.vw_band_game_facts
  WHERE favorite_location = 'home'

  UNION ALL
  SELECT sport, 'road'::text AS location_scope, favorite_ml_band, favorite_spread_band, favorite_won_su, favorite_su_profit_units, start_time, favorite_location
  FROM public.vw_band_game_facts
  WHERE favorite_location = 'road'
),
agg AS (
  SELECT
    sport,
    location_scope,
    favorite_ml_band,
    favorite_spread_band,
    COUNT(*)::integer AS sample_size,
    COUNT(*) FILTER (WHERE favorite_won_su)::integer AS wins,
    COUNT(*) FILTER (WHERE NOT favorite_won_su)::integer AS losses,
    ROUND(100.0 * SUM(COALESCE(favorite_su_profit_units, 0)) / NULLIF(COUNT(*), 0), 3) AS roi_pct,
    MIN(start_time) AS first_game_at,
    MAX(start_time) AS last_game_at
  FROM scoped
  GROUP BY sport, location_scope, favorite_ml_band, favorite_spread_band
)
SELECT
  a.*,
  ROUND(
    100.0 * a.sample_size
    / NULLIF(SUM(a.sample_size) OVER (PARTITION BY a.sport, a.location_scope, a.favorite_ml_band), 0),
    3
  ) AS spread_share_pct
FROM agg a;

GRANT SELECT ON public.vw_pregame_band_spread_distribution TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Counterpart map (dog band -> actual favorite counterpart band)
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.vw_band_counterpart_map CASCADE;
CREATE OR REPLACE VIEW public.vw_band_counterpart_map AS
WITH scoped AS (
  SELECT sport, 'all'::text AS location_scope, dog_ml_band, favorite_ml_band,
         dog_won_su, favorite_won_su, dog_su_profit_units, favorite_su_profit_units
  FROM public.vw_band_game_facts

  UNION ALL

  SELECT sport, 'home'::text AS location_scope, dog_ml_band, favorite_ml_band,
         dog_won_su, favorite_won_su, dog_su_profit_units, favorite_su_profit_units
  FROM public.vw_band_game_facts
  WHERE favorite_location = 'home'

  UNION ALL

  SELECT sport, 'road'::text AS location_scope, dog_ml_band, favorite_ml_band,
         dog_won_su, favorite_won_su, dog_su_profit_units, favorite_su_profit_units
  FROM public.vw_band_game_facts
  WHERE favorite_location = 'road'
),
agg AS (
  SELECT
    sport,
    'pregame'::text AS study_type,
    location_scope,
    dog_ml_band,
    favorite_ml_band AS counterpart_band,
    COUNT(*)::integer AS sample_size,

    COUNT(*) FILTER (WHERE dog_won_su)::integer AS dog_wins,
    COUNT(*) FILTER (WHERE NOT dog_won_su)::integer AS dog_losses,
    ROUND(100.0 * (COUNT(*) FILTER (WHERE dog_won_su)) / NULLIF(COUNT(*), 0), 3) AS dog_win_pct,
    ROUND(100.0 * SUM(COALESCE(dog_su_profit_units, 0)) / NULLIF(COUNT(*), 0), 3) AS dog_roi_pct,

    COUNT(*) FILTER (WHERE favorite_won_su)::integer AS favorite_wins,
    COUNT(*) FILTER (WHERE NOT favorite_won_su)::integer AS favorite_losses,
    ROUND(100.0 * (COUNT(*) FILTER (WHERE favorite_won_su)) / NULLIF(COUNT(*), 0), 3) AS favorite_win_pct,
    ROUND(100.0 * SUM(COALESCE(favorite_su_profit_units, 0)) / NULLIF(COUNT(*), 0), 3) AS favorite_roi_pct
  FROM scoped
  GROUP BY sport, location_scope, dog_ml_band, favorite_ml_band
)
SELECT
  a.*,
  ROUND(
    100.0 * a.sample_size
    / NULLIF(SUM(a.sample_size) OVER (PARTITION BY a.sport, a.location_scope, a.dog_ml_band), 0),
    3
  ) AS counterpart_share_pct
FROM agg a;

GRANT SELECT ON public.vw_band_counterpart_map TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Live band map (first live snapshot after game start)
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.vw_live_band_games CASCADE;
CREATE OR REPLACE VIEW public.vw_live_band_games AS
WITH final_games AS (
  SELECT
    'nba'::text AS sport,
    np.id AS match_id,
    np.start_time,
    np.home_team,
    np.away_team,
    np.home_score::numeric AS home_score,
    np.away_score::numeric AS away_score
  FROM public.nba_postgame np
  WHERE np.home_score IS NOT NULL
    AND np.away_score IS NOT NULL

  UNION ALL

  SELECT
    'nhl'::text AS sport,
    np.id AS match_id,
    np.start_time,
    np.home_team,
    np.away_team,
    np.home_score::numeric AS home_score,
    np.away_score::numeric AS away_score
  FROM public.nhl_postgame np
  WHERE np.home_score IS NOT NULL
    AND np.away_score IS NOT NULL
),
first_live AS (
  SELECT DISTINCT ON (los.match_id)
    LOWER(los.league_id) AS sport,
    los.match_id,
    los.captured_at AS live_entry_at,
    los.home_ml::numeric AS home_ml,
    los.away_ml::numeric AS away_ml,
    los.spread_home::numeric AS home_spread,
    los.total::numeric AS total_line,
    los.period AS entry_period,
    los.clock AS entry_clock,
    los.source,
    los.market_type
  FROM public.live_odds_snapshots los
  JOIN final_games fg
    ON fg.match_id = los.match_id
   AND fg.sport = LOWER(los.league_id)
  WHERE LOWER(los.league_id) IN ('nba', 'nhl')
    AND los.is_live = true
    AND los.home_ml IS NOT NULL
    AND los.away_ml IS NOT NULL
    AND los.captured_at >= fg.start_time
  ORDER BY los.match_id, los.captured_at ASC
),
joined AS (
  SELECT
    fg.sport,
    'live'::text AS study_type,
    fg.match_id,
    fg.start_time,
    fl.live_entry_at,
    fg.home_team,
    fg.away_team,
    fg.home_score,
    fg.away_score,
    fl.home_ml,
    fl.away_ml,
    fl.home_spread,
    fl.total_line,
    fl.entry_period,
    fl.entry_clock,
    fl.source,
    fl.market_type,
    (fl.home_ml <= fl.away_ml) AS favorite_is_home,
    LEAST(fl.home_ml, fl.away_ml) AS favorite_ml,
    GREATEST(fl.home_ml, fl.away_ml) AS dog_ml
  FROM final_games fg
  JOIN first_live fl
    ON fl.match_id = fg.match_id
   AND fl.sport = fg.sport
)
SELECT
  j.sport,
  j.study_type,
  j.match_id,
  j.start_time,
  j.live_entry_at,
  j.home_team,
  j.away_team,
  j.home_score,
  j.away_score,
  j.home_ml,
  j.away_ml,
  j.home_spread,
  j.total_line,
  CASE WHEN j.favorite_is_home THEN 'home' ELSE 'road' END AS favorite_location,
  CASE WHEN j.favorite_is_home THEN j.home_team ELSE j.away_team END AS favorite_team,
  CASE WHEN j.favorite_is_home THEN j.away_team ELSE j.home_team END AS dog_team,
  j.favorite_ml,
  j.dog_ml,
  public.classify_favorite_ml_band(j.favorite_ml) AS favorite_ml_band,
  public.classify_dog_ml_band(j.dog_ml) AS dog_ml_band,
  CASE WHEN j.favorite_is_home THEN j.home_score - j.away_score ELSE j.away_score - j.home_score END AS favorite_margin,
  CASE WHEN j.favorite_is_home THEN j.home_score > j.away_score ELSE j.away_score > j.home_score END AS favorite_won_su,
  public.band_profit_units(
    j.favorite_ml,
    CASE WHEN j.favorite_is_home THEN j.home_score > j.away_score ELSE j.away_score > j.home_score END
  ) AS favorite_su_profit_units,
  public.band_profit_units(
    j.dog_ml,
    CASE WHEN j.favorite_is_home THEN j.away_score > j.home_score ELSE j.home_score > j.away_score END
  ) AS dog_su_profit_units,
  j.entry_period,
  j.entry_clock,
  j.source,
  j.market_type,
  'first_live_snapshot_after_start'::text AS trigger_description
FROM joined j;

GRANT SELECT ON public.vw_live_band_games TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.vw_live_band_map CASCADE;
CREATE OR REPLACE VIEW public.vw_live_band_map AS
WITH scoped AS (
  SELECT sport, 'all'::text AS location_scope, favorite_ml_band AS band, live_entry_at, favorite_won_su, favorite_su_profit_units,
         favorite_location, trigger_description
  FROM public.vw_live_band_games

  UNION ALL

  SELECT sport, 'home'::text AS location_scope, favorite_ml_band AS band, live_entry_at, favorite_won_su, favorite_su_profit_units,
         favorite_location, trigger_description
  FROM public.vw_live_band_games
  WHERE favorite_location = 'home'

  UNION ALL

  SELECT sport, 'road'::text AS location_scope, favorite_ml_band AS band, live_entry_at, favorite_won_su, favorite_su_profit_units,
         favorite_location, trigger_description
  FROM public.vw_live_band_games
  WHERE favorite_location = 'road'
)
SELECT
  s.sport,
  'live'::text AS study_type,
  s.location_scope,
  s.band,
  COUNT(*)::integer AS sample_size,
  COUNT(*) FILTER (WHERE s.favorite_won_su)::integer AS wins,
  COUNT(*) FILTER (WHERE NOT s.favorite_won_su)::integer AS losses,
  0::integer AS pushes,
  ROUND(100.0 * (COUNT(*) FILTER (WHERE s.favorite_won_su)) / NULLIF(COUNT(*), 0), 3) AS win_rate_pct,
  ROUND(100.0 * SUM(COALESCE(s.favorite_su_profit_units, 0)) / NULLIF(COUNT(*), 0), 3) AS roi_pct,
  MIN(s.live_entry_at) AS first_entry_at,
  MAX(s.live_entry_at) AS last_entry_at,
  MIN(s.trigger_description) AS trigger_description,
  NULL::text AS data_quality_flag
FROM scoped s
GROUP BY s.sport, s.location_scope, s.band;

GRANT SELECT ON public.vw_live_band_map TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- NHL totals core map (seed content requirement)
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.vw_nhl_total_core_map CASCADE;
CREATE OR REPLACE VIEW public.vw_nhl_total_core_map AS
WITH base AS (
  SELECT
    np.id AS match_id,
    np.start_time,
    np.dk_total::numeric AS total_line,
    np.dk_over_price::numeric AS over_price,
    np.dk_under_price::numeric AS under_price,
    (np.home_score + np.away_score)::numeric AS final_total,
    CASE
      WHEN (np.home_score + np.away_score)::numeric > np.dk_total::numeric THEN 'O'
      WHEN (np.home_score + np.away_score)::numeric < np.dk_total::numeric THEN 'U'
      ELSE 'P'
    END AS total_result
  FROM public.nhl_postgame np
  WHERE np.home_score IS NOT NULL
    AND np.away_score IS NOT NULL
    AND np.dk_total IS NOT NULL
),
filtered AS (
  SELECT *
  FROM base
  WHERE total_line IN (4.5, 5.5, 6.5)
)
SELECT
  total_line,
  COUNT(*)::integer AS sample_size,

  COUNT(*) FILTER (WHERE total_result = 'O')::integer AS over_wins,
  COUNT(*) FILTER (WHERE total_result = 'U')::integer AS over_losses,
  COUNT(*) FILTER (WHERE total_result = 'P')::integer AS over_pushes,
  ROUND(
    100.0 * (COUNT(*) FILTER (WHERE total_result = 'O'))
    / NULLIF((COUNT(*) FILTER (WHERE total_result IN ('O','U'))), 0),
    3
  ) AS over_win_pct,
  ROUND(
    100.0 * SUM(
      CASE
        WHEN total_result = 'O' THEN public.band_profit_units(over_price, true)
        WHEN total_result = 'U' THEN public.band_profit_units(over_price, false)
        ELSE 0.0
      END
    ) / NULLIF(COUNT(*), 0),
    3
  ) AS over_roi_pct,

  COUNT(*) FILTER (WHERE total_result = 'U')::integer AS under_wins,
  COUNT(*) FILTER (WHERE total_result = 'O')::integer AS under_losses,
  COUNT(*) FILTER (WHERE total_result = 'P')::integer AS under_pushes,
  ROUND(
    100.0 * (COUNT(*) FILTER (WHERE total_result = 'U'))
    / NULLIF((COUNT(*) FILTER (WHERE total_result IN ('O','U'))), 0),
    3
  ) AS under_win_pct,
  ROUND(
    100.0 * SUM(
      CASE
        WHEN total_result = 'U' THEN public.band_profit_units(under_price, true)
        WHEN total_result = 'O' THEN public.band_profit_units(under_price, false)
        ELSE 0.0
      END
    ) / NULLIF(COUNT(*), 0),
    3
  ) AS under_roi_pct,

  MIN(start_time) AS first_game_at,
  MAX(start_time) AS last_game_at
FROM filtered
GROUP BY total_line
ORDER BY total_line;

GRANT SELECT ON public.vw_nhl_total_core_map TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Coverage status (explicit missingness + live support)
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.vw_band_coverage_status CASCADE;
CREATE OR REPLACE VIEW public.vw_band_coverage_status AS
WITH postgame_union AS (
  SELECT
    'nba'::text AS sport,
    start_time,
    (home_score IS NOT NULL AND away_score IS NOT NULL) AS is_final,
    (dk_home_ml IS NOT NULL AND dk_away_ml IS NOT NULL) AS has_ml,
    (dk_home_ml IS NOT NULL AND dk_away_ml IS NOT NULL AND dk_spread IS NOT NULL) AS has_ml_spread,
    (dk_home_ml IS NOT NULL AND dk_away_ml IS NOT NULL AND dk_spread IS NOT NULL AND dk_total IS NOT NULL) AS has_ml_spread_total
  FROM public.nba_postgame

  UNION ALL

  SELECT
    'nhl'::text AS sport,
    start_time,
    (home_score IS NOT NULL AND away_score IS NOT NULL) AS is_final,
    (dk_home_ml IS NOT NULL AND dk_away_ml IS NOT NULL) AS has_ml,
    (dk_home_ml IS NOT NULL AND dk_away_ml IS NOT NULL AND dk_spread IS NOT NULL) AS has_ml_spread,
    (dk_home_ml IS NOT NULL AND dk_away_ml IS NOT NULL AND dk_spread IS NOT NULL AND dk_total IS NOT NULL) AS has_ml_spread_total
  FROM public.nhl_postgame

  UNION ALL

  SELECT
    'mlb'::text AS sport,
    start_time,
    (home_score IS NOT NULL AND away_score IS NOT NULL) AS is_final,
    (dk_home_ml IS NOT NULL AND dk_away_ml IS NOT NULL) AS has_ml,
    (dk_home_ml IS NOT NULL AND dk_away_ml IS NOT NULL AND dk_spread IS NOT NULL) AS has_ml_spread,
    (dk_home_ml IS NOT NULL AND dk_away_ml IS NOT NULL AND dk_spread IS NOT NULL AND dk_total IS NOT NULL) AS has_ml_spread_total
  FROM public.mlb_postgame
),
postgame_agg AS (
  SELECT
    sport,
    COUNT(*) FILTER (WHERE is_final)::integer AS total_final_games,
    COUNT(*) FILTER (WHERE is_final AND has_ml)::integer AS games_with_usable_ml,
    COUNT(*) FILTER (WHERE is_final AND has_ml_spread)::integer AS games_with_usable_ml_spread,
    COUNT(*) FILTER (WHERE is_final AND has_ml_spread_total)::integer AS games_with_usable_ml_spread_total,
    MIN(start_time) FILTER (WHERE is_final) AS first_game_at,
    MAX(start_time) FILTER (WHERE is_final) AS last_game_at
  FROM postgame_union
  GROUP BY sport
),
study_agg AS (
  SELECT sport, COUNT(*)::integer AS pregame_study_games
  FROM public.vw_band_game_facts
  GROUP BY sport
),
live_agg AS (
  SELECT
    LOWER(league_id)::text AS sport,
    COUNT(DISTINCT match_id)::integer AS live_snapshot_games,
    MAX(captured_at) AS latest_live_snapshot_at
  FROM public.live_odds_snapshots
  WHERE LOWER(league_id) IN ('nba', 'nhl', 'mlb')
    AND home_ml IS NOT NULL
    AND away_ml IS NOT NULL
  GROUP BY LOWER(league_id)
),
live_entry_agg AS (
  SELECT sport, COUNT(*)::integer AS live_entry_games
  FROM public.vw_live_band_games
  GROUP BY sport
)
SELECT
  p.sport,
  p.total_final_games,
  p.games_with_usable_ml,
  p.games_with_usable_ml_spread,
  p.games_with_usable_ml_spread_total,
  COALESCE(s.pregame_study_games, 0) AS pregame_study_games,
  COALESCE(le.live_entry_games, 0) AS live_entry_games,
  COALESCE(l.live_snapshot_games, 0) AS live_snapshot_games,
  p.first_game_at,
  p.last_game_at,
  l.latest_live_snapshot_at,
  CASE WHEN COALESCE(le.live_entry_games, 0) > 0 THEN 'pregame+live' ELSE 'pregame-only' END AS study_support,
  CONCAT_WS('; ',
    CASE WHEN p.total_final_games > p.games_with_usable_ml THEN 'missing pregame moneyline rows' END,
    CASE WHEN p.games_with_usable_ml > p.games_with_usable_ml_spread THEN 'missing spread coverage in usable ML sample' END,
    CASE WHEN p.games_with_usable_ml_spread > p.games_with_usable_ml_spread_total THEN 'missing total coverage in ML+spread sample' END,
    CASE WHEN p.sport IN ('nba','nhl') AND COALESCE(le.live_entry_games, 0) = 0 THEN 'live-entry sample not available yet' END,
    CASE WHEN p.sport = 'mlb' AND COALESCE(le.live_entry_games, 0) = 0 THEN 'mlb live entry map not enabled in v1 ui' END
  ) AS data_quality_note,
  now() AS view_refreshed_at
FROM postgame_agg p
LEFT JOIN study_agg s ON s.sport = p.sport
LEFT JOIN live_agg l ON l.sport = p.sport
LEFT JOIN live_entry_agg le ON le.sport = p.sport;

GRANT SELECT ON public.vw_band_coverage_status TO anon, authenticated, service_role;

-- Helpful index for first-live lookup
CREATE INDEX IF NOT EXISTS idx_live_odds_snapshots_league_match_captured
  ON public.live_odds_snapshots (league_id, match_id, captured_at);
