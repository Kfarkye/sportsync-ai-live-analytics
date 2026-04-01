-- Set up pg_cron schedules for player props and odds ingestion
-- Run these in Supabase SQL Editor

-- 1. Sync Player Props: 6x daily (every 4 hours)
SELECT cron.schedule(
  'sync-player-props-cron',
  '0 2,6,10,14,18,22 * * *',  -- Every 4 hours starting 2 AM UTC
  $$
  SELECT net.http_post(
    url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sync-player-props',
    headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

-- 2. Ingest Odds (links ESPN to Odds API): 4x daily
SELECT cron.schedule(
  'ingest-odds-cron',
  '0 4,10,16,22 * * *',  -- Every 6 hours
  $$
  SELECT net.http_post(
    url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/ingest-odds',
    headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '", "Content-Type": "application/json"}'::jsonb,
    body := '{"leagues": ["nba", "nfl", "nhl"]}'::jsonb
  )
  $$
);

-- 3. Finalize Games (grading cleanup): 2x daily (2 AM & 6 AM PT = 10:00 & 14:00 UTC)
SELECT cron.schedule(
  'finalize-games-cron',
  '0 10,14 * * *',  -- 2 AM PT, 6 AM PT
  $$
  SELECT net.http_post(
    url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/finalize-games-cron',
    headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key', true) || '", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

-- Verify scheduled jobs
SELECT * FROM cron.job;
