-- NBA historical context layer
-- Historical backbone: espn_probabilities
-- Recent overlays: live_odds_snapshots, live_context_snapshots

DROP MATERIALIZED VIEW IF EXISTS public.mv_nba_venue_environment;
DROP MATERIALIZED VIEW IF EXISTS public.mv_nba_ref_environment;
DROP MATERIALIZED VIEW IF EXISTS public.mv_nba_live_state_context;
DROP MATERIALIZED VIEW IF EXISTS public.mv_nba_weekly_context;
DROP VIEW IF EXISTS public.v_nba_probability_context_base;
DROP FUNCTION IF EXISTS public.refresh_nba_context_views();

CREATE OR REPLACE FUNCTION public.jsonb_numeric_key(p_payload jsonb, p_key text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_payload IS NULL OR p_key IS NULL OR p_payload->>p_key IS NULL THEN NULL
    ELSE public.safe_to_numeric(p_payload->>p_key)
  END;
$$;

CREATE OR REPLACE FUNCTION public.nba_probability_bucket(p_probability numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_probability IS NULL THEN 'NA'
    ELSE CONCAT(
      LEAST(GREATEST(FLOOR(p_probability * 10), 0), 9) * 10,
      '-',
      (LEAST(GREATEST(FLOOR(p_probability * 10), 0), 9) * 10) + 10,
      '%'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.nba_progress_bucket(p_progress numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_progress IS NULL THEN 'NA'
    ELSE CONCAT(
      LEAST(GREATEST(FLOOR(p_progress * 10), 0), 9) * 10,
      '-',
      (LEAST(GREATEST(FLOOR(p_progress * 10), 0), 9) * 10) + 10,
      '%'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.nba_score_diff_bucket(p_score_diff numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_score_diff IS NULL THEN 'NA'
    WHEN p_score_diff <= -15 THEN 'TRAIL_15P_PLUS'
    WHEN p_score_diff <= -8 THEN 'TRAIL_8_TO_14'
    WHEN p_score_diff <= -4 THEN 'TRAIL_4_TO_7'
    WHEN p_score_diff <= -1 THEN 'TRAIL_1_TO_3'
    WHEN p_score_diff = 0 THEN 'TIED'
    WHEN p_score_diff <= 3 THEN 'LEAD_1_TO_3'
    WHEN p_score_diff <= 7 THEN 'LEAD_4_TO_7'
    WHEN p_score_diff <= 14 THEN 'LEAD_8_TO_14'
    ELSE 'LEAD_15P_PLUS'
  END;
$$;

CREATE OR REPLACE FUNCTION public.nba_remaining_minute_bucket(p_minutes numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_minutes IS NULL THEN 'NA'
    WHEN p_minutes >= 36 THEN '36-48'
    WHEN p_minutes >= 24 THEN '24-36'
    WHEN p_minutes >= 18 THEN '18-24'
    WHEN p_minutes >= 12 THEN '12-18'
    WHEN p_minutes >= 6 THEN '6-12'
    WHEN p_minutes >= 3 THEN '3-6'
    WHEN p_minutes >= 1 THEN '1-3'
    ELSE '0-1'
  END;
$$;

CREATE OR REPLACE FUNCTION public.nba_context_exposure_tier(
  p_rows bigint,
  p_matches bigint,
  p_min_rows integer,
  p_min_matches integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_rows, 0) >= COALESCE(p_min_rows, 0)
      AND COALESCE(p_matches, 0) >= COALESCE(p_min_matches, 0) THEN 'READY'
    WHEN COALESCE(p_rows, 0) >= CEIL(COALESCE(p_min_rows, 0) / 2.0)
      AND COALESCE(p_matches, 0) >= CEIL(COALESCE(p_min_matches, 0) / 2.0) THEN 'LIMITED'
    ELSE 'HIDE'
  END;
$$;

CREATE OR REPLACE VIEW public.v_nba_probability_context_base AS
WITH final_matches AS (
  SELECT
    np.id AS match_id,
    COALESCE(np.start_time, m.start_time) AS match_start,
    np.home_team,
    np.away_team,
    np.home_score::numeric AS home_score,
    np.away_score::numeric AS away_score,
    (np.home_score + np.away_score)::numeric AS total_points,
    (np.home_score - np.away_score)::numeric AS home_margin,
    (COALESCE(np.home_fouls, 0) + COALESCE(np.away_fouls, 0))::numeric AS combined_fouls,
    COALESCE(NULLIF(np.venue, ''), NULLIF(m.venue_name, '')) AS venue_name,
    m.venue_city,
    m.venue_state,
    m.venue_indoor,
    COALESCE(np.attendance, m.attendance)::numeric AS attendance,
    public.safe_to_numeric(np.dk_home_ml::text) AS dk_home_ml,
    public.safe_to_numeric(np.dk_away_ml::text) AS dk_away_ml,
    public.safe_to_numeric(np.dk_spread::text) AS dk_home_spread,
    public.safe_to_numeric(np.dk_total::text) AS dk_total,
    public.safe_to_numeric(np.dk_home_spread_price::text) AS dk_home_spread_price,
    public.safe_to_numeric(np.dk_away_spread_price::text) AS dk_away_spread_price,
    public.safe_to_numeric(np.dk_over_price::text) AS dk_over_price,
    public.safe_to_numeric(np.dk_under_price::text) AS dk_under_price,
    m.opening_odds,
    m.closing_odds,
    m.current_odds,
    CASE WHEN np.home_score > np.away_score THEN 1.0 ELSE 0.0 END AS home_outcome,
    (
      (
        COALESCE(public.safe_to_numeric(SPLIT_PART(np.home_fg, '-', 2)), 0)
        + (0.44 * COALESCE(public.safe_to_numeric(SPLIT_PART(np.home_ft, '-', 2)), 0))
        - COALESCE(np.home_off_rebounds, 0)
        + COALESCE(np.home_turnovers, 0)
      )
      +
      (
        COALESCE(public.safe_to_numeric(SPLIT_PART(np.away_fg, '-', 2)), 0)
        + (0.44 * COALESCE(public.safe_to_numeric(SPLIT_PART(np.away_ft, '-', 2)), 0))
        - COALESCE(np.away_off_rebounds, 0)
        + COALESCE(np.away_turnovers, 0)
      )
    ) / 2.0 AS estimated_pace
  FROM public.nba_postgame np
  LEFT JOIN public.matches m
    ON m.id = np.id
  WHERE np.id LIKE '%_nba'
    AND np.home_score IS NOT NULL
    AND np.away_score IS NOT NULL
),
anchored_matches AS (
  SELECT
    fm.*,
    public.devig_home_probability(
      COALESCE(
        CASE WHEN fm.dk_home_ml IS NOT NULL AND fm.dk_away_ml IS NOT NULL THEN fm.dk_home_ml END,
        CASE
          WHEN public.jsonb_numeric_key(fm.closing_odds, 'homeML') IS NOT NULL
            AND public.jsonb_numeric_key(fm.closing_odds, 'awayML') IS NOT NULL
          THEN public.jsonb_numeric_key(fm.closing_odds, 'homeML')
        END,
        CASE
          WHEN public.jsonb_numeric_key(fm.opening_odds, 'homeML') IS NOT NULL
            AND public.jsonb_numeric_key(fm.opening_odds, 'awayML') IS NOT NULL
          THEN public.jsonb_numeric_key(fm.opening_odds, 'homeML')
        END,
        CASE
          WHEN public.jsonb_numeric_key(fm.current_odds, 'homeML') IS NOT NULL
            AND public.jsonb_numeric_key(fm.current_odds, 'awayML') IS NOT NULL
          THEN public.jsonb_numeric_key(fm.current_odds, 'homeML')
        END
      ),
      COALESCE(
        CASE WHEN fm.dk_home_ml IS NOT NULL AND fm.dk_away_ml IS NOT NULL THEN fm.dk_away_ml END,
        CASE
          WHEN public.jsonb_numeric_key(fm.closing_odds, 'homeML') IS NOT NULL
            AND public.jsonb_numeric_key(fm.closing_odds, 'awayML') IS NOT NULL
          THEN public.jsonb_numeric_key(fm.closing_odds, 'awayML')
        END,
        CASE
          WHEN public.jsonb_numeric_key(fm.opening_odds, 'homeML') IS NOT NULL
            AND public.jsonb_numeric_key(fm.opening_odds, 'awayML') IS NOT NULL
          THEN public.jsonb_numeric_key(fm.opening_odds, 'awayML')
        END,
        CASE
          WHEN public.jsonb_numeric_key(fm.current_odds, 'homeML') IS NOT NULL
            AND public.jsonb_numeric_key(fm.current_odds, 'awayML') IS NOT NULL
          THEN public.jsonb_numeric_key(fm.current_odds, 'awayML')
        END
      )
    ) AS anchor_home_prob,
    COALESCE(
      fm.dk_total,
      public.jsonb_numeric_key(fm.closing_odds, 'total'),
      public.jsonb_numeric_key(fm.opening_odds, 'total'),
      public.jsonb_numeric_key(fm.current_odds, 'total')
    ) AS anchor_total,
    COALESCE(
      fm.dk_home_spread,
      public.jsonb_numeric_key(fm.closing_odds, 'homeSpread'),
      public.jsonb_numeric_key(fm.opening_odds, 'homeSpread'),
      public.jsonb_numeric_key(fm.current_odds, 'homeSpread')
    ) AS anchor_spread_home,
    CASE
      WHEN fm.dk_home_ml IS NOT NULL AND fm.dk_away_ml IS NOT NULL THEN 'nba_postgame_dk'
      WHEN public.jsonb_numeric_key(fm.closing_odds, 'homeML') IS NOT NULL
        AND public.jsonb_numeric_key(fm.closing_odds, 'awayML') IS NOT NULL THEN 'matches_closing_odds'
      WHEN public.jsonb_numeric_key(fm.opening_odds, 'homeML') IS NOT NULL
        AND public.jsonb_numeric_key(fm.opening_odds, 'awayML') IS NOT NULL THEN 'matches_opening_odds'
      WHEN public.jsonb_numeric_key(fm.current_odds, 'homeML') IS NOT NULL
        AND public.jsonb_numeric_key(fm.current_odds, 'awayML') IS NOT NULL THEN 'matches_current_odds'
      ELSE NULL
    END AS anchor_ml_source,
    CASE
      WHEN fm.dk_total IS NOT NULL THEN 'nba_postgame_dk'
      WHEN public.jsonb_numeric_key(fm.closing_odds, 'total') IS NOT NULL THEN 'matches_closing_odds'
      WHEN public.jsonb_numeric_key(fm.opening_odds, 'total') IS NOT NULL THEN 'matches_opening_odds'
      WHEN public.jsonb_numeric_key(fm.current_odds, 'total') IS NOT NULL THEN 'matches_current_odds'
      ELSE NULL
    END AS anchor_total_source,
    CASE
      WHEN fm.dk_home_spread IS NOT NULL THEN 'nba_postgame_dk'
      WHEN public.jsonb_numeric_key(fm.closing_odds, 'homeSpread') IS NOT NULL THEN 'matches_closing_odds'
      WHEN public.jsonb_numeric_key(fm.opening_odds, 'homeSpread') IS NOT NULL THEN 'matches_opening_odds'
      WHEN public.jsonb_numeric_key(fm.current_odds, 'homeSpread') IS NOT NULL THEN 'matches_current_odds'
      ELSE NULL
    END AS anchor_spread_source
  FROM final_matches fm
),
officials_ranked AS (
  SELECT
    go.match_id,
    go.official_name,
    go.official_position,
    go.official_order,
    ROW_NUMBER() OVER (
      PARTITION BY go.match_id
      ORDER BY
        CASE WHEN LOWER(COALESCE(go.official_position, '')) = 'referee' THEN 0 ELSE 1 END,
        COALESCE(go.official_order, 99),
        go.official_name
    ) AS official_pick_rank
  FROM public.game_officials go
  WHERE go.league_id = 'nba'
),
official_crews AS (
  SELECT
    match_id,
    MAX(CASE WHEN official_pick_rank = 1 THEN official_name END) AS lead_ref,
    STRING_AGG(official_name, ' | ' ORDER BY official_name) AS crew_key
  FROM officials_ranked
  GROUP BY match_id
),
probability_ranked AS (
  SELECT
    ep.match_id,
    ep.last_modified,
    ep.sequence_number,
    ep.play_id,
    public.normalize_probability(ep.home_win_pct) AS home_win_prob,
    public.normalize_probability(ep.spread_cover_prob_home) AS spread_cover_prob_home,
    public.normalize_probability(ep.total_over_prob) AS total_over_prob,
    ROW_NUMBER() OVER (
      PARTITION BY ep.match_id
      ORDER BY ep.last_modified, COALESCE(ep.sequence_number, 0), COALESCE(ep.play_id, '')
    ) AS probability_rank,
    COUNT(*) OVER (PARTITION BY ep.match_id) AS probability_count,
    FIRST_VALUE(public.normalize_probability(ep.home_win_pct)) OVER (
      PARTITION BY ep.match_id
      ORDER BY ep.last_modified, COALESCE(ep.sequence_number, 0), COALESCE(ep.play_id, '')
    ) AS pregame_home_win_prob,
    LAG(public.normalize_probability(ep.home_win_pct)) OVER (
      PARTITION BY ep.match_id
      ORDER BY ep.last_modified, COALESCE(ep.sequence_number, 0), COALESCE(ep.play_id, '')
    ) AS previous_home_win_prob
  FROM public.espn_probabilities ep
  WHERE ep.league_id = 'nba'
),
live_odds_candidates AS (
  SELECT
    los.match_id,
    los.captured_at,
    los.provider,
    los.provider_id,
    los.period,
    los.clock,
    los.home_score::numeric AS home_score,
    los.away_score::numeric AS away_score,
    public.safe_to_numeric(los.home_ml::text) AS home_ml,
    public.safe_to_numeric(los.away_ml::text) AS away_ml,
    public.safe_to_numeric(los.total::text) AS live_total,
    ROW_NUMBER() OVER (
      PARTITION BY los.match_id, los.captured_at
      ORDER BY
        CASE
          WHEN public.safe_to_numeric(los.home_ml::text) IS NOT NULL
            AND public.safe_to_numeric(los.away_ml::text) IS NOT NULL THEN 0
          ELSE 1
        END,
        CASE
          WHEN LOWER(COALESCE(los.provider_id, los.provider, '')) LIKE '%draftkings%' THEN 0
          WHEN LOWER(COALESCE(los.provider_id, los.provider, '')) LIKE '%pinnacle%' THEN 1
          WHEN LOWER(COALESCE(los.provider_id, los.provider, '')) LIKE '%fanduel%' THEN 2
          WHEN LOWER(COALESCE(los.provider_id, los.provider, '')) LIKE '%espn%' THEN 3
          WHEN LOWER(COALESCE(los.provider_id, los.provider, '')) LIKE '%betmgm%' THEN 4
          WHEN LOWER(COALESCE(los.provider_id, los.provider, '')) LIKE '%caesars%' THEN 5
          WHEN LOWER(COALESCE(los.provider_id, los.provider, '')) LIKE '%betrivers%' THEN 6
          ELSE 99
        END,
        COALESCE(los.provider, '')
    ) AS selection_rank
  FROM public.live_odds_snapshots los
  WHERE los.league_id = 'nba'
),
live_odds_canonical AS (
  SELECT *
  FROM live_odds_candidates
  WHERE selection_rank = 1
    AND home_ml IS NOT NULL
    AND away_ml IS NOT NULL
),
live_odds_ranked AS (
  SELECT
    loc.*,
    ROW_NUMBER() OVER (PARTITION BY loc.match_id ORDER BY loc.captured_at) AS overlay_rank,
    COUNT(*) OVER (PARTITION BY loc.match_id) AS overlay_count
  FROM live_odds_canonical loc
),
live_odds_counts AS (
  SELECT
    match_id,
    MAX(overlay_count) AS overlay_count
  FROM live_odds_ranked
  GROUP BY match_id
),
live_context_ranked AS (
  SELECT
    lcs.match_id,
    lcs.captured_at,
    lcs.period,
    lcs.clock,
    lcs.home_score::numeric AS home_score,
    lcs.away_score::numeric AS away_score,
    lcs.situation->>'homeBonusState' AS home_bonus_state,
    lcs.situation->>'awayBonusState' AS away_bonus_state,
    public.safe_to_numeric(lcs.situation->>'homeTimeouts') AS home_timeouts,
    public.safe_to_numeric(lcs.situation->>'awayTimeouts') AS away_timeouts,
    ROW_NUMBER() OVER (PARTITION BY lcs.match_id ORDER BY lcs.captured_at) AS overlay_rank,
    COUNT(*) OVER (PARTITION BY lcs.match_id) AS overlay_count
  FROM public.live_context_snapshots lcs
  WHERE lcs.league_id = 'nba'
    AND COALESCE(lcs.period, 0) >= 1
    AND lcs.clock IS NOT NULL
),
live_context_counts AS (
  SELECT
    match_id,
    MAX(overlay_count) AS overlay_count
  FROM live_context_ranked
  GROUP BY match_id
),
probability_base AS (
  SELECT
    pr.match_id,
    am.match_start,
    DATE_TRUNC('week', am.match_start AT TIME ZONE 'UTC')::date AS week_start,
    DATE_TRUNC('month', am.match_start AT TIME ZONE 'UTC')::date AS month_start,
    TO_CHAR(DATE_TRUNC('month', am.match_start AT TIME ZONE 'UTC')::date, 'YYYY-MM') AS month_key,
    pr.last_modified,
    pr.sequence_number,
    pr.play_id,
    pr.probability_rank,
    pr.probability_count,
    CASE
      WHEN pr.probability_count <= 1 THEN 0.0
      ELSE (pr.probability_rank - 1)::numeric / (pr.probability_count - 1)::numeric
    END AS progress_fraction,
    public.nba_progress_bucket(
      CASE
        WHEN pr.probability_count <= 1 THEN 0.0
        ELSE (pr.probability_rank - 1)::numeric / (pr.probability_count - 1)::numeric
      END
    ) AS progress_bucket,
    pr.home_win_prob,
    public.nba_probability_bucket(pr.home_win_prob) AS home_win_prob_bucket,
    pr.spread_cover_prob_home,
    public.nba_probability_bucket(pr.spread_cover_prob_home) AS spread_cover_prob_bucket,
    pr.total_over_prob,
    public.nba_probability_bucket(pr.total_over_prob) AS total_over_prob_bucket,
    pr.pregame_home_win_prob,
    COALESCE(ABS(pr.home_win_prob - pr.previous_home_win_prob), 0.0) AS abs_home_win_delta,
    am.home_outcome,
    CASE
      WHEN am.anchor_total IS NULL OR am.total_points = am.anchor_total THEN NULL
      WHEN am.total_points > am.anchor_total THEN 1.0
      ELSE 0.0
    END AS total_over_outcome,
    CASE
      WHEN am.anchor_spread_home IS NULL OR (am.home_margin + am.anchor_spread_home) = 0 THEN NULL
      WHEN (am.home_margin + am.anchor_spread_home) > 0 THEN 1.0
      ELSE 0.0
    END AS spread_cover_outcome,
    CASE
      WHEN pr.home_win_prob >= 0.9 AND am.home_outcome = 0 THEN TRUE
      WHEN pr.home_win_prob <= 0.1 AND am.home_outcome = 1 THEN TRUE
      ELSE FALSE
    END AS false_certainty,
    am.home_score,
    am.away_score,
    am.total_points,
    am.home_margin,
    am.combined_fouls,
    am.estimated_pace,
    ABS(am.home_margin) >= 15 AS blowout_flag,
    am.anchor_home_prob,
    am.anchor_total,
    am.anchor_spread_home,
    am.anchor_ml_source,
    am.anchor_total_source,
    am.anchor_spread_source,
    am.venue_name,
    am.venue_city,
    am.venue_state,
    am.venue_indoor,
    am.attendance,
    oc.lead_ref,
    oc.crew_key,
    CASE
      WHEN loc.overlay_count IS NULL THEN NULL
      WHEN pr.probability_count <= 1 OR loc.overlay_count <= 1 THEN 1
      ELSE 1 + ROUND(((pr.probability_rank - 1)::numeric * (loc.overlay_count - 1)::numeric) / GREATEST((pr.probability_count - 1)::numeric, 1))::integer
    END AS market_overlay_rank_target,
    CASE
      WHEN lcc.overlay_count IS NULL THEN NULL
      WHEN pr.probability_count <= 1 OR lcc.overlay_count <= 1 THEN 1
      ELSE 1 + ROUND(((pr.probability_rank - 1)::numeric * (lcc.overlay_count - 1)::numeric) / GREATEST((pr.probability_count - 1)::numeric, 1))::integer
    END AS rich_overlay_rank_target
  FROM probability_ranked pr
  JOIN anchored_matches am
    ON am.match_id = pr.match_id
  LEFT JOIN official_crews oc
    ON oc.match_id = pr.match_id
  LEFT JOIN live_odds_counts loc
    ON loc.match_id = pr.match_id
  LEFT JOIN live_context_counts lcc
    ON lcc.match_id = pr.match_id
)
SELECT
  pb.match_id,
  pb.match_start,
  pb.week_start,
  pb.month_start,
  pb.month_key,
  pb.last_modified,
  pb.sequence_number,
  pb.play_id,
  pb.probability_rank,
  pb.probability_count,
  pb.progress_fraction,
  pb.progress_bucket,
  pb.home_win_prob,
  pb.home_win_prob_bucket,
  pb.spread_cover_prob_home,
  pb.spread_cover_prob_bucket,
  pb.total_over_prob,
  pb.total_over_prob_bucket,
  pb.pregame_home_win_prob,
  pb.abs_home_win_delta,
  pb.home_outcome,
  pb.total_over_outcome,
  pb.spread_cover_outcome,
  pb.false_certainty,
  pb.home_score,
  pb.away_score,
  pb.total_points,
  pb.home_margin,
  pb.combined_fouls,
  pb.estimated_pace,
  pb.blowout_flag,
  pb.anchor_home_prob,
  pb.anchor_total,
  pb.anchor_spread_home,
  pb.anchor_ml_source,
  pb.anchor_total_source,
  pb.anchor_spread_source,
  pb.venue_name,
  pb.venue_city,
  pb.venue_state,
  pb.venue_indoor,
  pb.attendance,
  pb.lead_ref,
  pb.crew_key,
  CASE WHEN lo.match_id IS NOT NULL THEN 'progress' ELSE NULL END AS market_join_mode,
  lo.provider AS market_provider,
  lo.provider_id AS market_provider_id,
  public.devig_home_probability(lo.home_ml, lo.away_ml) AS market_home_prob,
  lo.live_total AS market_total,
  lo.period AS market_period,
  lo.clock AS market_clock,
  public.nba_remaining_minutes(lo.period, lo.clock) AS market_remaining_minutes,
  public.nba_remaining_minute_bucket(public.nba_remaining_minutes(lo.period, lo.clock)) AS market_remaining_minute_bucket,
  CASE
    WHEN lo.home_score IS NOT NULL AND lo.away_score IS NOT NULL THEN (lo.home_score - lo.away_score)
    ELSE NULL
  END AS market_score_diff,
  public.nba_score_diff_bucket(
    CASE
      WHEN lo.home_score IS NOT NULL AND lo.away_score IS NOT NULL THEN (lo.home_score - lo.away_score)
      ELSE NULL
    END
  ) AS market_score_diff_bucket,
  CASE WHEN lc.match_id IS NOT NULL THEN 'progress' ELSE NULL END AS rich_join_mode,
  lc.period AS rich_period,
  lc.clock AS rich_clock,
  public.nba_remaining_minutes(lc.period, lc.clock) AS rich_remaining_minutes,
  public.nba_remaining_minute_bucket(public.nba_remaining_minutes(lc.period, lc.clock)) AS rich_remaining_minute_bucket,
  CASE
    WHEN lc.home_score IS NOT NULL AND lc.away_score IS NOT NULL THEN (lc.home_score - lc.away_score)
    ELSE NULL
  END AS rich_score_diff,
  public.nba_score_diff_bucket(
    CASE
      WHEN lc.home_score IS NOT NULL AND lc.away_score IS NOT NULL THEN (lc.home_score - lc.away_score)
      ELSE NULL
    END
  ) AS rich_score_diff_bucket,
  lc.home_bonus_state AS rich_home_bonus_state,
  lc.away_bonus_state AS rich_away_bonus_state,
  CONCAT(COALESCE(lc.home_bonus_state, 'NA'), '|', COALESCE(lc.away_bonus_state, 'NA')) AS rich_bonus_shape,
  lc.home_timeouts AS rich_home_timeouts,
  lc.away_timeouts AS rich_away_timeouts,
  COALESCE(lc.period::text, lo.period::text) AS overlay_period_key,
  COALESCE(
    public.nba_remaining_minute_bucket(public.nba_remaining_minutes(lc.period, lc.clock)),
    public.nba_remaining_minute_bucket(public.nba_remaining_minutes(lo.period, lo.clock)),
    'NA'
  ) AS overlay_remaining_minute_bucket,
  COALESCE(
    public.nba_score_diff_bucket(
      CASE
        WHEN lc.home_score IS NOT NULL AND lc.away_score IS NOT NULL THEN (lc.home_score - lc.away_score)
        ELSE NULL
      END
    ),
    public.nba_score_diff_bucket(
      CASE
        WHEN lo.home_score IS NOT NULL AND lo.away_score IS NOT NULL THEN (lo.home_score - lo.away_score)
        ELSE NULL
      END
    ),
    'NA'
  ) AS overlay_score_diff_bucket,
  CASE
    WHEN lc.match_id IS NOT NULL OR lo.match_id IS NOT NULL THEN 'RECENT_OVERLAY'
    ELSE 'HISTORICAL_BACKBONE'
  END AS context_scope
FROM probability_base pb
LEFT JOIN live_odds_ranked lo
  ON lo.match_id = pb.match_id
 AND lo.overlay_rank = pb.market_overlay_rank_target
LEFT JOIN live_context_ranked lc
  ON lc.match_id = pb.match_id
 AND lc.overlay_rank = pb.rich_overlay_rank_target;

CREATE MATERIALIZED VIEW public.mv_nba_weekly_context AS
WITH base AS (
  SELECT *
  FROM public.v_nba_probability_context_base
),
match_level AS (
  SELECT DISTINCT ON (match_id)
    match_id,
    week_start,
    total_points,
    anchor_total,
    combined_fouls,
    estimated_pace,
    blowout_flag,
    pregame_home_win_prob,
    context_scope
  FROM base
  ORDER BY match_id, probability_rank
),
season_baseline AS (
  SELECT
    AVG(estimated_pace) AS season_avg_pace,
    AVG(combined_fouls) AS season_avg_combined_fouls
  FROM match_level
),
weekly_row AS (
  SELECT
    week_start,
    COUNT(*)::integer AS probability_rows,
    AVG(POWER(home_win_prob - home_outcome, 2)) AS win_brier_espn,
    AVG(POWER(market_home_prob - home_outcome, 2)) FILTER (WHERE market_home_prob IS NOT NULL) AS win_brier_market,
    AVG(abs_home_win_delta) AS avg_absolute_repricing_step,
    AVG(false_certainty::integer::numeric) AS false_certainty_rate,
    AVG(total_over_outcome - total_over_prob) FILTER (WHERE total_over_outcome IS NOT NULL AND total_over_prob IS NOT NULL) AS total_over_calibration_gap,
    AVG(spread_cover_outcome - spread_cover_prob_home) FILTER (WHERE spread_cover_outcome IS NOT NULL AND spread_cover_prob_home IS NOT NULL) AS spread_cover_calibration_gap,
    AVG((market_home_prob - home_win_prob)) FILTER (WHERE market_home_prob IS NOT NULL AND home_win_prob IS NOT NULL) AS market_minus_espn_gap,
    AVG((market_home_prob IS NOT NULL)::integer::numeric) AS market_overlay_row_rate,
    AVG((context_scope = 'RECENT_OVERLAY')::integer::numeric) AS recent_overlay_row_rate
  FROM base
  GROUP BY week_start
),
weekly_match AS (
  SELECT
    ml.week_start,
    COUNT(*)::integer AS games,
    AVG(ml.total_points) AS avg_final_total,
    AVG(ml.anchor_total) FILTER (WHERE ml.anchor_total IS NOT NULL) AS avg_anchor_total,
    AVG(ml.total_points - ml.anchor_total) FILTER (WHERE ml.anchor_total IS NOT NULL) AS avg_total_residual_points,
    AVG(ml.estimated_pace) FILTER (WHERE ml.estimated_pace IS NOT NULL) AS avg_estimated_pace,
    AVG(ml.combined_fouls) FILTER (WHERE ml.combined_fouls IS NOT NULL) AS avg_combined_fouls,
    AVG(ml.blowout_flag::integer::numeric) AS blowout_rate,
    AVG(ml.pregame_home_win_prob) FILTER (WHERE ml.pregame_home_win_prob IS NOT NULL) AS avg_pregame_home_win_prob
  FROM match_level ml
  GROUP BY ml.week_start
)
SELECT
  wr.week_start,
  DENSE_RANK() OVER (ORDER BY wr.week_start) AS week_of_season,
  wm.games,
  wr.probability_rows,
  ROUND((wr.probability_rows::numeric / NULLIF(wm.games, 0)), 2) AS avg_entries_per_game,
  ROUND(wr.win_brier_espn::numeric, 4) AS win_brier_espn,
  ROUND(wr.win_brier_market::numeric, 4) AS win_brier_market,
  ROUND((100.0 * wr.total_over_calibration_gap)::numeric, 2) AS total_over_calibration_gap_pp,
  ROUND((100.0 * wr.spread_cover_calibration_gap)::numeric, 2) AS spread_cover_calibration_gap_pp,
  ROUND((100.0 * wr.market_minus_espn_gap)::numeric, 2) AS market_minus_espn_gap_pp,
  ROUND(wr.avg_absolute_repricing_step::numeric, 4) AS avg_absolute_repricing_step,
  ROUND((100.0 * wr.false_certainty_rate)::numeric, 2) AS false_certainty_rate_pct,
  ROUND(wm.avg_pregame_home_win_prob::numeric, 4) AS avg_pregame_home_win_prob,
  ROUND(wm.avg_anchor_total::numeric, 2) AS avg_anchor_total,
  ROUND(wm.avg_final_total::numeric, 2) AS avg_final_total,
  ROUND(wm.avg_total_residual_points::numeric, 2) AS avg_total_residual_points,
  ROUND(wm.avg_estimated_pace::numeric, 2) AS avg_estimated_pace,
  ROUND((wm.avg_estimated_pace - sb.season_avg_pace)::numeric, 2) AS pace_delta_vs_season,
  ROUND(wm.avg_combined_fouls::numeric, 2) AS avg_combined_fouls,
  ROUND((wm.avg_combined_fouls - sb.season_avg_combined_fouls)::numeric, 2) AS foul_delta_vs_season,
  ROUND((100.0 * wm.blowout_rate)::numeric, 2) AS blowout_rate_pct,
  ROUND((100.0 * wr.market_overlay_row_rate)::numeric, 2) AS market_overlay_row_rate_pct,
  ROUND((100.0 * wr.recent_overlay_row_rate)::numeric, 2) AS recent_overlay_row_rate_pct,
  CASE
    WHEN wm.avg_total_residual_points >= 5 THEN 'OVER_HEAVY'
    WHEN wm.avg_total_residual_points <= -5 THEN 'UNDER_HEAVY'
    ELSE 'NEUTRAL'
  END AS total_environment_tag,
  CASE
    WHEN (wm.avg_estimated_pace - sb.season_avg_pace) >= 2 THEN 'FAST'
    WHEN (wm.avg_estimated_pace - sb.season_avg_pace) <= -2 THEN 'SLOW'
    ELSE 'NEUTRAL'
  END AS pace_environment_tag,
  8 AS min_games_threshold,
  (wm.games >= 8) AS meets_sample_threshold,
  public.nba_context_exposure_tier(wr.probability_rows, wm.games, 4000, 8) AS exposure_tier,
  NOW() AS updated_at
FROM weekly_row wr
JOIN weekly_match wm
  ON wm.week_start = wr.week_start
CROSS JOIN season_baseline sb;

CREATE UNIQUE INDEX mv_nba_weekly_context_week_start_uidx
  ON public.mv_nba_weekly_context (week_start);

CREATE MATERIALIZED VIEW public.mv_nba_live_state_context AS
WITH base AS (
  SELECT *
  FROM public.v_nba_probability_context_base
),
aggregated AS (
  SELECT
    context_scope,
    progress_bucket,
    home_win_prob_bucket,
    total_over_prob_bucket,
    COALESCE(overlay_period_key, 'NA') AS overlay_period_key,
    COALESCE(overlay_remaining_minute_bucket, 'NA') AS overlay_remaining_minute_bucket,
    COALESCE(overlay_score_diff_bucket, 'NA') AS score_diff_bucket,
    CASE
      WHEN context_scope = 'RECENT_OVERLAY' THEN COALESCE(rich_bonus_shape, 'NA')
      ELSE 'NA'
    END AS bonus_shape,
    COUNT(*)::integer AS rows,
    COUNT(DISTINCT match_id)::integer AS matches,
    COUNT(DISTINCT match_id) FILTER (WHERE market_home_prob IS NOT NULL)::integer AS market_matches,
    COUNT(DISTINCT match_id) FILTER (WHERE rich_period IS NOT NULL)::integer AS rich_overlay_matches,
    AVG(home_outcome) AS actual_home_win_rate,
    AVG(total_over_outcome) FILTER (WHERE total_over_outcome IS NOT NULL) AS actual_over_rate,
    AVG(home_outcome - home_win_prob) FILTER (WHERE home_win_prob IS NOT NULL) AS espn_home_calibration_gap,
    AVG(total_over_outcome - total_over_prob) FILTER (WHERE total_over_outcome IS NOT NULL AND total_over_prob IS NOT NULL) AS espn_total_calibration_gap,
    AVG(home_outcome - market_home_prob) FILTER (WHERE market_home_prob IS NOT NULL) AS market_home_calibration_gap,
    AVG(market_home_prob - home_win_prob) FILTER (WHERE market_home_prob IS NOT NULL AND home_win_prob IS NOT NULL) AS market_minus_espn_gap,
    AVG(false_certainty::integer::numeric) AS false_certainty_rate,
    AVG(total_points - anchor_total) FILTER (WHERE anchor_total IS NOT NULL) AS avg_total_residual_points,
    AVG(estimated_pace) FILTER (WHERE estimated_pace IS NOT NULL) AS avg_estimated_pace,
    AVG(combined_fouls) FILTER (WHERE combined_fouls IS NOT NULL) AS avg_combined_fouls,
    AVG(progress_fraction) AS avg_progress_fraction
  FROM base
  GROUP BY
    context_scope,
    progress_bucket,
    home_win_prob_bucket,
    total_over_prob_bucket,
    COALESCE(overlay_period_key, 'NA'),
    COALESCE(overlay_remaining_minute_bucket, 'NA'),
    COALESCE(overlay_score_diff_bucket, 'NA'),
    CASE
      WHEN context_scope = 'RECENT_OVERLAY' THEN COALESCE(rich_bonus_shape, 'NA')
      ELSE 'NA'
    END
)
SELECT
  context_scope,
  progress_bucket,
  home_win_prob_bucket,
  total_over_prob_bucket,
  overlay_period_key,
  overlay_remaining_minute_bucket,
  score_diff_bucket,
  bonus_shape,
  rows,
  matches,
  market_matches,
  rich_overlay_matches,
  ROUND((100.0 * actual_home_win_rate)::numeric, 2) AS actual_home_win_pct,
  ROUND((100.0 * actual_over_rate)::numeric, 2) AS actual_over_pct,
  ROUND((100.0 * espn_home_calibration_gap)::numeric, 2) AS espn_home_calibration_gap_pp,
  ROUND((100.0 * espn_total_calibration_gap)::numeric, 2) AS espn_total_calibration_gap_pp,
  ROUND((100.0 * market_home_calibration_gap)::numeric, 2) AS market_home_calibration_gap_pp,
  ROUND((100.0 * market_minus_espn_gap)::numeric, 2) AS market_minus_espn_gap_pp,
  ROUND((100.0 * false_certainty_rate)::numeric, 2) AS false_certainty_rate_pct,
  ROUND(avg_total_residual_points::numeric, 2) AS avg_total_residual_points,
  ROUND(avg_estimated_pace::numeric, 2) AS avg_estimated_pace,
  ROUND(avg_combined_fouls::numeric, 2) AS avg_combined_fouls,
  ROUND(avg_progress_fraction::numeric, 4) AS avg_progress_fraction,
  CASE
    WHEN context_scope = 'RECENT_OVERLAY' THEN 50
    ELSE 250
  END AS min_rows_threshold,
  CASE
    WHEN context_scope = 'RECENT_OVERLAY' THEN 5
    ELSE 25
  END AS min_matches_threshold,
  CASE
    WHEN context_scope = 'RECENT_OVERLAY' THEN rows >= 50 AND matches >= 5
    ELSE rows >= 250 AND matches >= 25
  END AS meets_sample_threshold,
  public.nba_context_exposure_tier(
    rows,
    matches,
    CASE WHEN context_scope = 'RECENT_OVERLAY' THEN 50 ELSE 250 END,
    CASE WHEN context_scope = 'RECENT_OVERLAY' THEN 5 ELSE 25 END
  ) AS exposure_tier,
  NOW() AS updated_at
FROM aggregated;

CREATE UNIQUE INDEX mv_nba_live_state_context_uidx
  ON public.mv_nba_live_state_context (
    context_scope,
    progress_bucket,
    home_win_prob_bucket,
    total_over_prob_bucket,
    overlay_period_key,
    overlay_remaining_minute_bucket,
    score_diff_bucket,
    bonus_shape
  );

CREATE MATERIALIZED VIEW public.mv_nba_ref_environment AS
WITH base AS (
  SELECT DISTINCT ON (match_id)
    match_id,
    lead_ref,
    crew_key,
    total_points,
    anchor_total,
    home_outcome,
    anchor_home_prob,
    home_margin,
    anchor_spread_home,
    combined_fouls,
    estimated_pace,
    blowout_flag,
    attendance
  FROM public.v_nba_probability_context_base
  WHERE lead_ref IS NOT NULL
  ORDER BY match_id, probability_rank
),
season_baseline AS (
  SELECT
    AVG(combined_fouls) AS season_avg_combined_fouls,
    AVG(estimated_pace) AS season_avg_pace,
    STDDEV_POP(total_points - anchor_total) FILTER (WHERE anchor_total IS NOT NULL) AS season_total_residual_sd
  FROM base
),
aggregated AS (
  SELECT
    lead_ref,
    COUNT(*)::integer AS games,
    COUNT(DISTINCT crew_key)::integer AS distinct_crews,
    AVG(combined_fouls) FILTER (WHERE combined_fouls IS NOT NULL) AS avg_combined_fouls,
    AVG(estimated_pace) FILTER (WHERE estimated_pace IS NOT NULL) AS avg_estimated_pace,
    AVG(total_points - anchor_total) FILTER (WHERE anchor_total IS NOT NULL) AS avg_total_residual_points,
    AVG(home_outcome - anchor_home_prob) FILTER (WHERE anchor_home_prob IS NOT NULL) AS avg_home_side_residual,
    AVG(home_margin + anchor_spread_home) FILTER (WHERE anchor_spread_home IS NOT NULL) AS avg_margin_residual_points,
    STDDEV_POP(total_points - anchor_total) FILTER (WHERE anchor_total IS NOT NULL) AS total_residual_sd,
    AVG(blowout_flag::integer::numeric) AS blowout_rate,
    AVG(attendance) FILTER (WHERE attendance IS NOT NULL) AS avg_attendance
  FROM base
  GROUP BY lead_ref
)
SELECT
  a.lead_ref,
  a.games,
  a.distinct_crews,
  ROUND(a.avg_combined_fouls::numeric, 2) AS avg_combined_fouls,
  ROUND((a.avg_combined_fouls - sb.season_avg_combined_fouls)::numeric, 2) AS foul_delta_vs_baseline,
  ROUND(a.avg_estimated_pace::numeric, 2) AS avg_estimated_pace,
  ROUND((a.avg_estimated_pace - sb.season_avg_pace)::numeric, 2) AS pace_delta_vs_baseline,
  ROUND(a.avg_total_residual_points::numeric, 2) AS avg_total_residual_points,
  ROUND((100.0 * a.avg_home_side_residual)::numeric, 2) AS avg_home_side_residual_pp,
  ROUND(a.avg_margin_residual_points::numeric, 2) AS avg_margin_residual_points,
  ROUND(a.total_residual_sd::numeric, 2) AS total_residual_sd,
  ROUND((100.0 * a.blowout_rate)::numeric, 2) AS blowout_rate_pct,
  ROUND(a.avg_attendance::numeric, 0) AS avg_attendance,
  CASE
    WHEN a.total_residual_sd IS NOT NULL
      AND sb.season_total_residual_sd IS NOT NULL
      AND a.total_residual_sd >= (sb.season_total_residual_sd * 1.15) THEN 'HIGH_VARIANCE'
    ELSE 'NORMAL_VARIANCE'
  END AS variance_environment_tag,
  8 AS min_games_threshold,
  (a.games >= 8) AS meets_sample_threshold,
  public.nba_context_exposure_tier(a.games, a.games, 8, 8) AS exposure_tier,
  NOW() AS updated_at
FROM aggregated a
CROSS JOIN season_baseline sb;

CREATE UNIQUE INDEX mv_nba_ref_environment_lead_ref_uidx
  ON public.mv_nba_ref_environment (lead_ref);

CREATE MATERIALIZED VIEW public.mv_nba_venue_environment AS
WITH base AS (
  SELECT DISTINCT ON (match_id)
    match_id,
    COALESCE(venue_name, 'Unknown Venue') AS venue_name,
    total_points,
    anchor_total,
    home_outcome,
    anchor_home_prob,
    home_margin,
    anchor_spread_home,
    combined_fouls,
    estimated_pace,
    blowout_flag,
    attendance
  FROM public.v_nba_probability_context_base
  WHERE venue_name IS NOT NULL
  ORDER BY match_id, probability_rank
),
season_baseline AS (
  SELECT
    AVG(combined_fouls) AS season_avg_combined_fouls,
    AVG(estimated_pace) AS season_avg_pace,
    STDDEV_POP(total_points - anchor_total) FILTER (WHERE anchor_total IS NOT NULL) AS season_total_residual_sd
  FROM base
),
aggregated AS (
  SELECT
    venue_name,
    COUNT(*)::integer AS games,
    AVG(combined_fouls) FILTER (WHERE combined_fouls IS NOT NULL) AS avg_combined_fouls,
    AVG(estimated_pace) FILTER (WHERE estimated_pace IS NOT NULL) AS avg_estimated_pace,
    AVG(total_points - anchor_total) FILTER (WHERE anchor_total IS NOT NULL) AS avg_total_residual_points,
    AVG(home_outcome - anchor_home_prob) FILTER (WHERE anchor_home_prob IS NOT NULL) AS avg_home_side_residual,
    AVG(home_margin + anchor_spread_home) FILTER (WHERE anchor_spread_home IS NOT NULL) AS avg_margin_residual_points,
    STDDEV_POP(total_points - anchor_total) FILTER (WHERE anchor_total IS NOT NULL) AS total_residual_sd,
    AVG(blowout_flag::integer::numeric) AS blowout_rate,
    AVG(attendance) FILTER (WHERE attendance IS NOT NULL) AS avg_attendance
  FROM base
  GROUP BY venue_name
)
SELECT
  a.venue_name,
  a.games,
  ROUND(a.avg_combined_fouls::numeric, 2) AS avg_combined_fouls,
  ROUND((a.avg_combined_fouls - sb.season_avg_combined_fouls)::numeric, 2) AS foul_delta_vs_baseline,
  ROUND(a.avg_estimated_pace::numeric, 2) AS avg_estimated_pace,
  ROUND((a.avg_estimated_pace - sb.season_avg_pace)::numeric, 2) AS pace_delta_vs_baseline,
  ROUND(a.avg_total_residual_points::numeric, 2) AS avg_total_residual_points,
  ROUND((100.0 * a.avg_home_side_residual)::numeric, 2) AS avg_home_side_residual_pp,
  ROUND(a.avg_margin_residual_points::numeric, 2) AS avg_margin_residual_points,
  ROUND(a.total_residual_sd::numeric, 2) AS total_residual_sd,
  ROUND((100.0 * a.blowout_rate)::numeric, 2) AS blowout_rate_pct,
  ROUND(a.avg_attendance::numeric, 0) AS avg_attendance,
  CASE
    WHEN a.total_residual_sd IS NOT NULL
      AND sb.season_total_residual_sd IS NOT NULL
      AND a.total_residual_sd >= (sb.season_total_residual_sd * 1.15) THEN 'HIGH_VARIANCE'
    ELSE 'NORMAL_VARIANCE'
  END AS variance_environment_tag,
  8 AS min_games_threshold,
  (a.games >= 8) AS meets_sample_threshold,
  public.nba_context_exposure_tier(a.games, a.games, 8, 8) AS exposure_tier,
  NOW() AS updated_at
FROM aggregated a
CROSS JOIN season_baseline sb;

CREATE UNIQUE INDEX mv_nba_venue_environment_venue_name_uidx
  ON public.mv_nba_venue_environment (venue_name);

CREATE OR REPLACE FUNCTION public.refresh_nba_context_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_nba_weekly_context;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_nba_live_state_context;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_nba_ref_environment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_nba_venue_environment;
END;
$$;

GRANT SELECT ON public.v_nba_probability_context_base TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_nba_weekly_context TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_nba_live_state_context TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_nba_ref_environment TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_nba_venue_environment TO anon, authenticated, service_role;
