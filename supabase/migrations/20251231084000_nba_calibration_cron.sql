-- NBA Weekly Calibration Cron Job
-- Runs every Monday at 6 AM UTC to calibrate model parameters

-- Enable pg_cron if not already enabled
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the calibration job
SELECT cron.schedule(
  'nba-weekly-calibration',
  '0 6 * * 1',  -- Every Monday at 6:00 AM UTC
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/nba-calibrate-weekly',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'season', '2024-25'
      )
    );
  $$
);

-- Verify the job was created
SELECT * FROM cron.job WHERE jobname = 'nba-weekly-calibration';
