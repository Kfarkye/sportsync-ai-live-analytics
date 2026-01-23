-- ============================================================================
-- FINAL CRON CLEANUP
-- ============================================================================
-- The previous optimization script was successful, but we have one remaining
-- duplicate job that needs to be removed.
-- ============================================================================

-- Remove Job 15 (Old 'generate-daily-thesis' with hardcoded token)
-- We are keeping Job 18 ('daily-thesis-fixed') which uses the secure service_key
SELECT cron.unschedule(15);

-- Verify final list
SELECT * FROM cron.job;
