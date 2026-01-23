-- 20260112000002_master_cron_key_fix.sql
-- MASTER FIX: Patches ALL broken cron trigger functions that had 'anon_key_placeholder'.
-- This single migration fixes: invoke_live_odds_tracker, invoke_match_discovery,
-- invoke_ingest_odds_staggered, invoke_ingest_nba_live, invoke_ingest_nfl_live

-- The actual anon key for project qffzvrnbzabcokqqrwbv
DO $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
  v_cron_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  RAISE NOTICE 'Master Cron Key Fix: Using URL=%, Key length=%', v_url, length(v_key);
END $$;

-- 1. FIX: invoke_live_odds_tracker
CREATE OR REPLACE FUNCTION invoke_live_odds_tracker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/live-odds-tracker',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
END;
$$;

-- 2. FIX: invoke_match_discovery
CREATE OR REPLACE FUNCTION invoke_match_discovery()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/capture-opening-lines',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'apikey', v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
END;
$$;

-- 3. FIX: invoke_ingest_odds_staggered
CREATE OR REPLACE FUNCTION invoke_ingest_odds_staggered()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/ingest-odds',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
END;
$$;

-- 4. FIX: invoke_ingest_nba_live (NBA Fast Lane)
CREATE OR REPLACE FUNCTION invoke_ingest_nba_live()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  -- TURBO MODE (6x per minute)
  FOR i IN 0..5 LOOP
    IF i > 0 THEN PERFORM pg_sleep(10); END IF;
    PERFORM net.http_post(
      url := v_url || '/functions/v1/ingest-odds',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := '{"sport_key": "basketball_nba"}'::jsonb
    );
  END LOOP;
END;
$$;

-- 5. FIX: invoke_ingest_nfl_live (NFL Turbo Mode)
CREATE OR REPLACE FUNCTION invoke_ingest_nfl_live()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  -- TURBO MODE (3x per minute)
  FOR i IN 0..2 LOOP
    IF i > 0 THEN PERFORM pg_sleep(20); END IF;
    PERFORM net.http_post(
      url := v_url || '/functions/v1/ingest-odds',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := '{"sport_key": "americanfootball_nfl"}'::jsonb
    );
  END LOOP;
END;
$$;

-- 6. FIX: invoke_espn_sync (if exists)
CREATE OR REPLACE FUNCTION invoke_espn_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/espn-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
END;
$$;

-- Verification
SELECT 'MASTER FIX APPLIED: All cron trigger functions now use hardcoded keys' as status;
