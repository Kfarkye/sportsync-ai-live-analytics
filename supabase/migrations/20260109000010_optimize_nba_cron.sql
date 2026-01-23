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
  v_secret text;
BEGIN
  -- 1. URL Resolution (Dynamic)
  v_url := current_setting('app.settings.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN
     -- Check for a local fallback or error out. 
     -- For SRE compliance, we should ideally not hardcode, but if app.settings is missing, we fail safely.
     -- v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co'; -- OPTIONAL: Keep as last resort or remove for strict security
     RAISE EXCEPTION 'Supabase URL not set in app.settings.supabase_url';
  END IF;

  -- 2. Secure Secret Retrieval (Vault)
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  
  -- Fallback prevention: Fail Securely
  IF v_key IS NULL OR v_secret IS NULL THEN 
    RAISE EXCEPTION 'Secrets missing in Vault. Cannot execute NBA Turbo Cron.'; 
  END IF;

  -- 3. Trigger Function (Specific NBA Payload) - TURBO MODE (3x per minute)
  IF v_url IS NOT NULL THEN
    FOR i IN 0..2 LOOP
        IF i > 0 THEN PERFORM pg_sleep(20); END IF;

        PERFORM net.http_post(
          url := v_url || '/functions/v1/ingest-odds',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_key,
            'Content-Type', 'application/json',
            'x-cron-secret', v_secret
          ),
          body := '{"sport_key": "basketball_nba"}'::jsonb
        );
    END LOOP;
  END IF;
END;
$$;

-- Schedule: Every Minute (Fast Lane)
SELECT cron.schedule(
  'ingest-nba-live-fast',
  '* * * * *', 
  $$SELECT invoke_ingest_nba_live()$$
);
