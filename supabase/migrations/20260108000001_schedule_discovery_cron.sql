
-- 20260108000001_schedule_discovery_cron.sql
-- Systematic match discovery via capture-opening-lines Edge Function

CREATE OR REPLACE FUNCTION invoke_match_discovery()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url text;
  service_key text;
BEGIN
  -- Get the Supabase URL from configuration
  base_url := current_setting('app.settings.supabase_url', true);
  
  -- If not configured in app settings, fall back to vault
  IF base_url IS NULL OR base_url = '' THEN
    SELECT decrypted_secret INTO base_url 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_url' LIMIT 1;
  END IF;

  -- Get service role key for write access
  SELECT decrypted_secret INTO service_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'supabase_service_role_key' LIMIT 1;
  
  IF base_url IS NOT NULL AND service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := base_url || '/functions/v1/capture-opening-lines',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'apikey', service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- Schedule the discovery job to run every 6 hours
-- Using 06:00, 12:00, 18:00, 00:00 UTC cycle
SELECT cron.schedule(
  'match-discovery-6h',
  '0 */6 * * *',
  $$SELECT invoke_match_discovery()$$
);

COMMENT ON FUNCTION invoke_match_discovery() IS 'Invokes capture-opening-lines edge function to discover upcoming matches across all monitored leagues.';
