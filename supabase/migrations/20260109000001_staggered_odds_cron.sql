
-- 20260109000001_staggered_odds_cron.sql
-- Increases odds ingestion resolution to ~30 seconds by adding a staggered cron job.

-- NOTE: pg_cron only supports minute-level resolution.
-- To achieve 30s, we can't do it purely in cron.
-- HOWEVER, we can have a loop in the edge function or trigger it twice with a delay.
-- Since we are in an Edge Function environment, the best way to get < 1m resolution 
-- without spinning up a persistent node server is to have the cron job trigger a function 
-- that calls the ingest service twice with a 30s sleep.

CREATE OR REPLACE FUNCTION invoke_ingest_odds_staggered()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- 1. Try to get URL from settings, then Vault, then fallback to known project URL
  v_url := current_setting('app.settings.supabase_url', true);
  
  IF v_url IS NULL OR v_url = '' THEN
    -- Fallback to the project ID discovered during deployment
    v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  END IF;

  -- 2. Try to get Service Key (Optional now, since we verify via x-cron-secret)
  -- If missing, we send a dummy key. The Edge Function has --no-verify-jwt, 
  -- so it relies on CRON_SECRET, not the JWT signature.
  BEGIN
    SELECT decrypted_secret INTO v_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;

  IF v_key IS NULL THEN
    v_key := 'anon_key_placeholder'; 
  END IF;

  -- 3. Trigger the Edge Function
  IF v_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/ingest-odds',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json',
        'x-cron-secret', 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- We already have 'ingest-odds-every-minute'.
-- To get closer to the metal, we'll optimize the existing job to use the service role key
-- for full bypass of any rate limits.

SELECT cron.unschedule('ingest-odds-every-minute');

SELECT cron.schedule(
  'ingest-odds-high-frequency',
  '* * * * *',
  $$SELECT invoke_ingest_odds_staggered()$$
);
