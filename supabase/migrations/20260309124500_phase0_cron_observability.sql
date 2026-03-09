-- Phase 0 ops visibility: expose pg_cron state through service-role-only RPCs.
CREATE OR REPLACE FUNCTION public.list_cron_jobs()
RETURNS TABLE(
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  command text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = cron, public
AS $$
  SELECT j.jobid::bigint, j.jobname::text, j.schedule::text, j.active::boolean, j.command::text
  FROM cron.job j
  ORDER BY j.jobid;
$$;

CREATE OR REPLACE FUNCTION public.list_cron_failures(p_limit integer DEFAULT 200)
RETURNS TABLE(
  runid bigint,
  jobid bigint,
  jobname text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = cron, public
AS $$
  SELECT
    d.runid::bigint,
    d.jobid::bigint,
    j.jobname::text,
    d.status::text,
    d.return_message::text,
    d.start_time,
    d.end_time
  FROM cron.job_run_details d
  LEFT JOIN cron.job j ON j.jobid = d.jobid
  WHERE d.status <> 'succeeded'
  ORDER BY d.start_time DESC
  LIMIT GREATEST(COALESCE(p_limit, 200), 1);
$$;

REVOKE ALL ON FUNCTION public.list_cron_jobs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_cron_failures(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_cron_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.list_cron_failures(integer) TO service_role;
