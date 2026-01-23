-- 20260112000013_add_seriea_cron.sql
-- Add Serie A live odds ingestion cron job

-- Create the invoke function for Serie A
CREATE OR REPLACE FUNCTION invoke_ingest_seriea_live()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/ingest-odds',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"sport_key": "soccer_italy_serie_a"}'::jsonb
  );
END;
$$;

-- Schedule Serie A cron every 2 minutes (same as other live ingests)
SELECT cron.schedule(
  'ingest-seriea-live',
  '*/2 * * * *',
  'SELECT invoke_ingest_seriea_live()'
);

SELECT 'Serie A cron job added: soccer_italy_serie_a every 2 minutes' as status;
