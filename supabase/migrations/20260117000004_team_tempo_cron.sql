-- Register cron job for daily ATS/Tempo refresh
-- Runs at 6 AM ET (11:00 UTC) daily

SELECT cron.schedule(
    'daily-team-tempo-refresh',
    '0 11 * * *',
    $$
    SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/ingest-team-tempo',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body := '{}'::jsonb
    );
    $$
);
