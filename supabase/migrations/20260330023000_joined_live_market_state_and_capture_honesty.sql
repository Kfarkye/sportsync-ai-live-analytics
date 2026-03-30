-- Canonical joined live market/state timeline + honest native-vs-repair coverage classification.
-- This is collection/synchronization infrastructure for trustworthy first-touch and path studies.

CREATE INDEX IF NOT EXISTS idx_live_odds_snapshots_match_captured_source_market
  ON public.live_odds_snapshots (match_id, captured_at DESC, source, market_type);

CREATE INDEX IF NOT EXISTS idx_game_events_play_match_period_score_created
  ON public.game_events (match_id, event_type, period, home_score, away_score, created_at DESC)
  WHERE event_type = 'play';

CREATE INDEX IF NOT EXISTS idx_live_game_state_id_updated_at
  ON public.live_game_state (id, updated_at DESC);

DROP MATERIALIZED VIEW IF EXISTS public.mv_live_pipeline_coverage_summary CASCADE;
DROP VIEW IF EXISTS public.vw_live_pipeline_coverage CASCADE;

CREATE OR REPLACE VIEW public.vw_live_pipeline_coverage AS
WITH cfg AS (
  SELECT
    COALESCE(
      (SELECT snapshot_stale_seconds
       FROM public.live_pipeline_config
       WHERE is_active = true
       ORDER BY updated_at DESC, id DESC
       LIMIT 1),
      90
    ) AS snapshot_stale_seconds,
    COALESCE(
      (SELECT pbp_stale_seconds
       FROM public.live_pipeline_config
       WHERE is_active = true
       ORDER BY updated_at DESC, id DESC
       LIMIT 1),
      60
    ) AS pbp_stale_seconds
),
settings AS (
  SELECT
    ARRAY['recent_live_repair', 'backfill-historical-live-odds', 'ingest-live-games-recovery']::text[] AS repair_snapshot_sources,
    ARRAY['recent_live_repair', 'historical_backfill']::text[] AS repaired_market_types,
    ARRAY['provider_degradation']::text[] AS degraded_market_types,
    ARRAY['recent_live_repair', 'ingest-live-games-recovery']::text[] AS repair_state_sources
),
base_games AS (
  SELECT
    m.id AS match_id,
    COALESCE(m.league_id, 'unknown') AS league_id,
    COALESCE(m.sport, 'unknown') AS sport,
    m.start_time,
    COALESCE(m.status, 'STATUS_SCHEDULED') AS raw_status,
    CASE
      WHEN upper(COALESCE(m.status, '')) LIKE '%FINAL%'
        OR upper(COALESCE(m.status, '')) LIKE '%POST%'
        THEN 'FINAL'
      WHEN upper(COALESCE(m.status, '')) LIKE '%IN_PROGRESS%'
        OR upper(COALESCE(m.status, '')) LIKE '%LIVE%'
        OR upper(COALESCE(m.status, '')) LIKE '%HALF%'
        THEN 'IN_PROGRESS'
      ELSE 'SCHEDULED'
    END AS game_phase
  FROM public.matches m
  WHERE m.start_time >= now() - interval '7 days'
),
snapshot_stats AS (
  SELECT
    los.match_id,
    MIN(los.captured_at) AS first_snapshot_at,
    MAX(los.captured_at) AS latest_snapshot_at,
    COUNT(*)::INTEGER AS snapshot_count,
    BOOL_OR(
      COALESCE(los.source, '') <> ALL(st.repair_snapshot_sources)
      AND COALESCE(los.market_type, '') <> ALL(st.repaired_market_types)
      AND COALESCE(los.market_type, '') <> ALL(st.degraded_market_types)
    ) AS has_native_snapshot,
    BOOL_OR(
      COALESCE(los.source, '') = ANY(st.repair_snapshot_sources)
      OR COALESCE(los.market_type, '') = ANY(st.repaired_market_types)
    ) AS has_repaired_snapshot,
    BOOL_OR(
      COALESCE(los.market_type, '') = ANY(st.degraded_market_types)
      OR UPPER(COALESCE(los.provider, '')) LIKE 'DEGRADED%'
    ) AS has_degraded_snapshot,
    (ARRAY_AGG(COALESCE(los.source, 'unknown') ORDER BY los.captured_at DESC))[1] AS latest_snapshot_source
  FROM public.live_odds_snapshots los
  CROSS JOIN settings st
  WHERE los.captured_at >= now() - interval '7 days'
  GROUP BY los.match_id
),
state_stats AS (
  SELECT
    lgs.id AS match_id,
    MAX(lgs.updated_at) AS latest_live_state_at,
    MAX(
      CASE
        WHEN lgs.recent_plays IS NULL THEN 0
        WHEN jsonb_typeof(lgs.recent_plays) = 'array' AND jsonb_array_length(lgs.recent_plays) = 0 THEN 0
        ELSE 1
      END
    ) = 1 AS has_recent_plays_state,
    BOOL_OR(COALESCE(lgs.extra_data->>'capture_mode', 'native') = 'native') AS has_native_state,
    BOOL_OR(
      COALESCE(lgs.extra_data->>'capture_mode', '') = 'repair'
      OR COALESCE(lgs.extra_data->>'capture_source', '') = ANY(st.repair_state_sources)
    ) AS has_repaired_state,
    (ARRAY_AGG(COALESCE(lgs.extra_data->>'capture_source', 'unknown') ORDER BY lgs.updated_at DESC))[1] AS latest_state_source
  FROM public.live_game_state lgs
  CROSS JOIN settings st
  GROUP BY lgs.id
),
pbp_stats AS (
  SELECT
    ge.match_id,
    MAX(ge.created_at) AS latest_pbp_event_at,
    COUNT(*)::INTEGER AS pbp_count
  FROM public.game_events ge
  WHERE ge.event_type = 'play'
    AND ge.created_at >= now() - interval '7 days'
  GROUP BY ge.match_id
),
joined AS (
  SELECT
    g.match_id,
    g.league_id,
    g.sport,
    g.start_time,
    g.raw_status,
    g.game_phase,
    (g.game_phase <> 'SCHEDULED' OR g.start_time <= now() - interval '5 minutes') AS started,
    (g.game_phase = 'FINAL') AS final,
    COALESCE(s.snapshot_count, 0) > 0 AS has_live_odds_snapshot,
    s.first_snapshot_at,
    s.latest_snapshot_at,
    COALESCE(s.snapshot_count, 0) AS snapshot_count,
    COALESCE(s.has_native_snapshot, false) AS has_native_snapshot,
    COALESCE(s.has_repaired_snapshot, false) AS has_repaired_snapshot,
    COALESCE(s.has_degraded_snapshot, false) AS has_degraded_snapshot,
    s.latest_snapshot_source,
    (st.latest_live_state_at IS NOT NULL) AS has_live_state,
    st.latest_live_state_at,
    COALESCE(st.has_native_state, false) AS has_native_state,
    COALESCE(st.has_repaired_state, false) AS has_repaired_state,
    st.latest_state_source,
    (COALESCE(p.pbp_count, 0) > 0 OR COALESCE(st.has_recent_plays_state, false)) AS has_pbp,
    CASE
      WHEN p.latest_pbp_event_at IS NOT NULL AND st.latest_live_state_at IS NOT NULL
        THEN GREATEST(p.latest_pbp_event_at, st.latest_live_state_at)
      ELSE COALESCE(p.latest_pbp_event_at, st.latest_live_state_at)
    END AS latest_pbp_at,
    cfg.snapshot_stale_seconds,
    cfg.pbp_stale_seconds
  FROM base_games g
  LEFT JOIN snapshot_stats s ON s.match_id = g.match_id
  LEFT JOIN state_stats st ON st.match_id = g.match_id
  LEFT JOIN pbp_stats p ON p.match_id = g.match_id
  CROSS JOIN cfg
)
SELECT
  j.match_id,
  j.league_id,
  j.sport,
  j.start_time,
  j.raw_status,
  j.game_phase,
  j.started,
  j.final,
  j.has_live_odds_snapshot,
  j.first_snapshot_at,
  j.latest_snapshot_at,
  j.snapshot_count,
  j.has_native_snapshot,
  j.has_repaired_snapshot,
  j.has_degraded_snapshot,
  j.latest_snapshot_source,
  j.has_live_state,
  j.latest_live_state_at,
  j.has_native_state,
  j.has_repaired_state,
  j.latest_state_source,
  j.has_pbp,
  j.latest_pbp_at,
  CASE
    WHEN j.game_phase = 'IN_PROGRESS' AND j.latest_snapshot_at IS NOT NULL
      THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - j.latest_snapshot_at))::INTEGER)
    ELSE NULL
  END AS stale_seconds_snapshot,
  CASE
    WHEN j.game_phase = 'IN_PROGRESS' AND (j.has_live_state OR j.has_pbp) AND COALESCE(j.latest_pbp_at, j.latest_live_state_at) IS NOT NULL
      THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(j.latest_pbp_at, j.latest_live_state_at)))::INTEGER)
    ELSE NULL
  END AS stale_seconds_pbp,
  CASE
    WHEN j.started AND NOT j.has_live_odds_snapshot AND NOT j.has_live_state AND NOT j.has_pbp THEN 'MISSING_BOTH'
    WHEN j.started AND NOT j.has_live_odds_snapshot THEN 'MISSING_SNAPSHOT'
    WHEN j.started AND NOT (j.has_live_state OR j.has_pbp) THEN 'MISSING_PBP'
    WHEN j.game_phase = 'IN_PROGRESS'
      AND j.latest_snapshot_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - j.latest_snapshot_at))::INTEGER > j.snapshot_stale_seconds
      THEN 'STALE_SNAPSHOT'
    WHEN j.game_phase = 'IN_PROGRESS'
      AND COALESCE(j.latest_pbp_at, j.latest_live_state_at) IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - COALESCE(j.latest_pbp_at, j.latest_live_state_at)))::INTEGER > j.pbp_stale_seconds
      THEN 'STALE_PBP'
    ELSE 'OK'
  END AS coverage_status
