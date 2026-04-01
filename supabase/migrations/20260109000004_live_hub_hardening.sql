-- 20260109000004_live_hub_hardening.sql
-- Fixes missing 'opening_odds' column in live_game_state
-- Hardens 'invoke_ingest_live_games' function.

-- 1. Ensure columns exist in live_game_state
ALTER TABLE public.live_game_state 
ADD COLUMN IF NOT EXISTS opening_odds JSONB;

-- 2. Harden the cron trigger function (same logic as ingest-odds)
CREATE OR REPLACE FUNCTION invoke_ingest_live_games()
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
    v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  END IF;

  -- 2. Try to get Service Key
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
      url := v_url || '/functions/v1/ingest-live-games',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;
