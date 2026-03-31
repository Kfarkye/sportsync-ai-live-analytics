-- Evidence Health Dashboard: materialized view + accessor function
-- Applied to Supabase via MCP on 2026-03-31

CREATE MATERIALIZED VIEW IF NOT EXISTS v_evidence_health AS
WITH 
pregame_stats AS (
  SELECT count(*) AS total_runs, sum(matches_processed) AS total_matches_processed,
    sum(matches_succeeded) AS total_matches_succeeded, sum(matches_failed) AS total_matches_failed,
    sum(total_cards_generated) AS total_cards, sum(total_sources_cited) AS total_sources,
    round(avg(duration_ms)) AS avg_duration_ms,
    CASE WHEN sum(matches_processed) > 0 
      THEN round(sum(matches_succeeded)::numeric / sum(matches_processed)::numeric, 4) ELSE NULL END AS success_rate
  FROM pregame_intel_log WHERE started_at > now() - interval '24 hours'
),
espn_drain AS (
  SELECT count(*) AS total_drains,
    count(*) FILTER (WHERE status IN ('ok','success')) AS successful_drains,
    count(*) FILTER (WHERE status NOT IN ('ok','success')) AS failed_drains,
    sum(events_found) AS total_events_found, sum(events_drained) AS total_events_drained,
    round(avg(duration_ms)) AS avg_duration_ms
  FROM espn_drain_log WHERE run_at > now() - interval '24 hours'
),
poly_stats AS (
  SELECT count(*) AS total_runs, count(*) FILTER (WHERE status IN ('ok','success')) AS successful_runs,
    sum(events_found) AS events_found, sum(events_upserted) AS events_upserted,
    round(avg(duration_ms)) AS avg_duration_ms
  FROM poly_ingest_log WHERE run_at > now() - interval '24 hours'
),
authority_dist AS (
  SELECT source_authority, count(*) AS cnt FROM canonical_games
  WHERE source_authority IS NOT NULL GROUP BY source_authority
),
audit_stats AS (
  SELECT table_name, operation, count(*) AS mutation_count, count(DISTINCT record_id) AS distinct_records
  FROM evidence_state_changes WHERE created_at > now() - interval '24 hours'
  GROUP BY table_name, operation
),
pick_accuracy AS (
  SELECT count(*) AS total_picks,
    count(*) FILTER (WHERE result = 'WIN') AS wins,
    count(*) FILTER (WHERE result = 'LOSS') AS losses,
    count(*) FILTER (WHERE result = 'PUSH') AS pushes,
    count(*) FILTER (WHERE result IS NULL) AS pending,
    CASE WHEN count(*) FILTER (WHERE result IN ('WIN','LOSS')) > 0 
      THEN round(count(*) FILTER (WHERE result = 'WIN')::numeric / 
                 count(*) FILTER (WHERE result IN ('WIN','LOSS'))::numeric, 4) ELSE NULL END AS win_rate
  FROM ai_chat_picks
),
freshness AS (
  SELECT 'canonical_games' AS tbl, count(*) AS total,
    count(*) FILTER (WHERE updated_at > now() - interval '1 hour') AS fresh_1h,
    count(*) FILTER (WHERE updated_at > now() - interval '24 hours') AS fresh_24h,
    max(updated_at) AS latest, now() - max(updated_at) AS staleness
  FROM canonical_games
  UNION ALL
  SELECT 'live_game_state', count(*),
    count(*) FILTER (WHERE updated_at > now() - interval '1 hour'),
    count(*) FILTER (WHERE updated_at > now() - interval '24 hours'),
    max(updated_at), now() - max(updated_at)
  FROM live_game_state
),
entity_health AS (
  SELECT provider, count(*) AS total_mappings,
    count(*) FILTER (WHERE confidence_score >= 0.9) AS high_confidence,
    count(*) FILTER (WHERE confidence_score < 0.7) AS low_confidence,
    round(avg(confidence_score)::numeric, 3) AS avg_confidence
  FROM entity_mappings GROUP BY provider
)
SELECT 
  1 AS id,
  json_build_object(
    'generated_at', now(),
    'pregame_pipeline', (SELECT row_to_json(pregame_stats) FROM pregame_stats),
    'espn_drain', (SELECT row_to_json(espn_drain) FROM espn_drain),
    'polymarket', (SELECT row_to_json(poly_stats) FROM poly_stats),
    'source_authority', (SELECT json_agg(row_to_json(authority_dist)) FROM authority_dist),
    'audit_activity_24h', (SELECT json_agg(row_to_json(audit_stats)) FROM audit_stats),
    'ai_pick_accuracy', (SELECT row_to_json(pick_accuracy) FROM pick_accuracy),
    'data_freshness', (SELECT json_agg(row_to_json(freshness)) FROM freshness),
    'entity_resolution', (SELECT json_agg(row_to_json(entity_health)) FROM entity_health)
  ) AS health_report;

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_health_id ON v_evidence_health (id);

CREATE OR REPLACE FUNCTION get_evidence_health(force_refresh boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql AS $$
BEGIN
  IF force_refresh THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY v_evidence_health;
  END IF;
  RETURN (SELECT health_report FROM v_evidence_health LIMIT 1);
END;
$$;