FROM joined j;

GRANT SELECT ON public.vw_live_pipeline_coverage TO anon, authenticated, service_role;

CREATE MATERIALIZED VIEW public.mv_live_pipeline_coverage_summary AS
SELECT
  sport,
  league_id,
  COUNT(*)::INTEGER AS total_games,
  COUNT(*) FILTER (WHERE started)::INTEGER AS started_games,
  COUNT(*) FILTER (WHERE game_phase = 'IN_PROGRESS')::INTEGER AS in_progress_games,
  COUNT(*) FILTER (WHERE final)::INTEGER AS final_games,
  COUNT(*) FILTER (WHERE started AND has_live_odds_snapshot)::INTEGER AS started_with_snapshot,
  COUNT(*) FILTER (WHERE started AND has_native_snapshot)::INTEGER AS started_with_native_snapshot,
  COUNT(*) FILTER (WHERE started AND has_repaired_snapshot)::INTEGER AS started_with_repaired_snapshot,
  COUNT(*) FILTER (WHERE started AND has_degraded_snapshot)::INTEGER AS started_with_degraded_snapshot,
  COUNT(*) FILTER (WHERE started AND (has_live_state OR has_pbp))::INTEGER AS started_with_pbp_or_state,
  COUNT(*) FILTER (WHERE started AND has_live_state)::INTEGER AS started_with_live_state,
  COUNT(*) FILTER (WHERE started AND has_native_state)::INTEGER AS started_with_native_state,
  COUNT(*) FILTER (WHERE started AND has_repaired_state)::INTEGER AS started_with_repaired_state,
  COUNT(*) FILTER (WHERE started AND has_pbp)::INTEGER AS started_with_pbp,
  COUNT(*) FILTER (WHERE started AND NOT has_native_snapshot AND has_repaired_snapshot)::INTEGER AS games_snapshot_only_repair,
  COUNT(*) FILTER (WHERE started AND NOT has_native_state AND has_repaired_state)::INTEGER AS games_state_only_repair,
  COUNT(*) FILTER (WHERE coverage_status = 'MISSING_SNAPSHOT')::INTEGER AS missing_snapshot_games,
  COUNT(*) FILTER (WHERE coverage_status = 'MISSING_PBP')::INTEGER AS missing_pbp_games,
  COUNT(*) FILTER (WHERE coverage_status = 'MISSING_BOTH')::INTEGER AS missing_both_games,
  COUNT(*) FILTER (WHERE coverage_status = 'STALE_SNAPSHOT')::INTEGER AS stale_snapshot_games,
  COUNT(*) FILTER (WHERE coverage_status = 'STALE_PBP')::INTEGER AS stale_pbp_games,
  COUNT(*) FILTER (WHERE coverage_status = 'OK')::INTEGER AS ok_games,
  CASE
    WHEN COUNT(*) FILTER (WHERE started) > 0
      THEN ROUND(
        100.0 * COUNT(*) FILTER (WHERE started AND has_live_odds_snapshot)
        / COUNT(*) FILTER (WHERE started),
        2
      )
    ELSE 100.0
  END AS snapshot_coverage_pct,
  CASE
    WHEN COUNT(*) FILTER (WHERE started) > 0
      THEN ROUND(
        100.0 * COUNT(*) FILTER (WHERE started AND has_native_snapshot)
        / COUNT(*) FILTER (WHERE started),
        2
      )
    ELSE 100.0
  END AS native_snapshot_coverage_pct,
  CASE
    WHEN COUNT(*) FILTER (WHERE started) > 0
      THEN ROUND(
        100.0 * COUNT(*) FILTER (WHERE started AND (has_live_state OR has_pbp))
        / COUNT(*) FILTER (WHERE started),
        2
      )
    ELSE 100.0
  END AS pbp_state_coverage_pct,
  CASE
    WHEN COUNT(*) FILTER (WHERE started) > 0
      THEN ROUND(
        100.0 * COUNT(*) FILTER (WHERE started AND has_native_state)
        / COUNT(*) FILTER (WHERE started),
        2
      )
    ELSE 100.0
  END AS native_state_coverage_pct,
  now() AS refreshed_at
