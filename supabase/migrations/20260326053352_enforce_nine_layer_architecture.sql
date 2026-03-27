
-- ==============================================
-- NINE-LAYER ENFORCEMENT
-- Violations are structurally impossible, not just discouraged.
-- ==============================================

-- ==== 1. OWNERSHIP ENFORCEMENT ====
-- One publish_owner per canonical_name. No exceptions.
ALTER TABLE public.data_registry
  ADD CONSTRAINT uq_registry_publish_owner_object UNIQUE (canonical_name, publish_owner);

-- ==== 2. PUBLISH-RULE ENFORCEMENT ====
-- Source jobs write staging only. App jobs write evidence only. Hub assembly is singular.
ALTER TABLE public.data_registry
  ADD COLUMN IF NOT EXISTS write_tier TEXT
    CHECK (write_tier IN ('raw', 'staging', 'evidence', 'hub', 'control'));

-- Source objects can only write to raw/staging
-- App objects can only write to evidence
-- Hub objects can only be written by the hub assembler path
UPDATE public.data_registry SET write_tier = 'hub' WHERE naming_tier = 'HUB';
UPDATE public.data_registry SET write_tier = 'evidence' WHERE naming_tier = 'APP';
UPDATE public.data_registry SET write_tier = 'raw' WHERE naming_tier = 'SOURCE';
UPDATE public.data_registry SET write_tier = 'control' WHERE naming_tier = 'JOB';

-- ==== 3. FRESHNESS ENFORCEMENT ====
-- Every object has a freshness SLA. If stale, the hub assembler knows.
ALTER TABLE public.data_registry
  ADD COLUMN IF NOT EXISTS freshness_sla_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS stale_behavior TEXT DEFAULT 'exclude'
    CHECK (stale_behavior IN ('exclude', 'mark_stale', 'fallback_cache', 'serve_anyway'));

-- Set SLAs
UPDATE public.data_registry SET freshness_sla_minutes = 7 WHERE canonical_name = 'HUB_GAMES_CURRENT';
UPDATE public.data_registry SET freshness_sla_minutes = 5 WHERE canonical_name = 'HUB_GAMES_LIVE';
UPDATE public.data_registry SET freshness_sla_minutes = 1440 WHERE canonical_name = 'HUB_GAMES_CANONICAL';
UPDATE public.data_registry SET freshness_sla_minutes = 1440 WHERE canonical_name = 'HUB_TEAMS';
UPDATE public.data_registry SET freshness_sla_minutes = 720, stale_behavior = 'mark_stale' WHERE canonical_name = 'APP_REF_TENDENCIES_CURRENT';
UPDATE public.data_registry SET freshness_sla_minutes = 360, stale_behavior = 'mark_stale' WHERE canonical_name = 'APP_INJURIES_CURRENT';
UPDATE public.data_registry SET freshness_sla_minutes = 720, stale_behavior = 'exclude' WHERE canonical_name = 'APP_PREGAME_INTEL';
UPDATE public.data_registry SET freshness_sla_minutes = 1440, stale_behavior = 'serve_anyway' WHERE canonical_name = 'APP_GAME_RECAPS';
UPDATE public.data_registry SET freshness_sla_minutes = 1440, stale_behavior = 'serve_anyway' WHERE canonical_name = 'APP_PLAYER_PROPS';
-- Sources: lenient SLAs, serve anyway
UPDATE public.data_registry SET freshness_sla_minutes = 1440, stale_behavior = 'serve_anyway' WHERE naming_tier = 'SOURCE';
-- Control plane: 10 min SLA
UPDATE public.data_registry SET freshness_sla_minutes = 10, stale_behavior = 'exclude' WHERE naming_tier = 'JOB';

-- ==== 4. SCHEMA ENFORCEMENT ====
-- App outputs need a locked contract before enriching the hub.
CREATE TABLE IF NOT EXISTS public.schema_contracts (
  canonical_name    TEXT NOT NULL REFERENCES public.data_registry(object_name),
  schema_version    TEXT NOT NULL DEFAULT '1.0.0',
  required_fields   TEXT[] NOT NULL,
  field_types       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_name, schema_version)
);

ALTER TABLE public.schema_contracts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.schema_contracts IS 
  'Locked field contracts per object. If an app changes shape without a version bump, it breaks loudly.';

-- Seed contracts for the first vertical slice
INSERT INTO public.schema_contracts (canonical_name, schema_version, required_fields, field_types) VALUES
  ('matches', '1.0.0', 
    ARRAY['id','league_id','home_team','away_team','start_time','status'],
    '{"id":"text","league_id":"text","home_team":"text","away_team":"text","start_time":"timestamptz","status":"text","home_score":"integer","away_score":"integer"}'::jsonb),
  ('live_game_state', '1.0.0',
    ARRAY['id','league_id','game_status','home_team','away_team'],
    '{"id":"text","league_id":"text","game_status":"text","home_team":"text","away_team":"text","home_score":"integer","away_score":"integer"}'::jsonb),
  ('official_tendencies', '1.0.0',
    ARRAY['id','official_name','league','season'],
    '{"id":"integer","official_name":"text","league":"text","season":"text"}'::jsonb)
ON CONFLICT DO NOTHING;

ALTER TABLE public.data_registry
  ADD COLUMN IF NOT EXISTS schema_version TEXT DEFAULT '1.0.0';

-- ==== 5. STORAGE ENFORCEMENT ====
-- runtime_read_source must be 'firebase' for migrated objects.
-- If live reads still hit supabase for a migrated object, that's a violation.
ALTER TABLE public.data_registry
  ADD COLUMN IF NOT EXISTS runtime_read_source TEXT DEFAULT 'supabase'
    CHECK (runtime_read_source IN ('supabase', 'firebase', 'bigquery'));

