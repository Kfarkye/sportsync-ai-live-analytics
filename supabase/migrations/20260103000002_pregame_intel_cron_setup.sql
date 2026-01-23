-- PREGAME INTEL CRON SETUP
-- Schedules the pregame-intel-cron edge function to run every 1 hour
-- This ensures upcoming games always have fresh research available
DROP FUNCTION IF EXISTS invoke_pregame_intel_cron() CASCADE;

CREATE OR REPLACE FUNCTION invoke_pregame_intel_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url text;
  service_key text;
BEGIN
  -- Get configuration from environment/secrets
  base_url := current_setting('app.settings.supabase_url', true);
  
  -- Service role key for bypass RLS
  SELECT decrypted_secret INTO service_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'supabase_service_role_key' LIMIT 1;
  
  -- Fallback if current_setting is not available (e.g. local)
  IF base_url IS NULL OR base_url = '' THEN
    SELECT decrypted_secret INTO base_url 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_url' LIMIT 1;
  END IF;
  
  -- If still null, try to construct likely URL (standard supabase format)
  IF base_url IS NULL OR base_url = '' THEN
     -- This is a last resort fallback
     base_url := 'https://' || current_database() || '.supabase.co';
  END IF;

  -- Make the HTTP call to the edge function
  IF base_url IS NOT NULL AND service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := base_url || '/functions/v1/pregame-intel-cron',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- Schedule the cron job to run every hour
-- 0 * * * * = "At minute 0 of every hour"
SELECT cron.schedule(
  'pregame-intel-research-cron',
  '0 * * * *',
  $$SELECT invoke_pregame_intel_cron()$$
);

-- Initial run to populate data immediately
-- Note: This only works if pg_net and pg_cron are healthy
-- SELECT invoke_pregame_intel_cron();

SELECT 'pregame_intel_research_cron scheduled' AS status;
