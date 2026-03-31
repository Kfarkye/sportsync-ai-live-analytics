-- Live Pipeline Production Truth Pack
-- Purpose:
--   One copy-paste pack for post-deploy production validation of the live-path layer.
--   This pack is intentionally binary: cron wiring, runtime freshness, SLO breaches,
--   final-game leakage, active-game leakage, and join drift.
--
-- Run cadence:
--   1) Right after deploy
--   2) During the live slate
--   3) 30-45 minutes after the main games finish
--
-- Notes:
--   - This pack uses current repo surfaces only.
--   - "Final older than 30 minutes" uses the latest of matches.updated_at and
--     matches.last_updated as the production proxy for final-status recency
--     because coverage views do not currently expose a
--     finalized_at field directly.

-- 0) Threshold and expected-baseline ledger
SELECT *
FROM (
  VALUES
    ('cron', 'high-frequency-live-ingest', '* * * * *', 'P1', 'missing/inactive/schedule drift is page-worthy'),
    ('cron', 'live-history-janitor-every-10-min', '*/10 * * * *', 'P1', 'missing/inactive/schedule drift is page-worthy'),
    ('cron', 'live-rolling-historical-closure-every-20-min', '*/20 * * * *', 'P1', 'missing/inactive/schedule drift is page-worthy'),
    ('cron', 'drain-espn-probs', '*/2 * * * *', 'P2', 'schedule drift matters, but this is not core live-path paging'),
    ('runtime', 'ingest-live-games', '<= 5m since last run', 'P1', 'heartbeat must stay hot'),
    ('runtime', 'history-janitor', '<= 20m since last run', 'P1', 'same-slate closure cannot fall behind'),
    ('runtime', 'backfill-historical-live-odds:rolling_historical_closure', '<= 40m since last run', 'P1', 'repair path cannot go cold'),
    ('runtime', 'core_latest_status', 'latest status != failed', 'P1', 'fresh cadence alone is not enough if the latest core run is red'),
    ('alert', 'finals_clean', '0 rows', 'P1', 'final games older than 30m must be clean'),
    ('alert', 'active_slo_breach', '0 rows', 'P1', 'active leagues cannot be in breach'),
    ('alert', 'active_non_ok_coverage', '0 rows in SLO-enforced leagues', 'P2', 'investigate immediately during the slate'),
    ('alert', 'join_drift_warn', 'degraded_pct >= 10', 'P2', 'join quality is slipping'),
    ('alert', 'join_drift_page', 'degraded_pct >= 20', 'P1', 'join quality is materially broken')
) AS thresholds(check_type, subject, expected_value, alert_severity, reason)
ORDER BY check_type, subject;

-- 1) Current live-path config and SLO config
SELECT
  'live_pipeline_config' AS config_name,
  is_active,
  snapshot_stale_seconds,
  pbp_stale_seconds,
  updated_at
FROM public.live_pipeline_config
WHERE is_active = true
ORDER BY updated_at DESC, id DESC
LIMIT 1;

SELECT
  'live_pipeline_slo_config' AS config_name,
  is_active,
  window_minutes,
  min_snapshot_coverage_pct,
  min_state_coverage_pct,
  min_pbp_coverage_pct,
  max_missing_games,
  max_stale_games,
  updated_at
FROM public.live_pipeline_slo_config
WHERE is_active = true
ORDER BY updated_at DESC, id DESC
LIMIT 1;

-- 2) Strict cron baseline diff
WITH expected_cron AS (
  SELECT *
  FROM (
    VALUES
      ('high-frequency-live-ingest', '* * * * *', 'invoke_ingest_live_games', 'P1'),
      ('live-history-janitor-every-10-min', '*/10 * * * *', 'invoke_history_janitor', 'P1'),
      ('live-rolling-historical-closure-every-20-min', '*/20 * * * *', 'invoke_rolling_historical_live_closure', 'P1'),
      ('drain-espn-probs', '*/2 * * * *', 'drain-espn-probabilities', 'P2')
  ) AS t(jobname, expected_schedule, expected_command_substring, alert_severity)
)
SELECT
  e.jobname,
  e.expected_schedule,
  j.schedule AS actual_schedule,
  e.expected_command_substring,
  j.command AS actual_command,
  j.active,
  e.alert_severity,
  CASE
    WHEN j.jobname IS NULL THEN 'MISSING'
    WHEN COALESCE(j.active, false) = false THEN 'INACTIVE'
    WHEN j.schedule IS DISTINCT FROM e.expected_schedule THEN 'SCHEDULE_DRIFT'
    WHEN POSITION(e.expected_command_substring IN COALESCE(j.command, '')) = 0 THEN 'COMMAND_DRIFT'
    ELSE 'OK'
  END AS baseline_status
