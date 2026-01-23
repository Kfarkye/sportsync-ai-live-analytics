-- CRON DIAGNOSTICS & REPAIR
-- Run this in the Supabase SQL Editor to verify the cron system.

-- 1. Check if extensions are actually enabled
SELECT name, installed_version 
FROM pg_available_extensions 
WHERE name IN ('pg_cron', 'pg_net') AND installed_version IS NOT NULL;

-- 2. Check current scheduled jobs
SELECT jobid, jobname, schedule, command, active 
FROM cron.job;

-- 3. Check recent run history (last 10 runs)
-- If status is 'failed', the 'return_message' will tell us why.
SELECT runid, jobid, status, return_message, start_time 
FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 10;

-- 4. REPAIR: If jobs are missing or stuck, this resets them
-- Run this block if you don't see the jobs above
/*
SELECT cron.unschedule('ingest-odds-high-frequency');
SELECT cron.unschedule('high-frequency-live-ingest');

SELECT cron.schedule(
  'ingest-odds-high-frequency',
  '* * * * *',
  $$SELECT invoke_ingest_odds_staggered()$$
);

SELECT cron.schedule(
  'high-frequency-live-ingest',
  '* * * * *',
  $$SELECT invoke_ingest_live_games()$$
);
*/
