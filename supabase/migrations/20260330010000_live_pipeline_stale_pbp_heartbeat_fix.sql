-- Ensure stale PBP heartbeat uses the latest of PBP event or live_state heartbeat.
-- This avoids false stale flags when play events are sparse but live state is still updating.

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
    COUNT(*)::INTEGER AS snapshot_count
  FROM public.live_odds_snapshots los
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
    ) = 1 AS has_recent_plays_state
  FROM public.live_game_state lgs
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
    (st.latest_live_state_at IS NOT NULL) AS has_live_state,
    st.latest_live_state_at,
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
  j.has_live_state,
  j.latest_live_state_at,
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

SELECT public.refresh_mv_live_pipeline_coverage_summary();
