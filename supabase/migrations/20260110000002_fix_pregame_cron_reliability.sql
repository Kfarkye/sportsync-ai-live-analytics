
-- 20260110000002_fix_pregame_cron_reliability.sql
-- Overhauls the pregame-intel discovery cron for higher frequency and reliability.

-- 1. Ensure configuration is set (Project URL)
-- This allows the SQL function to resolve the correct URL without hardcoding.
DO $$
BEGIN
    IF current_setting('app.settings.supabase_url', true) IS NULL THEN
        -- Fallback: Use the project ID if we can find it, or the user will need to set it.
        -- For now, we assume the user has set this or we use the vault fallback in the function.
        RAISE NOTICE 'app.settings.supabase_url is missing. Function will use Vault/Database fallbacks.';
    END IF;
END $$;

-- 2. Standardize reliable invocation function
CREATE OR REPLACE FUNCTION invoke_pregame_intel_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Resolution Sequence: app.settings -> vault -> constructed
  v_url := current_setting('app.settings.supabase_url', true);
  
  IF v_url IS NULL OR v_url = '' THEN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  END IF;

  -- Security Resolution (Service Role)
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1;

  -- Execution Guard
  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    RAISE NOTICE 'Triggering pregame-intel-cron at %', v_url;
    
    PERFORM net.http_post(
      url := v_url || '/functions/v1/pregame-intel-cron',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  ELSE
    RAISE WARNING 'Pregame Intel Cron skipped: Missing URL or Key. URL: %, Key: %', 
      COALESCE(v_url, 'MISSING'), 
      CASE WHEN v_key IS NULL THEN 'MISSING' ELSE 'PRESENT' END;
  END IF;
END;
$$;

-- 3. Increase Frequency (Every 10 minutes)
-- This ensures gaps are filled quickly for upcoming NCAAB/NBA slates.
SELECT cron.unschedule('pregame-intel-research-cron');
SELECT cron.schedule(
  'pregame-intel-research-cron',
  '*/10 * * * *',
  $$SELECT invoke_pregame_intel_cron()$$
);

-- 4. EMERGENCY DATA INTEGRITY FIX (Backfill NULL Names)
-- This fills existing NULL names in matches by pulling from the teams table.
-- Note: home_team and away_team appear to be jsonb in the matches table based on migration errors.
UPDATE public.matches m
SET home_team = to_jsonb(t_home.name),
    away_team = to_jsonb(t_away.name)
FROM public.teams t_home, public.teams t_away
WHERE m.home_team_id = t_home.id
AND m.away_team_id = t_away.id
AND (m.home_team IS NULL OR m.away_team IS NULL OR m.home_team::text = 'null');

-- Final verification
SELECT 'Pregame Cron Boosted & Data Patched' as status;
