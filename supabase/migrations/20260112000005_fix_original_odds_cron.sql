-- 20260112000005_fix_original_odds_cron.sql
-- Fixes the original invoke_ingest_odds function to use correct CRON_SECRET

CREATE OR REPLACE FUNCTION invoke_ingest_odds()
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
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- Also fix invoke_live_odds_tracker to use correct secret
CREATE OR REPLACE FUNCTION invoke_live_odds_tracker()
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
    url := v_url || '/functions/v1/live-odds-tracker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

SELECT 'Original cron trigger functions fixed with correct CRON_SECRET' as status;