FROM public.vw_live_pipeline_coverage
GROUP BY sport, league_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_live_pipeline_coverage_summary_pk
  ON public.mv_live_pipeline_coverage_summary (sport, league_id);

GRANT SELECT ON public.mv_live_pipeline_coverage_summary TO anon, authenticated, service_role;

DROP VIEW IF EXISTS public.vw_joined_live_market_state CASCADE;
CREATE OR REPLACE VIEW public.vw_joined_live_market_state AS
WITH snapshots AS (
  SELECT
    los.id AS snapshot_id,
    los.match_id,
    COALESCE(NULLIF(los.sport, ''), NULLIF(m.sport, ''), NULLIF(lgs.sport, ''), 'unknown') AS sport,
    COALESCE(NULLIF(los.league_id, ''), NULLIF(m.league_id, ''), NULLIF(lgs.league_id, ''), 'unknown') AS league_id,
    los.captured_at,
    los.provider,
    los.market_type,
    los.total,
    los.over_price,
    los.under_price,
    los.spread_home,
    los.spread_away,
    los.home_ml,
    los.away_ml,
    los.period AS snap_period,
    los.clock AS snap_clock,
    los.home_score AS snap_home_score,
    los.away_score AS snap_away_score,
    COALESCE(los.status, m.status, lgs.game_status, 'STATUS_UNKNOWN') AS snap_status
  FROM public.live_odds_snapshots los
  LEFT JOIN public.matches m ON m.id = los.match_id
  LEFT JOIN public.live_game_state lgs ON lgs.id = los.match_id
),
aligned AS (
  SELECT
    s.*,
    st.updated_at AS state_updated_at,
    st.period AS state_period,
    st.clock AS state_clock,
    st.home_score AS state_home_score,
    st.away_score AS state_away_score,
    st.game_status AS state_game_status,
    exact_play.created_at AS exact_play_at,
    exact_play.period AS exact_play_period,
    exact_play.clock AS exact_play_clock,
    exact_play.home_score AS exact_play_home_score,
    exact_play.away_score AS exact_play_away_score,
    near_play.created_at AS near_play_at,
    near_play.period AS near_play_period,
    near_play.clock AS near_play_clock,
    near_play.home_score AS near_play_home_score,
    near_play.away_score AS near_play_away_score,
    COALESCE(nearby.pbp_event_count_nearby, 0) AS pbp_event_count_nearby
  FROM snapshots s
  LEFT JOIN public.live_game_state st
    ON st.id = s.match_id
  LEFT JOIN LATERAL (
    SELECT
      ge.created_at,
      ge.period,
      ge.clock,
      ge.home_score,
      ge.away_score
    FROM public.game_events ge
    WHERE ge.match_id = s.match_id
      AND ge.event_type = 'play'
      AND ge.period IS NOT DISTINCT FROM s.snap_period
      AND ge.home_score IS NOT DISTINCT FROM s.snap_home_score
      AND ge.away_score IS NOT DISTINCT FROM s.snap_away_score
    ORDER BY ABS(EXTRACT(EPOCH FROM (ge.created_at - s.captured_at))) ASC
    LIMIT 1
  ) exact_play ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      ge.created_at,
      ge.period,
      ge.clock,
      ge.home_score,
      ge.away_score
    FROM public.game_events ge
    WHERE ge.match_id = s.match_id
      AND ge.event_type = 'play'
    ORDER BY ABS(EXTRACT(EPOCH FROM (ge.created_at - s.captured_at))) ASC
    LIMIT 1
  ) near_play ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS pbp_event_count_nearby
    FROM public.game_events ge
    WHERE ge.match_id = s.match_id
      AND ge.event_type = 'play'
      AND ge.created_at BETWEEN s.captured_at - interval '120 seconds' AND s.captured_at + interval '120 seconds'
  ) nearby ON TRUE
)
SELECT
  a.match_id,
  a.sport,
  a.league_id,
  a.captured_at,
  a.provider,
  a.market_type,
  a.total,
  a.over_price,
  a.under_price,
  a.spread_home AS spread_home,
  a.spread_away AS spread_away,
  a.home_ml,
  a.away_ml,
  CASE
    WHEN a.exact_play_at IS NOT NULL THEN a.exact_play_period
    WHEN a.near_play_at IS NOT NULL THEN a.near_play_period
    WHEN a.state_updated_at IS NOT NULL THEN a.state_period
    ELSE a.snap_period
  END AS period,
  CASE
    WHEN a.exact_play_at IS NOT NULL THEN a.exact_play_clock
    WHEN a.near_play_at IS NOT NULL THEN a.near_play_clock
    WHEN a.state_updated_at IS NOT NULL THEN a.state_clock
    ELSE a.snap_clock
  END AS clock,
  CASE
    WHEN a.exact_play_at IS NOT NULL THEN a.exact_play_home_score
    WHEN a.near_play_at IS NOT NULL THEN a.near_play_home_score
    WHEN a.state_updated_at IS NOT NULL THEN a.state_home_score
    ELSE a.snap_home_score
  END AS home_score,
  CASE
    WHEN a.exact_play_at IS NOT NULL THEN a.exact_play_away_score
    WHEN a.near_play_at IS NOT NULL THEN a.near_play_away_score
    WHEN a.state_updated_at IS NOT NULL THEN a.state_away_score
    ELSE a.snap_away_score
  END AS away_score,
  COALESCE(a.state_game_status, a.snap_status, 'STATUS_UNKNOWN') AS game_status,
  a.pbp_event_count_nearby,
  CASE
    WHEN a.exact_play_at IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (a.exact_play_at - a.captured_at))) <= 45
      THEN 'exact'
    WHEN a.exact_play_at IS NOT NULL
      THEN 'state_aligned'
    WHEN a.near_play_at IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (a.near_play_at - a.captured_at))) <= 120
      THEN 'near_timestamp'
    WHEN a.state_updated_at IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (a.state_updated_at - a.captured_at))) <= 180
      AND a.state_period IS NOT DISTINCT FROM a.snap_period
      THEN 'state_aligned'
    WHEN a.state_updated_at IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (a.state_updated_at - a.captured_at))) <= 180
      THEN 'near_timestamp'
    WHEN a.near_play_at IS NOT NULL
      THEN 'near_timestamp'
    ELSE 'degraded'
  END AS join_quality,
  CASE
    WHEN a.exact_play_at IS NOT NULL THEN 'play_score_period'
    WHEN a.near_play_at IS NOT NULL THEN 'play_nearest_timestamp'
    WHEN a.state_updated_at IS NOT NULL THEN 'live_state_nearest'
    ELSE 'snapshot_fallback'
  END AS join_method
