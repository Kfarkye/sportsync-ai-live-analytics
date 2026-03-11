-- Migration: remove_duplicate_ingest_odds_cron
-- Keep the primary every-minute odds ingest and remove the redundant 15-minute duplicate.

SELECT cron.unschedule(88);
SELECT cron.unschedule('ingest-odds-high-frequency');