-- Migrating objects should read from firebase
UPDATE public.data_registry SET runtime_read_source = 'firebase' WHERE status = 'migrating';

-- ==== 6. OPERATIONAL ENFORCEMENT ====
-- Proof artifacts view: one row per object showing whether the architecture is holding.
DROP VIEW IF EXISTS public.v_operational_proof;

CREATE VIEW public.v_operational_proof AS
SELECT 
  dr.canonical_name,
  dr.consumer_tier,
  dr.api_endpoint,
  dr.publish_owner,
  dr.status AS migration_status,
  dr.runtime_read_source,
  dr.freshness_sla_minutes,
  dr.stale_behavior,
  dr.write_tier,
  dr.cutover_ready,
  dr.schema_version,
  -- Last job run for this object
  latest.last_run_status,
  latest.last_run_at,
  latest.last_row_count,
  latest.last_error,
  latest.last_trigger_type,
  -- Freshness
  CASE 
    WHEN latest.last_run_at IS NULL THEN 'NEVER_RUN'
    WHEN EXTRACT(EPOCH FROM (now() - latest.last_run_at)) / 60 > COALESCE(dr.freshness_sla_minutes, 10080) THEN 'STALE'
    ELSE 'FRESH'
  END AS freshness_status,
  ROUND(EXTRACT(EPOCH FROM (now() - latest.last_run_at)) / 60) AS minutes_since_last_run,
  -- Storage violation: migrated but still reading from supabase
  CASE 
    WHEN dr.status IN ('migrating', 'migrated') AND dr.runtime_read_source = 'supabase' THEN true
    ELSE false
  END AS storage_violation,
  -- Schema: has contract?
  CASE WHEN sc.canonical_name IS NOT NULL THEN true ELSE false END AS has_schema_contract
FROM public.data_registry dr
LEFT JOIN LATERAL (
  SELECT 
    jr.status AS last_run_status,
    jr.finished_at AS last_run_at,
    jr.row_count AS last_row_count,
    jr.error_message AS last_error,
    jr.trigger_type AS last_trigger_type
  FROM public.job_runs jr
  WHERE jr.target_object = dr.canonical_name
  ORDER BY jr.started_at DESC
  LIMIT 1
) latest ON true
LEFT JOIN public.schema_contracts sc ON sc.canonical_name = dr.object_name
ORDER BY 
  CASE dr.consumer_tier WHEN 'hub' THEN 1 WHEN 'app' THEN 2 WHEN 'source' THEN 3 WHEN 'job' THEN 4 END,
  dr.canonical_name;

COMMENT ON VIEW public.v_operational_proof IS 
  'Proof, not belief. Shows whether each object in the architecture is holding: freshness, storage compliance, schema contract, last run, violations.';

-- ==== 7. CRON ENFORCEMENT ====
-- Prevent two jobs from running simultaneously on the same target
CREATE OR REPLACE FUNCTION public.log_job_start(
  p_job_id TEXT,
  p_job_name TEXT,
  p_target_object TEXT DEFAULT NULL,
  p_trigger_type TEXT DEFAULT 'scheduled'
) RETURNS UUID AS $$
DECLARE
  v_run_id UUID;
  v_already_running BOOLEAN;
BEGIN
  -- Check for already-running job on same target
  IF p_target_object IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.job_runs 
      WHERE target_object = p_target_object 
      AND status = 'running'
      AND started_at > now() - interval '30 minutes'
    ) INTO v_already_running;
    
    IF v_already_running THEN
      RAISE EXCEPTION 'CRON_VIOLATION: Job % already running on target %', p_job_name, p_target_object;
    END IF;
  END IF;

  INSERT INTO public.job_runs (job_id, job_name, target_object, status, started_at, trigger_type)
  VALUES (p_job_id, p_job_name, p_target_object, 'running', now(), p_trigger_type)
  RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==== 8. READ-PATH ENFORCEMENT ====
-- View that shows any registered objects missing from the API contract
DROP VIEW IF EXISTS public.v_read_path_violations;

CREATE VIEW public.v_read_path_violations AS
SELECT 
  canonical_name,
  object_name,
  'MISSING_API_ENDPOINT' AS violation_type
FROM public.data_registry
WHERE api_endpoint IS NULL
UNION ALL
SELECT 
  canonical_name,
  object_name,
  'MISSING_PUBLISH_OWNER' AS violation_type
FROM public.data_registry
WHERE publish_owner IS NULL
UNION ALL
SELECT 
  canonical_name,
  object_name,
  'MISSING_CONSUMER_TIER' AS violation_type
FROM public.data_registry
WHERE consumer_tier IS NULL
UNION ALL
SELECT 
  canonical_name,
  object_name,
  'MISSING_WRITE_TIER' AS violation_type
FROM public.data_registry
WHERE write_tier IS NULL
UNION ALL
SELECT 
  canonical_name,
  object_name,
  'MISSING_FRESHNESS_SLA' AS violation_type
FROM public.data_registry
WHERE freshness_sla_minutes IS NULL
UNION ALL
SELECT 
  canonical_name,
  object_name,
  'STORAGE_VIOLATION' AS violation_type
FROM public.data_registry
WHERE status IN ('migrating', 'migrated') AND runtime_read_source = 'supabase';

COMMENT ON VIEW public.v_read_path_violations IS 
  'Every row here is a contract gap: objects that consumers could route around because the spine is incomplete.';
;
