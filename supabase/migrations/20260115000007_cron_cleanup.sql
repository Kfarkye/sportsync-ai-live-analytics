-- Cron Cleanup: Remove dead and duplicate jobs
-- Reduces noise and prevents resource waste

-- 1. Remove Job 52 (nba-bridge-simple) - Empty command, dead code
SELECT cron.unschedule('nba-bridge-simple');

-- 2. Remove Job 72 (live-game-ingest-1min) - Duplicate of sport-specific jobs 64, 71
SELECT cron.unschedule('live-game-ingest-1min');

-- 3. Remove Job 80 (high-frequency-live-ingest) - Duplicate of sport-specific jobs 64, 71, 73
SELECT cron.unschedule('high-frequency-live-ingest');

-- 4. Remove Job 82 (pregame-intel-refresh 30m) - Superseded by Job 87 (5m)
SELECT cron.unschedule('pregame-intel-refresh');

-- Verify remaining jobs
SELECT jobid, jobname, schedule FROM cron.job ORDER BY jobid;
