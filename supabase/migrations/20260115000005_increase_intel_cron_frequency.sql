-- Increase pregame intel cron frequency from every 10 minutes to every 5 minutes
-- The freshness guard in the worker ensures no redundant regeneration

-- Unschedule existing
SELECT cron.unschedule('pregame-intel-research-cron');

-- Re-schedule at higher frequency (every 5 minutes)
SELECT cron.schedule(
  'pregame-intel-research-cron',
  '*/5 * * * *',  -- Every 5 minutes
  $$SELECT invoke_pregame_intel_cron()$$
);

-- Verify
SELECT jobname, schedule FROM cron.job WHERE jobname = 'pregame-intel-research-cron';
