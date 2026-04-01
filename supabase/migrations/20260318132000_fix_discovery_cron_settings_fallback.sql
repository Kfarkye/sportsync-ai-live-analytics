BEGIN;

DO $$
DECLARE
  v_job_id bigint;
  v_supabase_url text;
  v_auth_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;

  v_supabase_url := COALESCE(
    NULLIF(current_setting('app.settings.supabase_url', true), ''),
    'https://qffzvrnbzabcokqqrwbv.supabase.co'
  );

  v_auth_token := COALESCE(
    NULLIF(current_setting('app.settings.service_role_key', true), ''),
    NULLIF(current_setting('app.settings.anon_key', true), ''),
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MzE4NjQsImV4cCI6MjA3OTQwNzg2NH0.GDsoxNH4nnyBndqXB4iswnvQkMfrdHr2rM16Q9wQa7s'
  );

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
          'apikey', %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'nba',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_auth_token, v_auth_token)
  );

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-ncaamb',
    '2 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'apikey', %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'ncaamb',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_auth_token, v_auth_token)
  );

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-nhl',
    '4 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'apikey', %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'nhl',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_auth_token, v_auth_token)
  );

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-mlb',
    '6 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'apikey', %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'mlb',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_auth_token, v_auth_token)
  );

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-soccer',
    '8 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'apikey', %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'soccer',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_auth_token, v_auth_token)
  );

  PERFORM cron.schedule(
    'drain-kalshi-orderbook-discovery-nfl',
    '10 8 * * *',
    format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/drain-kalshi-orderbook',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || %L,
          'apikey', %L,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'phase', 'discover',
          'sport', 'nfl',
          'max_events', 100
        )
      );
    $job$, v_supabase_url, v_auth_token, v_auth_token)
  );
END;
$$;

COMMIT;
