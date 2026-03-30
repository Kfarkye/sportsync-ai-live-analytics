-- Live reliability janitor + rolling closure cron wiring.
-- Ensures stale in-progress games are finalized and historical gaps are repaired continuously.

CREATE OR REPLACE FUNCTION public.invoke_history_janitor()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_request_id BIGINT;
BEGIN
  v_url := NULLIF(current_setting('app.settings.supabase_url', true), '');
  IF v_url IS NULL THEN
    SELECT decrypted_secret
    INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;
  END IF;

  IF v_url IS NULL THEN
    v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  END IF;

  SELECT decrypted_secret
  INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_service_role_key'
  LIMIT 1;

  IF v_key IS NULL THEN
    RAISE WARNING 'invoke_history_janitor skipped: missing vault secret supabase_service_role_key';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/history-janitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body := jsonb_build_object(
      'stale_after_hours', 6,
      'lookback_hours', 336,
      'max_games', 600
    )
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.invoke_rolling_historical_live_closure()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_request_id BIGINT;
BEGIN
  v_url := NULLIF(current_setting('app.settings.supabase_url', true), '');
  IF v_url IS NULL THEN
    SELECT decrypted_secret
    INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;
  END IF;

  IF v_url IS NULL THEN
    v_url := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  END IF;

  SELECT decrypted_secret
  INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_service_role_key'
  LIMIT 1;

  IF v_key IS NULL THEN
    RAISE WARNING 'invoke_rolling_historical_live_closure skipped: missing vault secret supabase_service_role_key';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/backfill-historical-live-odds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body := jsonb_build_object(
      'mode', 'rolling_historical_closure',
      'window_hours', 720,
      'limit_games', 400,
      'snapshot_stale_seconds', 90,
      'leagues', jsonb_build_array(
        'nba',
        'mlb',
        'nhl',
        'nfl',
        'epl',
        'seriea',
        'bundesliga',
        'laliga',
        'ligue1',
        'mls',
        'mex.1',
        'ucl',
        'uel',
        'ned.1',
        'por.1',
        'bel.1',
        'tur.1',
        'bra.1',
        'arg.1',
        'sco.1',
        'fifa.friendly',
        'fifa.worldq.uefa'
      )
    )
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

DO $$
DECLARE
  v_janitor_job_id BIGINT;
  v_closure_job_id BIGINT;
BEGIN
  SELECT jobid
  INTO v_janitor_job_id
  FROM cron.job
  WHERE jobname = 'live-history-janitor-every-10-min'
  LIMIT 1;

  IF v_janitor_job_id IS NULL THEN
    PERFORM cron.schedule(
      'live-history-janitor-every-10-min',
      '*/10 * * * *',
      $cmd$SELECT public.invoke_history_janitor()$cmd$
    );
  ELSE
    UPDATE cron.job
    SET schedule = '*/10 * * * *',
        command = 'SELECT public.invoke_history_janitor()',
        active = TRUE
    WHERE jobid = v_janitor_job_id;
  END IF;

  SELECT jobid
  INTO v_closure_job_id
  FROM cron.job
  WHERE jobname = 'live-rolling-historical-closure-every-20-min'
  LIMIT 1;

  IF v_closure_job_id IS NULL THEN
    PERFORM cron.schedule(
      'live-rolling-historical-closure-every-20-min',
      '*/20 * * * *',
      $cmd$SELECT public.invoke_rolling_historical_live_closure()$cmd$
    );
  ELSE
    UPDATE cron.job
    SET schedule = '*/20 * * * *',
        command = 'SELECT public.invoke_rolling_historical_live_closure()',
        active = TRUE
    WHERE jobid = v_closure_job_id;
  END IF;
END;
$$;