FROM aligned a;

GRANT SELECT ON public.vw_joined_live_market_state TO anon, authenticated, service_role;

DROP MATERIALIZED VIEW IF EXISTS public.mv_joined_live_market_state_summary CASCADE;
CREATE MATERIALIZED VIEW public.mv_joined_live_market_state_summary AS
SELECT
  sport,
  league_id,
  COUNT(*)::INTEGER AS joined_rows,
  COUNT(*) FILTER (WHERE join_quality = 'exact')::INTEGER AS exact_rows,
  COUNT(*) FILTER (WHERE join_quality = 'state_aligned')::INTEGER AS state_aligned_rows,
  COUNT(*) FILTER (WHERE join_quality = 'near_timestamp')::INTEGER AS near_timestamp_rows,
  COUNT(*) FILTER (WHERE join_quality = 'degraded')::INTEGER AS degraded_rows,
  COUNT(*) FILTER (WHERE total IS NOT NULL)::INTEGER AS rows_with_total,
  MIN(captured_at) AS earliest_captured_at,
  MAX(captured_at) AS latest_captured_at,
  now() AS refreshed_at
FROM public.vw_joined_live_market_state
GROUP BY sport, league_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_joined_live_market_state_summary_pk
  ON public.mv_joined_live_market_state_summary (sport, league_id);

GRANT SELECT ON public.mv_joined_live_market_state_summary TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_mv_joined_live_market_state_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.mv_joined_live_market_state_summary;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_mv_live_pipeline_coverage_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.mv_live_pipeline_coverage_summary;
  PERFORM public.refresh_mv_joined_live_market_state_summary();
END;
$$;

SELECT public.refresh_mv_live_pipeline_coverage_summary();
