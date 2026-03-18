BEGIN;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT jobid INTO v_job_id
    FROM cron.job
    WHERE jobname = 'drain-kalshi-orderbook-snapshot'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'drain-kalshi-orderbook-snapshot',
      '*/5 * * * *',
      $job$
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.kalshi_events_active ke
            WHERE ke.status = 'active'
              AND ke.game_date BETWEEN ((now() AT TIME ZONE 'utc')::date - 1)
                                   AND ((now() AT TIME ZONE 'utc')::date + 2)
          ) THEN net.http_post(
            url := current_setting('app.settings.supabase_url') || '/functions/v1/drain-kalshi-orderbook',
            headers := jsonb_build_object(
              'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
              'Content-Type', 'application/json'
            ),
            body := jsonb_build_object('phase', 'snapshot', 'sport', 'all')
          )
          ELSE NULL
        END;
      $job$
    );
  END IF;
END;
$$;

COMMIT;
