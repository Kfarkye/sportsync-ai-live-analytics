-- Live pipeline verification pack
-- Run after deploying live collection/reliability migrations and functions.

-- 1) Sport/league started-game coverage + native vs repaired (last 48h)
SELECT
  sport,
  league_id,
  COUNT(*) FILTER (WHERE started) AS started_games,
  COUNT(*) FILTER (WHERE started AND has_live_odds_snapshot) AS started_with_snapshot,
  COUNT(*) FILTER (WHERE started AND has_native_snapshot) AS started_with_native_snapshot,
  COUNT(*) FILTER (WHERE started AND has_repaired_snapshot) AS started_with_repaired_snapshot,
  COUNT(*) FILTER (WHERE started AND (has_live_state OR has_pbp)) AS started_with_pbp_or_state,
  COUNT(*) FILTER (WHERE started AND has_live_state) AS started_with_live_state,
  COUNT(*) FILTER (WHERE started AND has_native_state) AS started_with_native_state,
  COUNT(*) FILTER (WHERE started AND has_repaired_state) AS started_with_repaired_state,
  COUNT(*) FILTER (WHERE started AND has_degraded_snapshot) AS started_with_degraded_snapshot,
  COUNT(*) FILTER (WHERE coverage_status = 'MISSING_BOTH') AS missing_both,
  COUNT(*) FILTER (WHERE coverage_status = 'MISSING_SNAPSHOT') AS missing_snapshot,
  COUNT(*) FILTER (WHERE coverage_status = 'MISSING_PBP') AS missing_pbp,
  COUNT(*) FILTER (WHERE coverage_status = 'STALE_SNAPSHOT') AS stale_snapshot,
  COUNT(*) FILTER (WHERE coverage_status = 'STALE_PBP') AS stale_pbp,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE started AND has_live_odds_snapshot)
    / NULLIF(COUNT(*) FILTER (WHERE started), 0),
    2
  ) AS snapshot_coverage_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE started AND has_native_snapshot)
    / NULLIF(COUNT(*) FILTER (WHERE started), 0),
    2
  ) AS native_snapshot_coverage_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE started AND (has_live_state OR has_pbp))
    / NULLIF(COUNT(*) FILTER (WHERE started), 0),
    2
  ) AS pbp_state_coverage_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE started AND has_native_state)
    / NULLIF(COUNT(*) FILTER (WHERE started), 0),
    2
  ) AS native_state_coverage_pct
FROM public.vw_live_pipeline_coverage
WHERE start_time >= now() - interval '48 hours'
  AND sport IN ('basketball', 'baseball', 'icehockey', 'americanfootball', 'soccer', 'tennis')
GROUP BY sport, league_id
ORDER BY sport, league_id;

-- 1b) Capability matrix (what each league is expected to provide)
SELECT
  sport,
  league_id,
  live_odds_supported,
  live_state_supported,
  pbp_supported,
  auto_recovery_enabled,
  slo_enforced,
  is_active,
  notes
FROM public.live_pipeline_capabilities
WHERE is_active = true
ORDER BY sport, league_id;

-- 1c) Current SLO status by league (window + breaches)
SELECT
  sport,
  league_id,
  window_minutes,
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

-- 2) Missing/stale games in current window (focus sports)
SELECT
  sport,
  league_id,
  match_id,
  start_time,
  game_phase,
  coverage_status,
  latest_snapshot_source,
  latest_state_source,
  stale_seconds_snapshot,
  stale_seconds_pbp
FROM public.vw_live_pipeline_coverage
WHERE start_time >= now() - interval '24 hours'
  AND started
  AND (
    league_id IN ('nba', 'mlb', 'nhl', 'nfl')
    OR sport = 'soccer'
  )
  AND coverage_status <> 'OK'
ORDER BY sport, league_id, start_time DESC;

-- 3) Earliest available live snapshot depth by sport
SELECT
  sport,
  MIN(captured_at) AS earliest_snapshot_at,
  MAX(captured_at) AS latest_snapshot_at,
  COUNT(*) AS total_snapshots
FROM public.live_odds_snapshots
GROUP BY sport
ORDER BY earliest_snapshot_at;

-- 4) Native vs repaired snapshot/state coverage by sport (last 30d started games)
SELECT
  sport,
  COUNT(*) FILTER (WHERE started) AS started_games,
  COUNT(*) FILTER (WHERE started AND has_native_snapshot) AS started_native_snapshot_games,
  COUNT(*) FILTER (WHERE started AND has_repaired_snapshot) AS started_repaired_snapshot_games,
  COUNT(*) FILTER (WHERE started AND NOT has_native_snapshot AND has_repaired_snapshot) AS started_snapshot_repair_only_games,
  COUNT(*) FILTER (WHERE started AND has_native_state) AS started_native_state_games,
  COUNT(*) FILTER (WHERE started AND has_repaired_state) AS started_repaired_state_games,
  COUNT(*) FILTER (WHERE started AND NOT has_native_state AND has_repaired_state) AS started_state_repair_only_games
