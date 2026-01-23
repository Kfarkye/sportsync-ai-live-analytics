-- 20260112000015_cron_overhaul.sql
-- SRE OVERHAUL: Standardize all cron triggers with hardcoded service_role keys.
-- This ensures 100% autonomous execution overnight by bypassing Vault lookups and RLS.

-- ============================================================================
-- 1. HARDCODED CREDENTIALS (Project: qffzvrnbzabcokqqrwbv)
-- ============================================================================
-- URL: https://qffzvrnbzabcokqqrwbv.supabase.co
-- SERVICE_ROLE_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk
-- CRON_SECRET: XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ

-- ============================================================================
-- 2. STANDARDIZED INVOCATION WRAPPERS
-- ============================================================================

-- A) invoke_pregame_intel_cron (The Missing Discovery Link)
CREATE OR REPLACE FUNCTION invoke_pregame_intel_cron()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/pregame-intel-cron',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key, 
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret,
      'user-agent', 'pg_net'
    ),
    body := '{"is_cron": true}'::jsonb
  );
END;
$$;

-- B) invoke_ingest_odds (General Ingest)
CREATE OR REPLACE FUNCTION invoke_ingest_odds()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/ingest-odds',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key, 
      'Content-Type', 'application/json', 
      'x-cron-secret', v_secret,
      'user-agent', 'pg_net'
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- C) invoke_ingest_live_games (Scoreboard Authority)
CREATE OR REPLACE FUNCTION invoke_ingest_live_games()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/ingest-live-games',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key, 
      'Content-Type', 'application/json', 
      'x-cron-secret', v_secret,
      'user-agent', 'pg_net'
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- D) invoke_espn_sync (Context Logic)
CREATE OR REPLACE FUNCTION invoke_espn_sync()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/espn-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key, 
      'Content-Type', 'application/json', 
      'x-cron-secret', v_secret,
      'user-agent', 'pg_net'
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- E) invoke_match_discovery (Opening Lines)
CREATE OR REPLACE FUNCTION invoke_match_discovery()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/capture-opening-lines',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key, 
      'Content-Type', 'application/json', 
      'x-cron-secret', v_secret,
      'user-agent', 'pg_net'
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- ============================================================================
-- 3. SCHEDULE RE-ALIGNMENT
-- ============================================================================

-- Ensure the pregame discovery is running every 10 minutes
SELECT cron.unschedule('pregame-intel-research-cron');
SELECT cron.schedule(
  'pregame-intel-research-cron',
  '*/10 * * * *',
  $$SELECT invoke_pregame_intel_cron()$$
);

-- Ensure ingest-odds is staggered correctly (every minute)
SELECT cron.unschedule('ingest-odds-high-frequency');
SELECT cron.schedule(
  'ingest-odds-high-frequency',
  '* * * * *',
  $$SELECT invoke_ingest_odds()$$
);

-- Ensure live-games is firing (every minute)
SELECT cron.unschedule('high-frequency-live-ingest');
SELECT cron.schedule(
  'high-frequency-live-ingest',
  '* * * * *',
  $$SELECT invoke_ingest_live_games()$$
);

SELECT 'CRON OVERHAUL COMPLETE: All triggers now use service_role + hardcoded secrets.' as status;
