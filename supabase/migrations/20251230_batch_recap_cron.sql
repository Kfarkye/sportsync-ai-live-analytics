-- ============================================================================
-- BATCH RECAP GENERATOR CRON SETUP
-- ============================================================================
-- Schedules the batch-recap-generator Edge Function to run periodically
-- and process finalized games that are missing recaps.
-- 
-- Frequency: Every 2 hours during peak sports hours (12:00-03:00 UTC = 4PM-7PM PT)
--            Plus a daily sweep at 10:00 UTC (2 AM PT) for overnight games
-- ============================================================================

-- Schedule 1: Every 2 hours during peak evening hours (US)
-- This catches games as they finish in real-time
SELECT cron.schedule(
    'batch-recap-generator-peak',
    '0 0,2,4,6 * * *',  -- Every 2 hours from midnight to 6 AM UTC (4PM-10PM PT)
    $$
    SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/batch-recap-generator',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_key', true)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
    );
    $$
);

-- Schedule 2: Daily sweep at 10:00 UTC (2 AM PT) for overnight west coast games
SELECT cron.schedule(
    'batch-recap-generator-overnight',
    '0 10 * * *',
    $$
    SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/batch-recap-generator',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_key', true)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
    );
    $$
);

-- Schedule 3: Afternoon sweep at 22:00 UTC (2 PM PT) for east coast afternoon games
SELECT cron.schedule(
    'batch-recap-generator-afternoon',
    '0 22 * * *',
    $$
    SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/batch-recap-generator',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_key', true)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
    );
    $$
);

-- Verify the jobs are scheduled
SELECT jobid, jobname, schedule, active, command FROM cron.job WHERE jobname LIKE 'batch-recap%';