FROM expected_cron e
LEFT JOIN cron.job j
  ON j.jobname = e.jobname
ORDER BY
  CASE
    WHEN j.jobname IS NULL THEN 0
    WHEN COALESCE(j.active, false) = false THEN 1
    WHEN j.schedule IS DISTINCT FROM e.expected_schedule THEN 2
    WHEN POSITION(e.expected_command_substring IN COALESCE(j.command, '')) = 0 THEN 3
    ELSE 4
  END,
  e.jobname;

-- 3) Runtime freshness against paging thresholds
WITH expected_runtime AS (
  SELECT *
  FROM (
    VALUES
      ('ingest-live-games', NULL::text, 5, 'P1'),
      ('history-janitor', NULL::text, 20, 'P1'),
      ('backfill-historical-live-odds', 'rolling_historical_closure', 40, 'P1')
  ) AS t(function_name, mode, max_age_minutes, alert_severity)
),
latest_runtime AS (
  SELECT
    l.function_name,
    NULLIF(COALESCE(l.metadata->>'mode', ''), '') AS mode,
    MAX(l.created_at) AS last_run_at,
    (ARRAY_AGG(l.status ORDER BY l.created_at DESC))[1] AS latest_status,
    MAX(l.created_at) FILTER (
      WHERE lower(COALESCE(l.status, '')) IN ('succeeded', 'replayed')
    ) AS last_success_at
  FROM public.live_pipeline_reliability_logs l
  WHERE l.created_at >= now() - interval '24 hours'
  GROUP BY l.function_name, NULLIF(COALESCE(l.metadata->>'mode', ''), '')
)
SELECT
  e.function_name,
  e.mode,
  e.max_age_minutes,
  e.alert_severity,
  r.last_run_at,
  r.latest_status,
  r.last_success_at,
  ROUND(EXTRACT(EPOCH FROM (now() - r.last_run_at)) / 60.0, 2) AS minutes_since_last_run,
  ROUND(EXTRACT(EPOCH FROM (now() - r.last_success_at)) / 60.0, 2) AS minutes_since_last_success,
  CASE
    WHEN r.last_run_at IS NULL THEN 'MISSING'
    WHEN lower(COALESCE(r.latest_status, '')) = 'failed' THEN 'FAILED'
    WHEN r.last_run_at < now() - make_interval(mins => e.max_age_minutes) THEN 'STALE'
    ELSE 'OK'
  END AS freshness_status
FROM expected_runtime e
LEFT JOIN latest_runtime r
  ON r.function_name = e.function_name
 AND r.mode IS NOT DISTINCT FROM e.mode
ORDER BY
  CASE
    WHEN r.last_run_at IS NULL THEN 0
    WHEN lower(COALESCE(r.latest_status, '')) = 'failed' THEN 1
    WHEN r.last_run_at < now() - make_interval(mins => e.max_age_minutes) THEN 2
    ELSE 3
  END,
  e.function_name,
  e.mode;

-- 4) Active league SLO state
SELECT
  sport,
  league_id,
  started_games,
  required_snapshot_games,
  covered_snapshot_games,
  required_state_games,
  covered_state_games,
  required_pbp_games,
  covered_pbp_games,
  missing_required_games,
  stale_required_games,
  snapshot_coverage_pct,
  state_coverage_pct,
  pbp_coverage_pct,
  slo_breach,
  breach_reasons
FROM public.vw_live_pipeline_slo_current
WHERE started_games > 0
ORDER BY slo_breach DESC, sport, league_id;

