-- 20260109000010_optimize_nba_cron.sql
-- Optimizes update frequency for NBA by creating a dedicated "Fast Lane" cron.
-- This ensures NBA updates are not blocked by the serial processing of other sports.

CREATE OR REPLACE FUNCTION invoke_ingest_nba_live()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- 1. URL Resolution
  v_url := current_setting('app.settings.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN
    v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  END IF;

  -- 2. Key Resolution
  BEGIN
    SELECT decrypted_secret INTO v_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;

  IF v_key IS NULL THEN v_key := 'anon_key_placeholder'; END IF;

  -- 3. Trigger Function (Specific NBA Payload)
  IF v_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/ingest-odds',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json',
        'x-cron-secret', 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ'
      ),
      body := '{"sport_key": "basketball_nba"}'::jsonb
    );
  END IF;
END;
$$;
-- Schedule: Every Minute (Fast Lane)
SELECT cron.schedule(
  'ingest-nba-live-fast',
  '* * * * *', 
  $$SELECT invoke_ingest_nba_live()$$
);
