-- Migration: remove_duplicate_ingest_odds_cron
-- Keep the primary every-minute odds ingest and remove the redundant 15-minute duplicate.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobid = 88
      AND jobname = 'ingest-odds-high-frequency'
  ) THEN
    PERFORM cron.unschedule(88);
  ELSIF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'ingest-odds-high-frequency'
  ) THEN
    PERFORM cron.unschedule('ingest-odds-high-frequency');
  END IF;
END $$;
