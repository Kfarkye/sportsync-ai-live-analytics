
-- ==============================================
-- OPERATIONAL DECAY PREVENTION: 5 LAYERS
-- ==============================================

-- ==== 1. LATENCY TRACKING ====
-- Expand job_runs with schedule delay, source window, rows read/written
ALTER TABLE public.job_runs
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rows_read INTEGER,
  ADD COLUMN IF NOT EXISTS rows_written INTEGER,
  ADD COLUMN IF NOT EXISTS source_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_window_end TIMESTAMPTZ;

-- Rename existing row_count to rows_written if it exists
-- (row_count was ambiguous — was it read or written?)
COMMENT ON COLUMN public.job_runs.row_count IS 'DEPRECATED: use rows_written instead. Kept for backward compat.';

-- Percentile computation view
CREATE OR REPLACE VIEW public.v_job_latency AS
WITH recent_runs AS (
  SELECT 
    job_name,
    target_object,
    trigger_type,
    status,
    started_at,
    finished_at,
    scheduled_at,
    EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000 AS duration_ms,
    EXTRACT(EPOCH FROM (started_at - scheduled_at)) * 1000 AS schedule_delay_ms,
    rows_read,
    COALESCE(rows_written, row_count) AS rows_written,
    created_at
  FROM public.job_runs
  WHERE started_at > now() - interval '7 days'
    AND status IN ('succeeded', 'failed')
),
percentiles AS (
  SELECT
    job_name,
    target_object,
    count(*) AS total_runs,
    count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
    count(*) FILTER (WHERE status = 'failed') AS failed,
    ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms)) AS p50_duration_ms,
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)) AS p95_duration_ms,
    ROUND(percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)) AS p99_duration_ms,
    ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY schedule_delay_ms)) AS p50_schedule_delay_ms,
    ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY schedule_delay_ms)) AS p95_schedule_delay_ms,
    ROUND(AVG(duration_ms)) AS avg_duration_ms,
    MAX(duration_ms) AS max_duration_ms,
    AVG(rows_written) AS avg_rows_written
  FROM recent_runs
  WHERE duration_ms IS NOT NULL
  GROUP BY job_name, target_object
)
SELECT 
  p.*,
  dr.freshness_sla_minutes,
  CASE 
    WHEN p.p95_duration_ms > (dr.freshness_sla_minutes * 60000 * 0.5) THEN 'RED: p95 exceeds 50% of SLA budget'
    WHEN p.p95_duration_ms > (dr.freshness_sla_minutes * 60000 * 0.25) THEN 'YELLOW: p95 exceeds 25% of SLA budget'
    ELSE 'GREEN'
  END AS latency_health
FROM percentiles p
LEFT JOIN public.data_registry dr ON dr.canonical_name = p.target_object;

COMMENT ON VIEW public.v_job_latency IS 
  'p50/p95/p99 duration and schedule delay per job. RED = p95 exceeds 50% of SLA budget.';

-- ==== 2. REPLAY EFFECTIVENESS ====
ALTER TABLE public.job_runs
  ADD COLUMN IF NOT EXISTS replay_recovered_before_sla BOOLEAN;

CREATE OR REPLACE VIEW public.v_replay_effectiveness AS
WITH replays AS (
  SELECT 
    job_name,
    target_object,
    trigger_type,
    status,
    started_at,
    finished_at,
    EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000 AS replay_duration_ms,
    replay_recovered_before_sla,
    parent_run_id
  FROM public.job_runs
  WHERE trigger_type IN ('replay', 'watchdog')
    AND started_at > now() - interval '7 days'
)
SELECT 
  target_object,
  count(*) AS replay_attempted,
  count(*) FILTER (WHERE status = 'succeeded') AS replay_succeeded,
  count(*) FILTER (WHERE status = 'failed') AS replay_failed,
  count(*) FILTER (WHERE replay_recovered_before_sla = true) AS recovered_before_sla,
  count(*) FILTER (WHERE replay_recovered_before_sla = false) AS recovered_after_sla,
  CASE 
    WHEN count(*) > 0 THEN ROUND(100.0 * count(*) FILTER (WHERE status = 'succeeded') / count(*), 1)
    ELSE 0
  END AS replay_success_rate_pct,
  CASE 
    WHEN count(*) FILTER (WHERE status = 'succeeded') > 0 
    THEN ROUND(100.0 * count(*) FILTER (WHERE replay_recovered_before_sla = true) / count(*) FILTER (WHERE status = 'succeeded'), 1)
    ELSE 0
  END AS sla_recovery_rate_pct,
  ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY replay_duration_ms)) AS p50_replay_ms,
  ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY replay_duration_ms)) AS p95_replay_ms
