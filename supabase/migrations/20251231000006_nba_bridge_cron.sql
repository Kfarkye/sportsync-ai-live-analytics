
-- NBA BRIDGE CRON JOB
-- Automates live data synchronization for NBA Totals every minute

-- Helper function to invoke the nba-bridge edge function
CREATE OR REPLACE FUNCTION invoke_nba_bridge()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url text;
  service_key text;
BEGIN
  -- Get configuration
  base_url := current_setting('app.settings.supabase_url', true);
  
  -- Service role key (required to invoke internal functions and bypass RLS if needed)
  SELECT decrypted_secret INTO service_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'supabase_service_role_key' LIMIT 1;
  
  -- Fallback for local/experimental environments
  IF base_url IS NULL OR base_url = '' THEN
    SELECT decrypted_secret INTO base_url 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_url' LIMIT 1;
  END IF;
  
  -- Make the HTTP call
  IF base_url IS NOT NULL AND service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := base_url || '/functions/v1/nba-bridge',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- Schedule the cron job to run every minute
SELECT cron.schedule(
  'nba-bridge-live-sync',
  '* * * * *',
  $$SELECT invoke_nba_bridge()$$
);
