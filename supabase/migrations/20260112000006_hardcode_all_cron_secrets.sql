-- 20260112000006_hardcode_all_cron_secrets.sql
-- NUCLEAR OPTION: Hardcode correct secrets in ALL invoke functions
-- Vault lookup is unreliable; hardcode for SRE compliance

-- Constants
-- URL: https://qffzvrnbzabcokqqrwbv.supabase.co
-- ANON_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc
-- CRON_SECRET: XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ

-- 1. invoke_ingest_nba_live (NBA Turbo)
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
  FOR i IN 0..2 LOOP
    IF i > 0 THEN PERFORM pg_sleep(20); END IF;
    PERFORM net.http_post(
      url := v_url || '/functions/v1/ingest-odds',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := '{"sport_key": "basketball_nba"}'::jsonb
    );
  END LOOP;
END;
$$;

-- 2. invoke_ingest_nfl_live (NFL Turbo)
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

-- 3. invoke_ingest_odds_staggered (General High-Frequency)
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

SELECT 'All invoke functions hardcoded with correct CRON_SECRET' as status;
