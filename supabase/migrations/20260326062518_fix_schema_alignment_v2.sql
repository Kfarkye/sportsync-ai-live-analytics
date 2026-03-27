
-- Drop dependent views first
DROP VIEW IF EXISTS public.v_schema_health CASCADE;
DROP VIEW IF EXISTS public.v_ops_dashboard CASCADE;

-- Make data_registry.canonical_name unique
ALTER TABLE public.data_registry ADD CONSTRAINT uq_data_registry_canonical UNIQUE (canonical_name);

-- Drop old FK 
ALTER TABLE public.schema_contracts DROP CONSTRAINT IF EXISTS schema_contracts_canonical_name_fkey;

-- Rename old column
ALTER TABLE public.schema_contracts RENAME COLUMN canonical_name TO source_table;

-- Add new canonical_name column
ALTER TABLE public.schema_contracts ADD COLUMN canonical_name TEXT;

-- Populate from registry
UPDATE public.schema_contracts sc
SET canonical_name = dr.canonical_name
FROM public.data_registry dr
WHERE dr.object_name = sc.source_table;

-- Constraints
ALTER TABLE public.schema_contracts ALTER COLUMN canonical_name SET NOT NULL;
ALTER TABLE public.schema_contracts ADD CONSTRAINT uq_schema_contracts_canonical UNIQUE (canonical_name);
ALTER TABLE public.schema_contracts ADD CONSTRAINT schema_contracts_canonical_name_fkey 
  FOREIGN KEY (canonical_name) REFERENCES public.data_registry(canonical_name);

-- Recreate v_schema_health with corrected join
CREATE OR REPLACE VIEW public.v_schema_health AS
SELECT 
  sc.canonical_name,
  sc.source_table,
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
JOIN public.data_registry dr ON dr.canonical_name = sc.canonical_name;

-- Recreate v_ops_dashboard
CREATE OR REPLACE VIEW public.v_ops_dashboard AS
SELECT 
  dr.canonical_name,
  dr.consumer_tier,
  dr.api_endpoint,
  dr.freshness_sla_minutes,
  lat.p50_duration_ms,
  lat.p95_duration_ms,
  lat.p99_duration_ms,
  lat.p95_schedule_delay_ms,
  lat.latency_health,
  lat.total_runs,
  lat.succeeded,
  lat.failed,
  rep.replay_attempted,
  rep.replay_succeeded,
  rep.replay_failed,
  rep.replay_success_rate_pct,
  rep.sla_recovery_rate_pct,
  rec.total_incidents,
  rec.open_incidents,
  rec.resolution_rate_pct,
  sh.schema_version,
  sh.governance_health
FROM public.data_registry dr
LEFT JOIN public.v_job_latency lat ON lat.target_object = dr.canonical_name
LEFT JOIN public.v_replay_effectiveness rep ON rep.target_object = dr.canonical_name
LEFT JOIN public.v_recovery_dashboard rec ON rec.target_object = dr.canonical_name
LEFT JOIN public.v_schema_health sh ON sh.canonical_name = dr.canonical_name
WHERE dr.consumer_tier IN ('hub', 'app')
ORDER BY 
  CASE dr.consumer_tier WHEN 'hub' THEN 1 WHEN 'app' THEN 2 END,
  dr.canonical_name;

-- Verify
SELECT canonical_name, source_table, schema_version, status FROM public.schema_contracts ORDER BY canonical_name;
;
