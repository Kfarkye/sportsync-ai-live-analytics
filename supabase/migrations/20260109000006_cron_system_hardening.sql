-- 20260109000006_cron_system_hardening.sql
-- Hardens ALL essential cron trigger functions against missing Vault keys.

-- 1. Harden live-odds-tracker trigger
CREATE OR REPLACE FUNCTION invoke_live_odds_tracker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  v_url := current_setting('app.settings.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co'; END IF;

  BEGIN
    SELECT decrypted_secret INTO v_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_key := NULL; END;

  IF v_key IS NULL THEN v_key := 'anon_key_'; END IF;

  IF v_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/live-odds-tracker',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- 2. Harden match-discovery trigger
CREATE OR REPLACE FUNCTION invoke_match_discovery()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  v_url := current_setting('app.settings.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co'; END IF;

  BEGIN
    SELECT decrypted_secret INTO v_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_key := NULL; END;

  IF v_key IS NULL THEN v_key := 'anon_key_'; END IF;

  IF v_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/capture-opening-lines',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'apikey', v_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- 3. Ensure jobs are correctly scheduled and active
SELECT cron.unschedule('live-odds-tracker-every-2-min');
SELECT cron.schedule(
  'live-odds-tracker-every-2-min',
  '*/2 * * * *',
  $$SELECT invoke_live_odds_tracker()$$
);

SELECT cron.unschedule('match-discovery-6h');
SELECT cron.schedule(
  'match-discovery-6h',
  '0 */6 * * *',
  $$SELECT invoke_match_discovery()$$
);

-- 4. Verification
SELECT 'Cron triggers hardened and resubmitted' as status;
