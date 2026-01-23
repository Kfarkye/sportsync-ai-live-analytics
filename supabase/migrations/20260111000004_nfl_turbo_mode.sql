-- 20260111000004_nfl_turbo_mode.sql
-- Optimizes update frequency for NFL by creating a dedicated "Fast Lane" cron.
-- This ensures NFL updates are not blocked by the serial processing of other sports.

CREATE OR REPLACE FUNCTION invoke_ingest_nfl_live()
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
     v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  END IF;

  -- 2. Secure Secret Retrieval (Vault)
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  
  -- Fallback prevention: Fail Securely
  IF v_key IS NULL OR v_secret IS NULL THEN 
    RAISE EXCEPTION 'Secrets missing in Vault. Cannot execute NFL Turbo Cron.'; 
  END IF;

  -- 3. Trigger Function (Specific NFL Payload) - TURBO MODE (3x per minute)
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
          body := '{"sport_key": "americanfootball_nfl"}'::jsonb
        );
    END LOOP;
  END IF;
END;
$$;

-- Schedule: Every Minute (Fast Lane)
SELECT cron.schedule(
  'ingest-nfl-live-fast',
  '* * * * *', 
  $$SELECT invoke_ingest_nfl_live()$$
);
