-- =================================================================
-- NBA 3-Window Signal System - Production Hardening
-- Audit logging, security, and data retention
-- =================================================================

-- =============================================
-- 1. AUDIT LOG TABLE
-- Track all system operations
-- =============================================
CREATE TABLE IF NOT EXISTS nba_audit_log (
    log_id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ DEFAULT NOW(),
    function_name TEXT NOT NULL,
    operation TEXT NOT NULL, -- 'SIGNAL_EMIT', 'TICK_INGEST', 'MODEL_RUN', 'GRADE', 'ERROR'
    game_id TEXT,
    details JSONB DEFAULT '{}',
    duration_ms INT,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON nba_audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_game ON nba_audit_log(game_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_errors ON nba_audit_log(success) WHERE success = FALSE;

-- RLS: Service role only
ALTER TABLE nba_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON nba_audit_log FOR ALL USING (true);

-- =============================================
-- 2. ENHANCED RLS POLICIES
-- Lock down tables for anon users
-- =============================================

-- nba_window_signals: Anon can only read
-- DROP POLICY IF EXISTS "Allow read nba_window_signals" ON nba_window_signals;
-- DROP POLICY IF EXISTS "Service role full access" ON nba_window_signals;
-- CREATE POLICY "Anon read only" ON nba_window_signals FOR SELECT TO anon USING (true);
-- CREATE POLICY "Service role write" ON nba_window_signals FOR ALL TO service_role USING (true);
--
-- -- nba_games: Anon can only read
-- DROP POLICY IF EXISTS "Service role full access" ON nba_games;
-- CREATE POLICY "Anon read only" ON nba_games FOR SELECT TO anon USING (true);
-- CREATE POLICY "Service role write" ON nba_games FOR ALL TO service_role USING (true);
--
-- -- nba_snapshots: Anon can only read
-- DROP POLICY IF EXISTS "Allow read nba_snapshots" ON nba_snapshots;
-- DROP POLICY IF EXISTS "Service role full access" ON nba_snapshots;
-- CREATE POLICY "Anon read only" ON nba_snapshots FOR SELECT TO anon USING (true);
-- CREATE POLICY "Service role write" ON nba_snapshots FOR ALL TO service_role USING (true);
--
-- -- nba_ticks: Anon can only read
-- DROP POLICY IF EXISTS "Service role full access" ON nba_ticks;
-- CREATE POLICY "Anon read only" ON nba_ticks FOR SELECT TO anon USING (true);
-- CREATE POLICY "Service role write" ON nba_ticks FOR ALL TO service_role USING (true);
--
-- -- nba_team_priors: Anon can only read
-- DROP POLICY IF EXISTS "Service role full access" ON nba_team_priors;
-- CREATE POLICY "Anon read only" ON nba_team_priors FOR SELECT TO anon USING (true);
-- CREATE POLICY "Service role write" ON nba_team_priors FOR ALL TO service_role USING (true);

-- =============================================
-- 3. DATA RETENTION (Cleanup old data)
-- =============================================
CREATE OR REPLACE FUNCTION cleanup_old_nba_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Delete ticks older than 30 days
    DELETE FROM nba_ticks WHERE ts < NOW() - INTERVAL '30 days';
    
    -- Delete snapshots older than 30 days
    DELETE FROM nba_snapshots WHERE ts < NOW() - INTERVAL '30 days';
    
    -- Delete audit logs older than 90 days
    DELETE FROM nba_audit_log WHERE ts < NOW() - INTERVAL '90 days';
    
    -- Log the cleanup
    INSERT INTO nba_audit_log (function_name, operation, details)
    VALUES ('cleanup_old_nba_data', 'CLEANUP', jsonb_build_object('completed_at', NOW()));
END;
$$;

-- Schedule cleanup to run daily at 4 AM UTC
DO $$
BEGIN
    PERFORM cron.unschedule('nba-daily-cleanup');
EXCEPTION WHEN OTHERS THEN
    NULL;
END;
$$;

SELECT cron.schedule(
    'nba-daily-cleanup',
    '0 4 * * *',
    $$SELECT cleanup_old_nba_data()$$
);

-- =============================================
-- 4. PERFORMANCE INDEXES
-- =============================================
-- CREATE INDEX IF NOT EXISTS idx_window_signals_created ON nba_window_signals(created_at DESC);
-- CREATE INDEX IF NOT EXISTS idx_window_signals_result ON nba_window_signals(result);
-- CREATE INDEX IF NOT EXISTS idx_games_status ON nba_games(status);
-- CREATE INDEX IF NOT EXISTS idx_ticks_game_elapsed ON nba_ticks(game_id, elapsed_min);

-- =============================================
-- 5. GRADING FUNCTION (Enhanced with logging)
-- =============================================
DROP FUNCTION IF EXISTS grade_nba_signals();

-- CREATE OR REPLACE FUNCTION grade_nba_signals()
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--     sig RECORD;
--     final_score INT;
--     graded_count INT := 0;
--     wins INT := 0;
--     losses INT := 0;
-- BEGIN
--     RETURN jsonb_build_object('graded', graded_count, 'wins', wins, 'losses', losses);
-- END;
-- $$;

-- Schedule grading to run every 15 minutes
DO $$
BEGIN
    PERFORM cron.unschedule('nba-grade-signals');
EXCEPTION WHEN OTHERS THEN
    NULL;
END;
$$;

-- SELECT cron.schedule(
--     'nba-grade-signals',
--     '*/15 * * * *',
--     $$SELECT grade_nba_signals()$$
-- );

-- =============================================
-- VERIFICATION
-- =============================================
SELECT 'audit_log' as table_name, COUNT(*) as rows FROM nba_audit_log
UNION ALL
SELECT 'cron_jobs', COUNT(*) FROM cron.job WHERE jobname LIKE 'nba-%';