FROM public.vw_live_pipeline_coverage
WHERE start_time >= now() - interval '30 days'
GROUP BY sport
ORDER BY sport;

-- 5) Joined timeline quality distribution (last 48h snapshots)
SELECT
  sport,
  league_id,
  join_quality,
  COUNT(*) AS rows_count
FROM public.vw_joined_live_market_state
WHERE captured_at >= now() - interval '48 hours'
GROUP BY sport, league_id, join_quality
ORDER BY sport, league_id, join_quality;

-- 6) Sample joined rows proving market + state alignment
SELECT
  match_id,
  sport,
  league_id,
  captured_at,
  provider,
  market_type,
  total,
  spread_home,
  spread_away,
  home_ml,
  away_ml,
  period,
  clock,
  home_score,
  away_score,
  game_status,
  pbp_event_count_nearby,
  join_quality,
  join_method
FROM public.vw_joined_live_market_state
WHERE captured_at >= now() - interval '24 hours'
  AND (
    league_id IN ('nba', 'mlb', 'nhl', 'nfl')
    OR sport = 'soccer'
  )
ORDER BY captured_at DESC
LIMIT 100;

-- 7) Recovery effectiveness (last 24h)
SELECT
  function_name,
  status,
  COUNT(*) AS runs,
  SUM(retries_attempted) AS retries_attempted,
  SUM(retries_recovered) AS retries_recovered,
  SUM(missing_games) AS missing_games,
  SUM(stale_games) AS stale_games,
  SUM(provider_failures) AS provider_failures,
  SUM(degraded_snapshot_writes) AS degraded_snapshot_writes,
  MAX(created_at) AS last_run_at
FROM public.live_pipeline_reliability_logs
WHERE created_at >= now() - interval '24 hours'
GROUP BY function_name, status
ORDER BY function_name, status;

-- 8) Cron wiring verification by jobname
SELECT
  jobname,
  schedule,
  active,
  nodename,
  nodeport,
  database,
  username,
  command
FROM cron.job
WHERE jobname IN (
  'high-frequency-live-ingest',
  'live-odds-tracker-every-2-min',
  'ingest-odds-every-minute',
  'espn-sync-daily',
  'live-history-janitor-every-10-min',
  'live-rolling-historical-closure-every-20-min'
)
ORDER BY jobname;

-- 9) Historical backfill sport-label integrity check (last 30d)
SELECT
  league_id,
  sport,
  COUNT(*) AS rows_count
FROM public.live_odds_snapshots
WHERE source = 'odds_api_historical'
  AND market_type = 'historical_backfill'
  AND captured_at >= now() - interval '30 days'
GROUP BY league_id, sport
ORDER BY league_id, sport;

-- 10) Rolling historical closure effectiveness (last 7d)
SELECT
  function_name,
  status,
  COUNT(*) AS runs,
  SUM(retries_attempted) AS retries_attempted,
  SUM(retries_recovered) AS retries_recovered,
  SUM(snapshot_writes) AS snapshot_writes,
  SUM(live_state_writes) AS live_state_writes,
  SUM(degraded_snapshot_writes) AS degraded_snapshot_writes,
  MAX(created_at) AS last_run_at
FROM public.live_pipeline_reliability_logs
WHERE created_at >= now() - interval '7 days'
  AND function_name = 'backfill-historical-live-odds'
  AND (
    metadata->>'mode' = 'rolling_historical_closure'
    OR metadata->>'mode' = 'recent_live_repair'
  )
GROUP BY function_name, status
ORDER BY function_name, status;

-- 11) Stale in-progress status debt (should trend to zero with history-janitor)
SELECT
  league_id,
  sport,
  COUNT(*) AS stale_in_progress_games,
  MIN(start_time) AS oldest_start_time,
  MAX(start_time) AS newest_start_time
FROM public.matches
WHERE start_time <= now() - interval '6 hours'
  AND start_time >= now() - interval '14 days'
  AND (
    upper(coalesce(status, '')) LIKE '%IN_PROGRESS%'
    OR upper(coalesce(status, '')) LIKE '%LIVE%'
    OR upper(coalesce(status, '')) LIKE '%HALF%'
  )
GROUP BY league_id, sport
ORDER BY stale_in_progress_games DESC, league_id;
