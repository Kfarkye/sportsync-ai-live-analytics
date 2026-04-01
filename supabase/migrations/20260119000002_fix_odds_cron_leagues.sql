-- Update ingest-odds-cron to include all major sports
-- This fixes the missing odds for college basketball, soccer, and tennis

-- First, unschedule the old job
SELECT cron.unschedule('ingest-odds-cron');

-- Reschedule with complete league list
SELECT cron.schedule(
  'ingest-odds-cron',
  '0 4,10,16,22 * * *',  -- Every 6 hours
  $$
  SELECT net.http_post(
    url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/ingest-odds',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true),
      'Content-Type', 'application/json',
      'x-cron-secret', 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ'
    ),
    body := '{
      "leagues": [
        "nba", 
        "nfl", 
        "nhl", 
        "mlb",
        "mens-college-basketball",
        "college-football",
        "eng.1",
        "ita.1",
        "esp.1",
        "atp",
        "wta"
      ]
    }'::jsonb
  )
  $$
);

-- Verify
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'ingest-odds-cron';
