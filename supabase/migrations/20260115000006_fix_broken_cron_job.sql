-- Fix broken cron job 83: pregame-intel-dispatcher uses non-existent app.settings.service_role_key
-- This cron is causing constant ERROR logs every minute

-- Remove the broken cron job that references app.settings.service_role_key
-- The pregame-intel-dispatcher doesn't exist and the key reference is invalid
DO $$
BEGIN
  -- Try to unschedule by looking for jobs that match the broken pattern
  PERFORM cron.unschedule(jobid) 
  FROM cron.job 
  WHERE command LIKE '%pregame-intel-dispatcher%';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not unschedule pregame-intel-dispatcher: %', SQLERRM;
END $$;

-- Also clean up any jobs referencing the non-existent app.settings pattern
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) 
  FROM cron.job 
  WHERE command LIKE '%app.settings.service_role_key%';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not unschedule app.settings jobs: %', SQLERRM;
END $$;

-- Verify remaining jobs
SELECT jobid, jobname, schedule, command FROM cron.job ORDER BY jobid;
