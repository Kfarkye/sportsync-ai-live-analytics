-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres user
GRANT USAGE ON SCHEMA cron TO postgres;

-- Setup Cron Job to call ingest-odds every minute
-- This ensures live odds are refreshed regularly

-- First, create a helper function to invoke edge functions via pg_net
DROP FUNCTION IF EXISTS invoke_ingest_odds() CASCADE;
CREATE OR REPLACE FUNCTION invoke_ingest_odds()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url text;
  anon_key text;
BEGIN
  -- Get the Supabase URL from configuration
  base_url := current_setting('app.settings.supabase_url', true);
  anon_key := current_setting('app.settings.supabase_anon_key', true);
  
  -- If not configured, use vault secrets
  IF base_url IS NULL OR base_url = '' THEN
    SELECT decrypted_secret INTO base_url 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_url' LIMIT 1;
  END IF;
  
  IF anon_key IS NULL OR anon_key = '' THEN
    SELECT decrypted_secret INTO anon_key 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_anon_key' LIMIT 1;
  END IF;
  
  -- Make the HTTP call to the edge function
  IF base_url IS NOT NULL AND anon_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := base_url || '/functions/v1/ingest-odds',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || anon_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- Schedule the cron job to run every minute
-- NOTE: pg_cron syntax uses UTC time
SELECT cron.schedule(
  'ingest-odds-every-minute',  -- Job name
  '* * * * *',                  -- Every minute
  $$SELECT invoke_ingest_odds()$$
);

-- Also schedule live-odds-tracker for match status updates
DROP FUNCTION IF EXISTS invoke_live_odds_tracker() CASCADE;
CREATE OR REPLACE FUNCTION invoke_live_odds_tracker()
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
      url := base_url || '/functions/v1/live-odds-tracker',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

-- Schedule live-odds-tracker every 2 minutes
SELECT cron.schedule(
  'live-odds-tracker-every-2-min',
  '*/2 * * * *',  -- Every 2 minutes
  $$SELECT invoke_live_odds_tracker()$$
);

-- View scheduled jobs
-- SELECT * FROM cron.job;
