-- Restore/guarantee high-frequency live ingest heartbeat by canonical jobname.
-- This is the core cadence required for stale PBP/snapshot prevention.

DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = 'high-frequency-live-ingest'
  LIMIT 1;

  IF v_job_id IS NULL THEN
    PERFORM cron.schedule(
      'high-frequency-live-ingest',
      '* * * * *',
      $cmd$SELECT invoke_ingest_live_games()$cmd$
    );
  ELSE
    UPDATE cron.job
    SET schedule = '* * * * *',
        command = 'SELECT invoke_ingest_live_games()',
        active = TRUE
    WHERE jobid = v_job_id;
  END IF;
END $$;
