-- Schedule sharp-picks-cron to run every 2 hours during peak betting hours
-- This runs the Triple Confluence Gate analysis for automated sharp picks

-- First, ensure pg_cron and pg_net extensions are enabled
-- Skip if already exists
DO $$ 
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

DO $$ 
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Schedule sharp-picks-cron every 2 hours (at minute 30 to offset from other crons)
-- Delete existing job first to avoid duplicates
SELECT cron.unschedule('sharp-picks-cron') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'sharp-picks-cron'
);

SELECT cron.schedule(
    'sharp-picks-cron',
    '30 */2 * * *',  -- Every 2 hours at :30
    $$
    SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/sharp-picks-cron',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := '{"is_cron": true}'::jsonb
    );
    $$
);

-- Grant necessary permissions (wrapped in exception handler)
DO $$ 
BEGIN
    GRANT USAGE ON SCHEMA cron TO postgres;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

DO $$ 
BEGIN
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;
