-- ============================================================================
-- CRON JOB OPTIMIZATION & CLEANUP SCRIPT
-- ============================================================================
-- 1. FIXES TYPOS in URLs (Jobs 5, 7, 8 had double 'r' in project ID)
-- 2. REMOVES DUPLICATE schedules (Opening Lines, Live Odds)
-- 3. STANDARDIZES schedule times
-- ============================================================================

-- A. CLEANUP: Unschedule existing duplicate/broken jobs
-- (We use the jobid from your audit)

SELECT cron.unschedule(4);   -- Duplicate Opening Lines (Daily 13:00) - Keeping Job 14 (Hourly)
SELECT cron.unschedule(5);   -- Broken URL (Ingest Live Games) - Will Re-create
SELECT cron.unschedule(7);   -- Broken URL (Daily Thesis) - Will Re-create
SELECT cron.unschedule(8);   -- Broken URL (Batch Analyze) - Will Re-create
SELECT cron.unschedule(12);  -- Duplicate Live Odds (Complex Sleep) - Keeping Job 13 (Simpler) as primary for now

-- B. RE-CREATE FIXED JOBS

-- 1. Ingest Live Games (Fixed URL, Runs every 5 mins)
SELECT cron.schedule(
    'ingest-live-games-fixed',
    '*/5 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/ingest-live-games',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
    );
    $$
);

-- 2. Daily Thesis (Fixed URL, Runs Daily at 08:00 AM)
-- Consolidated with 'generate-daily-thesis' strategy
SELECT cron.schedule(
    'daily-thesis-fixed',
    '0 8 * * *',
    $$
    SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/generate-daily-thesis',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_key') || '"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 300000
    );
    $$
);

-- 3. Batch Analyze Matches (Fixed URL, Runs Daily at 12:00 PM)
SELECT cron.schedule(
    'batch-analyze-fixed',
    '0 12 * * *',
    $$
    SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/batch-analyze-matches',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_key') || '"}'::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 300000
    );
    $$
);

-- C. VERIFY
SELECT * FROM cron.job;