-- 5) Finals older than 30 minutes that are still not clean
SELECT
  v.match_id,
  v.sport,
  v.league_id,
  m.home_team,
  m.away_team,
  m.updated_at,
  v.start_time,
  v.raw_status,
  v.coverage_status,
  v.latest_snapshot_source,
  v.latest_state_source,
  v.has_live_odds_snapshot,
  v.has_live_state,
  v.has_pbp
FROM public.vw_live_pipeline_coverage v
JOIN public.matches m
  ON m.id = v.match_id
JOIN public.live_pipeline_capabilities c
  ON c.league_id = v.league_id
 AND c.sport = v.sport
 AND c.is_active = true
 AND c.slo_enforced = true
WHERE v.final = true
  AND GREATEST(COALESCE(m.updated_at, v.start_time), COALESCE(m.last_updated, v.start_time)) <= now() - interval '30 minutes'
  AND v.coverage_status <> 'OK'
ORDER BY GREATEST(COALESCE(m.updated_at, v.start_time), COALESCE(m.last_updated, v.start_time)) DESC, v.sport, v.league_id;

-- 6) In-progress games with active leakage
SELECT
  v.match_id,
  v.sport,
  v.league_id,
  m.home_team,
  m.away_team,
  v.start_time,
  v.raw_status,
  v.coverage_status,
  v.latest_snapshot_source,
  v.latest_state_source,
  v.stale_seconds_snapshot,
  v.stale_seconds_pbp
FROM public.vw_live_pipeline_coverage v
JOIN public.matches m
  ON m.id = v.match_id
JOIN public.live_pipeline_capabilities c
  ON c.league_id = v.league_id
 AND c.sport = v.sport
 AND c.is_active = true
 AND c.slo_enforced = true
WHERE v.game_phase = 'IN_PROGRESS'
  AND v.coverage_status <> 'OK'
ORDER BY v.sport, v.league_id, v.start_time DESC;

-- 7) Join drift by league for the last 2 hours
WITH join_health AS (
  SELECT
    j.sport,
    j.league_id,
    COUNT(*)::INTEGER AS joined_rows,
    COUNT(*) FILTER (WHERE j.join_quality = 'exact')::INTEGER AS exact_rows,
    COUNT(*) FILTER (WHERE j.join_quality = 'state_aligned')::INTEGER AS state_aligned_rows,
    COUNT(*) FILTER (WHERE j.join_quality = 'near_timestamp')::INTEGER AS near_timestamp_rows,
    COUNT(*) FILTER (WHERE j.join_quality = 'degraded')::INTEGER AS degraded_rows,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE j.join_quality = 'degraded')
      / NULLIF(COUNT(*), 0),
      2
    ) AS degraded_pct
  FROM public.vw_joined_live_market_state j
  JOIN public.live_pipeline_capabilities c
    ON c.league_id = j.league_id
   AND c.sport = j.sport
   AND c.is_active = true
   AND c.slo_enforced = true
  WHERE j.captured_at >= now() - interval '2 hours'
  GROUP BY j.sport, j.league_id
)
SELECT
  sport,
  league_id,
  joined_rows,
  exact_rows,
  state_aligned_rows,
  near_timestamp_rows,
  degraded_rows,
  degraded_pct,
  CASE
    WHEN degraded_pct >= 20 THEN 'P1'
    WHEN degraded_pct >= 10 THEN 'P2'
    ELSE 'OK'
  END AS drift_severity
FROM join_health
ORDER BY
  CASE
    WHEN degraded_pct >= 20 THEN 0
    WHEN degraded_pct >= 10 THEN 1
    ELSE 2
  END,
  degraded_pct DESC NULLS LAST,
  sport,
  league_id;

