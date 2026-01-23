-- 20260112000001_fix_live_ingest_cron.sql
-- Fixes the broken placeholder in invoke_ingest_live_games and ensures cron is scheduled.

-- 1. Fix the trigger function with hardcoded anon key (same pattern as other hardened crons)
CREATE OR REPLACE FUNCTION invoke_ingest_live_games()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
BEGIN
  -- Trigger the Edge Function (no Vault dependency - hardcoded for reliability)
  PERFORM net.http_post(
    url := v_url || '/functions/v1/ingest-live-games',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- 2. Unschedule any existing broken cron (ignore if not exists)
DO $$ BEGIN
  PERFORM cron.unschedule('live-game-ingest-1min');
EXCEPTION WHEN OTHERS THEN
  NULL; -- Job doesn't exist, continue
END $$;

-- 3. Schedule the cron to run every minute
SELECT cron.schedule(
  'live-game-ingest-1min',
  '* * * * *',
  $$SELECT invoke_ingest_live_games()$$
);

-- 4. Verification
SELECT 
  'Live ingest cron fixed and scheduled (every 1 min)' as status,
  NOW() as deployed_at;