FROM replays
GROUP BY target_object;

COMMENT ON VIEW public.v_replay_effectiveness IS 
  'The real KPI: did replay restore publishability before the downstream object became stale. Per-family, not global.';

-- ==== 3. FALSE-POSITIVE ABORT TRACKING ====
CREATE TABLE IF NOT EXISTS public.assembly_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_type         TEXT NOT NULL DEFAULT 'nba_tonight',
  attempt_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome               TEXT NOT NULL
    CHECK (outcome IN ('published', 'aborted_hub_stale', 'aborted_evidence_stale', 'aborted_schema_violation', 'aborted_other', 'failed')),
  abort_reason          TEXT,
  evidence_freshness    JSONB DEFAULT '{}'::jsonb,
  hub_freshness_minutes INTEGER,
  later_proven_unnecessary BOOLEAN DEFAULT false,
  notes                 TEXT
);

ALTER TABLE public.assembly_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_assembly_attempts_outcome ON public.assembly_attempts(outcome, attempt_at DESC);

COMMENT ON TABLE public.assembly_attempts IS 
  'Every hub assembly attempt is logged. Aborts tracked with reason. later_proven_unnecessary flags false positives for guard calibration.';

CREATE OR REPLACE VIEW public.v_abort_rate AS
SELECT
  assembly_type,
  count(*) AS total_attempts,
  count(*) FILTER (WHERE outcome = 'published') AS published,
  count(*) FILTER (WHERE outcome LIKE 'aborted%') AS aborted,
  count(*) FILTER (WHERE outcome = 'failed') AS failed,
  count(*) FILTER (WHERE later_proven_unnecessary = true) AS false_positive_aborts,
  CASE 
    WHEN count(*) > 0 THEN ROUND(100.0 * count(*) FILTER (WHERE outcome LIKE 'aborted%') / count(*), 1)
    ELSE 0
  END AS abort_rate_pct,
  CASE 
    WHEN count(*) FILTER (WHERE outcome LIKE 'aborted%') > 0 
    THEN ROUND(100.0 * count(*) FILTER (WHERE later_proven_unnecessary = true) / count(*) FILTER (WHERE outcome LIKE 'aborted%'), 1)
    ELSE 0
  END AS false_positive_rate_pct
FROM public.assembly_attempts
WHERE attempt_at > now() - interval '7 days'
GROUP BY assembly_type;

COMMENT ON VIEW public.v_abort_rate IS 
  'Freshness guard calibration: abort rate + false positive rate. If false_positive_rate > 10%, thresholds need loosening.';

-- ==== 4. SCHEMA GOVERNANCE ====
ALTER TABLE public.schema_contracts
  ADD COLUMN IF NOT EXISTS compatible_versions TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS migration_owner TEXT,
  ADD COLUMN IF NOT EXISTS migration_script TEXT,
  ADD COLUMN IF NOT EXISTS cutover_date DATE,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated', 'retired'));

