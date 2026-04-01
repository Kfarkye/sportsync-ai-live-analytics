-- =================================================================
-- RESET WINDOW SIGNALS (Data Cleanup)
-- Rationale: Logic error on 2026-01-01 caused incomplete/incorrect 
-- signal generation and tracking.
-- =================================================================

-- Delete signals generated during the logic failure window (Jan 1, 2026)
DELETE FROM nba_window_signals
WHERE created_at >= '2026-01-01 00:00:00+00'
  AND created_at < '2026-01-02 00:00:00+00';

-- Recalculate record (The view nba_signal_record will reflect this automatically)
-- Graded signals should remain untouched if they were from prior dates.

SELECT 'Window signals for 2026-01-01 have been reset.' as status;
