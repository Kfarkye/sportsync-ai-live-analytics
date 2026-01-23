-- Schedule espn-sync to run hourly
-- This ensures future games (schedule) are populated regularly

DROP FUNCTION IF EXISTS invoke_espn_sync() CASCADE;
CREATE OR REPLACE FUNCTION invoke_espn_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url text;
  service_key text;
BEGIN
  base_url := current_setting('app.settings.supabase_url', true);
  
  -- Service role key for this function (it needs write access)
  SELECT decrypted_secret INTO service_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'supabase_service_role_key' LIMIT 1;
  
  IF base_url IS NULL OR base_url = '' THEN
    SELECT decrypted_secret INTO base_url 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_url' LIMIT 1;
  END IF;
  
  IF base_url IS NOT NULL AND service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := base_url || '/functions/v1/espn-sync',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- Schedule the cron job to run every hour at minute 0
SELECT cron.schedule(
  'espn-sync-hourly',  -- Job name
  '0 * * * *',          -- Every hour
  $$SELECT invoke_espn_sync()$$
);
