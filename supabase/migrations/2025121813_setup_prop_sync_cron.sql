
-- sync-player-props-hourly Cron Job Setup
-- This script enables automated player prop ingestion for the specific project instance.

-- 1. Ensure the pg_net extension is enabled for making HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Schedule the hourly sync job
-- This will run at the start of every hour (0 * * * *)
SELECT cron.schedule(
    'sync-player-props-hourly',           -- Job name
    '0 * * * *',                          -- Cron schedule (every hour)
    $$
    SELECT
      net.http_post(
        url:='https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sync-player-props',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk"}'::jsonb,
        body:='{}'::jsonb
      ) as request_id;
    $$
);
