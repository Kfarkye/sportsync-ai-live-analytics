-- PREGAME CONTEXT CRON JOB
-- Runs every 4 hours to generate pregame context for upcoming games

-- Helper function to invoke the generate-pregame-context edge function
CREATE OR REPLACE FUNCTION invoke_generate_pregame_context()
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
  
  -- Service role key
  SELECT decrypted_secret INTO service_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'supabase_service_role_key' LIMIT 1;
  
  -- Fallback
  IF base_url IS NULL OR base_url = '' THEN
    SELECT decrypted_secret INTO base_url 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_url' LIMIT 1;
  END IF;
  
  -- Make the HTTP call
  IF base_url IS NOT NULL AND service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := base_url || '/functions/v1/generate-pregame-context',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- Schedule the cron job to run every 4 hours
-- 0 */4 * * * = "At minute 0 past every 4th hour"
SELECT cron.schedule(
  'generate-pregame-context-cron',
  '0 */4 * * *',
  $$SELECT invoke_generate_pregame_context()$$
);

-- Also run at 6 AM and 12 PM ET (11 AM and 5 PM UTC) for game day coverage
SELECT cron.schedule(
  'generate-pregame-context-morning',
  '0 11 * * *',
  $$SELECT invoke_generate_pregame_context()$$
);

SELECT cron.schedule(
  'generate-pregame-context-afternoon',
  '0 17 * * *',
  $$SELECT invoke_generate_pregame_context()$$
);
