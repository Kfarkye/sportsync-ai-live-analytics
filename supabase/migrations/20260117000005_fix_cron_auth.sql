-- FIX: Broken cron jobs caused by NULL service_role_key in string concatenation
-- The issue: current_setting('app.service_role_key', true) returns NULL
-- Solution: Replace with vault secret or hardcoded key for cron jobs

-- Step 1: Unschedule the broken jobs
SELECT cron.unschedule('sync-player-props-cron');
SELECT cron.unschedule('finalize-games-cron');

-- Step 2: Re-create with fixed syntax using vault secret
-- Note: You need to first store your service_role_key in the vault:
-- SELECT vault.create_secret('your_service_role_key_here', 'service_role_key');

-- 1. Sync Player Props: 6x daily (every 4 hours)
SELECT cron.schedule(
  'sync-player-props-cron',
  '0 2,6,10,14,18,22 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sync-player-props',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 2. Finalize Games: 2x daily
SELECT cron.schedule(
  'finalize-games-cron',
  '0 10,14 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/finalize-games-cron',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verify
SELECT * FROM cron.job WHERE jobname IN ('sync-player-props-cron', 'finalize-games-cron');
