-- Simple Cron Job for NBA Bridge
-- Drops existing job if present to avoid duplicates
DO $$ 
BEGIN
    PERFORM cron.unschedule('nba-bridge-simple');
    PERFORM cron.unschedule('nba-bridge-live-sync');
EXCEPTION 
    WHEN OTHERS THEN NULL;
END $$;

-- Schedule new simple job
SELECT cron.schedule(
    'nba-bridge-simple',
    '* * * * *', -- Every minute
    $$
    select net.http_post(
        url:='https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/nba-bridge',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
    $$
);
