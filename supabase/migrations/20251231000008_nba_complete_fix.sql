-- =================================================================
-- NBA LIVE TOTALS - COMPLETE FIX
-- Run this ONCE to fix all missing tables and enable automation
-- =================================================================

-- =============================================
-- PART 1: Add status column to nba_games
-- =============================================
-- ALTER TABLE nba_games ADD COLUMN IF NOT EXISTS status TEXT;;

-- Ensure nba_ticks has all required columns
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS home_3pa INT DEFAULT 0;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS home_3pm INT DEFAULT 0;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS away_3pa INT DEFAULT 0;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS away_3pm INT DEFAULT 0;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS home_stats JSONB;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS away_stats JSONB;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS poss_home NUMERIC;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS poss_away NUMERIC;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS pace_home NUMERIC;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS pace_away NUMERIC;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS o_eff_home NUMERIC;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS o_eff_away NUMERIC;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS d_eff_home NUMERIC;
-- ALTER TABLE nba_ticks ADD COLUMN IF NOT EXISTS d_eff_away NUMERIC;

-- =============================================
-- PART 2: Seed nba_team_priors
-- =============================================
-- INSERT INTO nba_team_priors (season, team, pace_pre48, exp_3pa_rate, exp_3p_pct, exp_2p_pct, exp_ftr, exp_tov_pct, exp_orb_pct) VALUES
-- ('2024-25', 'Boston Celtics', 99.2, 0.42, 0.381, 0.54, 0.28, 0.12, 0.25),
-- ... (rest of data)
--     exp_orb_pct = EXCLUDED.exp_orb_pct;

-- Copy to 2025-26 season
-- INSERT INTO nba_team_priors (season, team, pace_pre48, exp_3pa_rate, exp_3p_pct, exp_2p_pct, exp_ftr, exp_tov_pct, exp_orb_pct)
-- SELECT '2025-26', team, pace_pre48, exp_3pa_rate, exp_3p_pct, exp_2p_pct, exp_ftr, exp_tov_pct, exp_orb_pct
-- FROM nba_team_priors WHERE season = '2024-25'
-- ON CONFLICT (season, team) DO NOTHING;

-- =============================================
-- PART 3: Add model_total_prediction to snapshots
-- =============================================
-- ALTER TABLE nba_snapshots ADD COLUMN IF NOT EXISTS model_total_prediction NUMERIC DEFAULT 220;

-- =============================================
-- PART 4: Setup Cron Job for nba-bridge
-- =============================================
-- Safely remove old jobs (ignore errors if they don't exist)
DO $$
BEGIN
    PERFORM cron.unschedule('nba-bridge-simple');
EXCEPTION WHEN OTHERS THEN
    NULL; -- Job doesn't exist, ignore
END;
$$;

DO $$
BEGIN
    PERFORM cron.unschedule('nba-bridge-live-sync');
EXCEPTION WHEN OTHERS THEN
    NULL; -- Job doesn't exist, ignore
END;
$$;

-- Create new robust job (runs every minute)
SELECT cron.schedule(
    'nba-bridge-simple',
    '* * * * *',
    $$
    select net.http_post(
        url:='https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/nba-bridge',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
    $$
);

-- =============================================
-- VERIFICATION
-- =============================================
-- SELECT 'nba_team_priors' as check_name, COUNT(*) as records FROM nba_team_priors;
-- SELECT 'cron jobs' as check_name, jobname, schedule FROM cron.job WHERE jobname LIKE 'nba-%';
