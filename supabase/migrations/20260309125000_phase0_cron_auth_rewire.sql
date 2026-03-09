-- Phase 0-1 (P0-B): rewire failing cron jobs so they do not depend on current_setting(app.*)
-- and restore the missing nba cleanup function.

CREATE OR REPLACE FUNCTION public._vault_secret(p_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = p_name
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.invoke_batch_recap_generator()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key text := public._vault_secret('supabase_service_role_key');
  v_url text := COALESCE(public._vault_secret('supabase_url'), 'https://qffzvrnbzabcokqqrwbv.supabase.co');
  v_req_id bigint;
BEGIN
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'Missing vault secret: supabase_service_role_key';
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/batch-recap-generator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.invoke_sharp_picks_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key text := public._vault_secret('supabase_service_role_key');
  v_url text := COALESCE(public._vault_secret('supabase_url'), 'https://qffzvrnbzabcokqqrwbv.supabase.co');
  v_req_id bigint;
BEGIN
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'Missing vault secret: supabase_service_role_key';
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/sharp-picks-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{"is_cron": true}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.invoke_ingest_game_events()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key text := public._vault_secret('supabase_service_role_key');
  v_url text := COALESCE(public._vault_secret('supabase_url'), 'https://qffzvrnbzabcokqqrwbv.supabase.co');
  v_req_id bigint;
BEGIN
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'Missing vault secret: supabase_service_role_key';
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/ingest-game-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_nba_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF to_regclass('public.nba_ticks') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.nba_ticks WHERE ts < NOW() - INTERVAL ''30 days''';
  END IF;

  IF to_regclass('public.nba_snapshots') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.nba_snapshots WHERE ts < NOW() - INTERVAL ''30 days''';
  END IF;

  IF to_regclass('public.nba_audit_log') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.nba_audit_log WHERE ts < NOW() - INTERVAL ''90 days''';
    EXECUTE '
      INSERT INTO public.nba_audit_log (function_name, operation, details)
      VALUES (''cleanup_old_nba_data'', ''CLEANUP'', jsonb_build_object(''completed_at'', NOW()))
    ';
  END IF;
END;
$$;

-- Recreate failing jobs with wrapper functions.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'batch-recap-generator-peak',
      'batch-recap-generator-overnight',
      'batch-recap-generator-afternoon',
      'sharp-picks-cron',
      'ingest-game-events',
      'nba-daily-cleanup'
    )
  LOOP
    PERFORM cron.unschedule(rec.jobid);
  END LOOP;
END;
$$;

SELECT cron.schedule('batch-recap-generator-peak', '0 0,2,4,6 * * *', $$SELECT public.invoke_batch_recap_generator()$$);
SELECT cron.schedule('batch-recap-generator-overnight', '0 10 * * *', $$SELECT public.invoke_batch_recap_generator()$$);
SELECT cron.schedule('batch-recap-generator-afternoon', '0 22 * * *', $$SELECT public.invoke_batch_recap_generator()$$);
SELECT cron.schedule('sharp-picks-cron', '30 */2 * * *', $$SELECT public.invoke_sharp_picks_cron()$$);
SELECT cron.schedule('ingest-game-events', '* 22-23,0-6 * * *', $$SELECT public.invoke_ingest_game_events()$$);
SELECT cron.schedule('nba-daily-cleanup', '0 4 * * *', $$SELECT public.cleanup_old_nba_data()$$);

REVOKE ALL ON FUNCTION public._vault_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoke_batch_recap_generator() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoke_sharp_picks_cron() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoke_ingest_game_events() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_nba_data() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.invoke_batch_recap_generator() TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_sharp_picks_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_ingest_game_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_nba_data() TO service_role;
