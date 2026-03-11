-- Migration: harden_invoke_live_odds_tracker_auth
-- Use both Authorization and apikey headers when pg_cron invokes the
-- live-odds-tracker edge function so gateway auth does not silently drop the request.

CREATE OR REPLACE FUNCTION public.invoke_live_odds_tracker()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  service_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/live-odds-tracker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key
    ),
    body := '{}'::jsonb
  ) INTO request_id;

  RETURN request_id;
END;
$$;
