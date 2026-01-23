-- 20260117_restore_live_odds_cron.sql
-- SRE FIX: Restore high-frequency live odds ingestion
-- Root Cause: 20260115000004_cron_schedules.sql regressed schedule to 6-hour intervals

-- 1. Remove the slow 6-hour cron job
SELECT cron.unschedule('ingest-odds-cron');

-- 2. Ensure the high-frequency job exists (every minute)
-- First try to unschedule in case it partially exists
DO $$
BEGIN
  PERFORM cron.unschedule('ingest-odds-high-frequency');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist, that's fine
  NULL;
END $$;

-- 3. Schedule the high-frequency ingest-odds (every minute)
SELECT cron.schedule(
  'ingest-odds-high-frequency',
  '* * * * *',
  $$SELECT invoke_ingest_odds()$$
);

-- Verify the schedule
SELECT jobname, schedule, command 
FROM cron.job 
WHERE jobname LIKE 'ingest-odds%';