CREATE OR REPLACE VIEW public.v_schema_health AS
SELECT 
  sc.canonical_name,
  sc.schema_version,
  sc.required_fields,
  sc.compatible_versions,
  sc.status AS schema_status,
  sc.deprecated_at,
  sc.migration_owner,
  sc.cutover_date,
  dr.publish_owner,
  dr.consumer_tier,
  CASE 
    WHEN sc.status = 'deprecated' AND sc.cutover_date < CURRENT_DATE THEN 'RED: past cutover, still active'
    WHEN sc.status = 'deprecated' THEN 'YELLOW: deprecated, awaiting cutover'
    WHEN sc.status = 'active' THEN 'GREEN'
    ELSE 'GREY: retired'
  END AS governance_health
FROM public.schema_contracts sc
LEFT JOIN public.data_registry dr ON dr.object_name = sc.canonical_name;

COMMENT ON VIEW public.v_schema_health IS 
  'Schema governance: which contracts are active, deprecated, or past cutover deadline.';

-- ==== 5. CORRUPTION RECOVERY ====
CREATE TABLE IF NOT EXISTS public.publish_incidents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_object     TEXT NOT NULL,
  incident_type     TEXT NOT NULL
    CHECK (incident_type IN ('partial_publish', 'wrong_source_version', 'duplicate_write', 'stale_marked_current', 'bad_enrichment', 'schema_mismatch', 'count_mismatch', 'other')),
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  detected_by       TEXT NOT NULL DEFAULT 'manual',
  affected_window_start TIMESTAMPTZ,
  affected_window_end   TIMESTAMPTZ,
  affected_doc_count    INTEGER,
  original_job_run_id   UUID REFERENCES public.job_runs(id),
  recovery_status   TEXT NOT NULL DEFAULT 'open'
    CHECK (recovery_status IN ('open', 'investigating', 'rolling_back', 'regenerating', 'verifying', 'resolved', 'wont_fix')),
  recovery_job_run_id UUID REFERENCES public.job_runs(id),
  root_cause        TEXT,
  resolution_notes  TEXT,
  resolved_at       TIMESTAMPTZ,
  verified_by       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.publish_incidents ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_publish_incidents_status ON public.publish_incidents(recovery_status, detected_at DESC);
CREATE INDEX idx_publish_incidents_target ON public.publish_incidents(target_object, detected_at DESC);

COMMENT ON TABLE public.publish_incidents IS 
  'Corruption/bad-publish incident tracker. Each incident follows: detect → identify → rollback → regenerate → verify → resolve.';

-- Recovery dashboard
CREATE OR REPLACE VIEW public.v_recovery_dashboard AS
SELECT 
  target_object,
  count(*) AS total_incidents,
  count(*) FILTER (WHERE recovery_status = 'open') AS open_incidents,
  count(*) FILTER (WHERE recovery_status = 'resolved') AS resolved_incidents,
  count(*) FILTER (WHERE recovery_status = 'wont_fix') AS wont_fix,
  CASE 
    WHEN count(*) > 0 THEN ROUND(100.0 * count(*) FILTER (WHERE recovery_status = 'resolved') / count(*), 1)
    ELSE 100
  END AS resolution_rate_pct,
  ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - detected_at)) / 60) FILTER (WHERE resolved_at IS NOT NULL)) AS avg_resolution_minutes,
  MAX(detected_at) AS last_incident_at
FROM public.publish_incidents
WHERE detected_at > now() - interval '30 days'
GROUP BY target_object;

COMMENT ON VIEW public.v_recovery_dashboard IS 
  'Per-family incident resolution rate and mean time to recovery.';

-- ==== 6. UNIFIED OPERATIONAL HEALTH DASHBOARD ====
CREATE OR REPLACE VIEW public.v_ops_dashboard AS
SELECT 
  dr.canonical_name,
  dr.consumer_tier,
  dr.api_endpoint,
  dr.freshness_sla_minutes,
  -- Latency
  lat.p50_duration_ms,
  lat.p95_duration_ms,
  lat.p99_duration_ms,
  lat.p95_schedule_delay_ms,
  lat.latency_health,
  lat.total_runs,
  lat.succeeded,
  lat.failed,
  -- Replay
  rep.replay_attempted,
  rep.replay_succeeded,
  rep.replay_failed,
  rep.replay_success_rate_pct,
  rep.sla_recovery_rate_pct,
  -- Recovery
  rec.total_incidents,
  rec.open_incidents,
  rec.resolution_rate_pct,
  -- Schema
  sh.schema_version,
  sh.governance_health