-- 8) Unified alert deck for paging / incident triage
WITH expected_cron AS (
  SELECT *
  FROM (
    VALUES
      ('high-frequency-live-ingest', '* * * * *', 'invoke_ingest_live_games', 'P1'),
      ('live-history-janitor-every-10-min', '*/10 * * * *', 'invoke_history_janitor', 'P1'),
      ('live-rolling-historical-closure-every-20-min', '*/20 * * * *', 'invoke_rolling_historical_live_closure', 'P1'),
      ('drain-espn-probs', '*/2 * * * *', 'drain-espn-probabilities', 'P2')
  ) AS t(jobname, expected_schedule, expected_command_substring, severity)
),
cron_issues AS (
  SELECT
    e.severity,
    'cron_baseline' AS alert_family,
    e.jobname AS subject,
    CASE
      WHEN j.jobname IS NULL THEN 'missing'
      WHEN COALESCE(j.active, false) = false THEN 'inactive'
      WHEN j.schedule IS DISTINCT FROM e.expected_schedule THEN 'schedule_drift'
      WHEN POSITION(e.expected_command_substring IN COALESCE(j.command, '')) = 0 THEN 'command_drift'
      ELSE NULL
    END AS alert_code,
    jsonb_build_object(
      'expected_schedule', e.expected_schedule,
      'actual_schedule', j.schedule,
      'active', j.active,
      'expected_command_substring', e.expected_command_substring,
      'actual_command', j.command
    ) AS details
  FROM expected_cron e
  LEFT JOIN cron.job j
    ON j.jobname = e.jobname
  WHERE j.jobname IS NULL
     OR COALESCE(j.active, false) = false
     OR j.schedule IS DISTINCT FROM e.expected_schedule
     OR POSITION(e.expected_command_substring IN COALESCE(j.command, '')) = 0
),
expected_runtime AS (
  SELECT *
  FROM (
    VALUES
      ('ingest-live-games', NULL::text, 5, 'P1'),
      ('history-janitor', NULL::text, 20, 'P1'),
      ('backfill-historical-live-odds', 'rolling_historical_closure', 40, 'P1')
  ) AS t(function_name, mode, max_age_minutes, severity)
),
latest_runtime AS (
  SELECT
    l.function_name,
    NULLIF(COALESCE(l.metadata->>'mode', ''), '') AS mode,
    MAX(l.created_at) AS last_run_at,
    (ARRAY_AGG(l.status ORDER BY l.created_at DESC))[1] AS latest_status,
    MAX(l.created_at) FILTER (
      WHERE lower(COALESCE(l.status, '')) IN ('succeeded', 'replayed')
    ) AS last_success_at
  FROM public.live_pipeline_reliability_logs l
  WHERE l.created_at >= now() - interval '24 hours'
  GROUP BY l.function_name, NULLIF(COALESCE(l.metadata->>'mode', ''), '')
),
runtime_issues AS (
  SELECT
    e.severity,
    'runtime_freshness' AS alert_family,
    e.function_name || COALESCE(':' || e.mode, '') AS subject,
    CASE
      WHEN r.last_run_at IS NULL THEN 'missing_runtime'
      WHEN lower(COALESCE(r.latest_status, '')) = 'failed' THEN 'latest_failed'
      WHEN r.last_run_at < now() - make_interval(mins => e.max_age_minutes) THEN 'stale_runtime'
      ELSE NULL
    END AS alert_code,
    jsonb_build_object(
      'max_age_minutes', e.max_age_minutes,
      'last_run_at', r.last_run_at,
      'latest_status', r.latest_status,
      'last_success_at', r.last_success_at
    ) AS details
  FROM expected_runtime e
  LEFT JOIN latest_runtime r
    ON r.function_name = e.function_name
   AND r.mode IS NOT DISTINCT FROM e.mode
  WHERE r.last_run_at IS NULL
     OR lower(COALESCE(r.latest_status, '')) = 'failed'
     OR r.last_run_at < now() - make_interval(mins => e.max_age_minutes)
),
slo_issues AS (
  SELECT
    'P1' AS severity,
    'league_slo' AS alert_family,
    sport || ':' || league_id AS subject,
    'slo_breach' AS alert_code,
    jsonb_build_object(
      'started_games', started_games,
      'missing_required_games', missing_required_games,
      'stale_required_games', stale_required_games,
      'snapshot_coverage_pct', snapshot_coverage_pct,
      'state_coverage_pct', state_coverage_pct,
      'pbp_coverage_pct', pbp_coverage_pct,
      'breach_reasons', breach_reasons
    ) AS details
  FROM public.vw_live_pipeline_slo_current
  WHERE started_games > 0
    AND slo_breach = true
),
final_issues AS (
  SELECT
    'P1' AS severity,
    'final_cleanliness' AS alert_family,
    v.match_id AS subject,
    'final_not_clean' AS alert_code,
    jsonb_build_object(
      'sport', v.sport,
      'league_id', v.league_id,
      'home_team', m.home_team,
      'away_team', m.away_team,
      'updated_at', m.updated_at,
      'coverage_status', v.coverage_status,
      'latest_snapshot_source', v.latest_snapshot_source,
      'latest_state_source', v.latest_state_source
    ) AS details
  FROM public.vw_live_pipeline_coverage v
  JOIN public.matches m
    ON m.id = v.match_id
  JOIN public.live_pipeline_capabilities c
    ON c.league_id = v.league_id
   AND c.sport = v.sport
   AND c.is_active = true
   AND c.slo_enforced = true
  WHERE v.final = true
    AND GREATEST(COALESCE(m.updated_at, v.start_time), COALESCE(m.last_updated, v.start_time)) <= now() - interval '30 minutes'
    AND v.coverage_status <> 'OK'
),
active_issues AS (
  SELECT
    'P2' AS severity,
    'active_coverage' AS alert_family,
    v.match_id AS subject,
    'active_non_ok' AS alert_code,
    jsonb_build_object(
      'sport', v.sport,
      'league_id', v.league_id,
      'home_team', m.home_team,
      'away_team', m.away_team,
      'coverage_status', v.coverage_status,
      'stale_seconds_snapshot', v.stale_seconds_snapshot,
      'stale_seconds_pbp', v.stale_seconds_pbp
    ) AS details
  FROM public.vw_live_pipeline_coverage v
  JOIN public.matches m
    ON m.id = v.match_id
  JOIN public.live_pipeline_capabilities c
    ON c.league_id = v.league_id
   AND c.sport = v.sport
   AND c.is_active = true
   AND c.slo_enforced = true
  WHERE v.game_phase = 'IN_PROGRESS'
    AND v.coverage_status <> 'OK'
),
join_health AS (
  SELECT
    j.sport,
    j.league_id,
    COUNT(*)::INTEGER AS joined_rows,
    COUNT(*) FILTER (WHERE j.join_quality = 'degraded')::INTEGER AS degraded_rows,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE j.join_quality = 'degraded')
      / NULLIF(COUNT(*), 0),
      2
    ) AS degraded_pct
  FROM public.vw_joined_live_market_state j
  JOIN public.live_pipeline_capabilities c
    ON c.league_id = j.league_id
   AND c.sport = j.sport
   AND c.is_active = true
   AND c.slo_enforced = true
  WHERE j.captured_at >= now() - interval '2 hours'
  GROUP BY j.sport, j.league_id
),
join_issues AS (
  SELECT
    CASE
      WHEN degraded_pct >= 20 THEN 'P1'
      ELSE 'P2'
    END AS severity,
    'join_drift' AS alert_family,
    sport || ':' || league_id AS subject,
    CASE
      WHEN degraded_pct >= 20 THEN 'join_drift_page'
      ELSE 'join_drift_warn'
    END AS alert_code,
    jsonb_build_object(
      'joined_rows', joined_rows,
      'degraded_rows', degraded_rows,
      'degraded_pct', degraded_pct
    ) AS details
  FROM join_health
  WHERE degraded_pct >= 10
)
SELECT
  severity,
  alert_family,
  subject,
  alert_code,
  details
FROM (
  SELECT * FROM cron_issues
  UNION ALL
  SELECT * FROM runtime_issues
  UNION ALL
  SELECT * FROM slo_issues
  UNION ALL
  SELECT * FROM final_issues
  UNION ALL
  SELECT * FROM active_issues
  UNION ALL
  SELECT * FROM join_issues
) alerts
ORDER BY
  CASE severity
    WHEN 'P1' THEN 1
    WHEN 'P2' THEN 2
    WHEN 'P3' THEN 3
    ELSE 4
  END,
  alert_family,
  subject;
