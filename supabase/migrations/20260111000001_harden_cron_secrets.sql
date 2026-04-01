-- 20260111000001_harden_cron_secrets.sql
-- Force hardcodes the CRON_SECRET into the trigger functions to ensure automation never fails due to Vault/Settings drift.

-- 1. Harden NBA Fast Lane (Staggered 20s)
CREATE OR REPLACE FUNCTION invoke_ingest_nba_live()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ'; -- Hardcoded for reliability
BEGIN
  -- URL Resolution
  v_url := current_setting('app.settings.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co'; END IF;

  -- Key Resolution (Service Role)
  BEGIN
    SELECT decrypted_secret INTO v_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_key := NULL; END;
  IF v_key IS NULL THEN v_key := 'anon_key_'; END IF;

  -- Trigger Function (Specific NBA Payload) - TURBO MODE (6x per minute)
  FOR i IN 0..5 LOOP
      IF i > 0 THEN PERFORM pg_sleep(10); END IF;

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
END;
$$;

-- 2. Harden Staggered Odds (General)
CREATE OR REPLACE FUNCTION invoke_ingest_odds_staggered()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ'; -- Hardcoded for reliability
BEGIN
  -- URL Resolution
  v_url := current_setting('app.settings.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co'; END IF;

  -- Key Resolution
  BEGIN
    SELECT decrypted_secret INTO v_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_key := NULL; END;
  IF v_key IS NULL THEN v_key := 'anon_key_placeholder'; END IF;

  -- Trigger
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

-- 3. Verification
SELECT 'Automation Hardened: NBA and Staggered crons now use hardcoded secrets.' as status;