FROM public.data_registry dr
LEFT JOIN public.v_job_latency lat ON lat.target_object = dr.canonical_name
LEFT JOIN public.v_replay_effectiveness rep ON rep.target_object = dr.canonical_name
LEFT JOIN public.v_recovery_dashboard rec ON rec.target_object = dr.canonical_name
LEFT JOIN public.v_schema_health sh ON sh.canonical_name = dr.object_name
WHERE dr.consumer_tier IN ('hub', 'app')
ORDER BY 
  CASE dr.consumer_tier WHEN 'hub' THEN 1 WHEN 'app' THEN 2 END,
  dr.canonical_name;

COMMENT ON VIEW public.v_ops_dashboard IS
  'One dashboard, 5 red lines. Latency × Replay × Abort × Schema × Recovery per family.';

-- ==== 7. RED LINE ALERTS FUNCTION ====
CREATE OR REPLACE FUNCTION public.check_red_lines()
RETURNS TABLE(
  red_line TEXT,
  target_object TEXT,
  detail TEXT,
  severity TEXT
) AS $$
BEGIN
  -- Red line 1: p95 duration exceeds SLA budget
  RETURN QUERY
  SELECT 
    'P95_EXCEEDS_SLA_BUDGET'::TEXT,
    lat.target_object,
    format('p95=%sms, SLA=%smin (%sms budget)', lat.p95_duration_ms, lat.freshness_sla_minutes, lat.freshness_sla_minutes * 60000),
    'critical'::TEXT
  FROM public.v_job_latency lat
  WHERE lat.latency_health LIKE 'RED%';

  -- Red line 2: replay misses recovery window
  RETURN QUERY
  SELECT 
    'REPLAY_MISSES_RECOVERY'::TEXT,
    rep.target_object,
    format('success_rate=%s%%, sla_recovery=%s%%', rep.replay_success_rate_pct, rep.sla_recovery_rate_pct),
    CASE WHEN rep.sla_recovery_rate_pct < 50 THEN 'critical' ELSE 'warning' END
  FROM public.v_replay_effectiveness rep
  WHERE rep.sla_recovery_rate_pct < 80;

  -- Red line 3: freshness abort rate spikes
  RETURN QUERY
  SELECT 
    'ABORT_RATE_SPIKE'::TEXT,
    ar.assembly_type,
    format('abort_rate=%s%%, false_positive=%s%%', ar.abort_rate_pct, ar.false_positive_rate_pct),
    CASE WHEN ar.false_positive_rate_pct > 20 THEN 'critical' ELSE 'warning' END
  FROM public.v_abort_rate ar
  WHERE ar.abort_rate_pct > 15 OR ar.false_positive_rate_pct > 10;

  -- Red line 4: writer emits unsupported schema version
  RETURN QUERY
  SELECT 
    'UNSUPPORTED_SCHEMA'::TEXT,
    sh.canonical_name,
    format('version=%s, status=%s, cutover=%s', sh.schema_version, sh.schema_status, sh.cutover_date),
    'critical'::TEXT
  FROM public.v_schema_health sh
  WHERE sh.governance_health LIKE 'RED%';

  -- Red line 5: open incidents older than 24 hours
  RETURN QUERY
  SELECT 
    'UNRESOLVED_INCIDENT'::TEXT,
    pi.target_object,
    format('type=%s, detected=%s, status=%s', pi.incident_type, pi.detected_at, pi.recovery_status),
    'critical'::TEXT
  FROM public.publish_incidents pi
  WHERE pi.recovery_status IN ('open', 'investigating')
    AND pi.detected_at < now() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.check_red_lines IS 
  'Returns all active red line violations. If this returns rows, something needs attention.';
;
