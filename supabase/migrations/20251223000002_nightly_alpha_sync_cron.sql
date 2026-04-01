
-- NIGHTLY ALPHA SYNC CRON JOB
-- Automates high-fidelity AI narrative pre-generation for all upcoming games

-- Helper function to invoke the nightly-alpha-sync edge function
CREATE OR REPLACE FUNCTION invoke_nightly_alpha_sync()
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
      url := base_url || '/functions/v1/nightly-alpha-sync',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- Schedule the cron job to run at 05:00 UTC (Midnight ET)
-- 0 5 * * * = "At 05:00 every day"
SELECT cron.schedule(
  'nightly-alpha-sync-midnight-et',
  '0 5 * * *',
  $$SELECT invoke_nightly_alpha_sync()$$
);

-- Documentation:
-- This job ensures that all games for the next 24 hours have their "Mathematical Audit" 
-- and "AI Narrative Synthesis" pre-generated and stored in match_news.
-- This reduces frontend latency to 0ms for the user in the morning.
