BEGIN;

DO $$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
  v_service_role_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;

  v_supabase_url := nullif(current_setting('app.settings.supabase_url', true), '');
  v_service_role_key := nullif(current_setting('app.settings.service_role_key', true), '');

  IF v_supabase_url IS NULL OR v_service_role_key IS NULL THEN
    RAISE WARNING 'Kalshi discovery cron not scheduled: missing app.settings.supabase_url or app.settings.service_role_key';
    RETURN;
  END IF;

  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'drain-kalshi-orderbook-discovery',
      'drain-kalshi-orderbook-discovery-nba',
      'drain-kalshi-orderbook-discovery-ncaamb',
      'drain-kalshi-orderbook-discovery-nhl',
      'drain-kalshi-orderbook-discovery-mlb',
      'drain-kalshi-orderbook-discovery-soccer',
      'drain-kalshi-orderbook-discovery-nfl'
    )
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-nba',
    '0 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'nba',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_service_role_key)
  );

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-ncaamb',
    '2 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'ncaamb',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_service_role_key)
  );

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-nhl',
    '4 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'nhl',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_service_role_key)
  );

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-mlb',
    '6 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'mlb',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_service_role_key)
  );

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-soccer',
    '8 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'soccer',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_service_role_key)
  );

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-nfl',
    '10 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'nfl',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_service_role_key)
  );
END;
$$;

COMMIT;
