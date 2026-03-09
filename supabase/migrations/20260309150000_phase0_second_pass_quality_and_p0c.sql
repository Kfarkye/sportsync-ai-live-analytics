-- ============================================================================
-- Phase 0 Second Pass Quality + P0-C (NCAAB COALESCE fix)
--  - Hardens snapshot health timing and cron completeness checks
--  - Patches get_all_trends NCAAB_ATS to use COALESCE(opening_odds, current_odds)
-- ============================================================================

-- --------------------------------------------------------------------------
-- Ops hardening: make vault reader and cron wrappers explicit-search-path
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._vault_secret(p_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
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
SET search_path = public, net, pg_temp
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
    url := rtrim(v_url, '/') || '/functions/v1/batch-recap-generator',
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
SET search_path = public, net, pg_temp
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
    url := rtrim(v_url, '/') || '/functions/v1/sharp-picks-cron',
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
SET search_path = public, net, pg_temp
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
    url := rtrim(v_url, '/') || '/functions/v1/ingest-game-events',
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

CREATE OR REPLACE FUNCTION public.invoke_scan_injuries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  v_url text := public._vault_secret('supabase_url');
  v_key text := public._vault_secret('supabase_service_role_key');
BEGIN
  -- Fallback path keeps injury snapshots flowing if edge-function auth/env degrades.
  IF v_url IS NULL OR btrim(v_url) = '' OR v_key IS NULL OR btrim(v_key) = '' THEN
    PERFORM public.capture_injury_snapshots_from_espn_athletes();
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/scan-injuries',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$$;

-- --------------------------------------------------------------------------
-- Snapshot health correctness: use write-time for injury freshness
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.snapshot_health_check()
RETURNS TABLE (
  table_name text,
  row_count bigint,
  last_record timestamptz,
  expected_cadence interval,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.table_name,
    s.row_count,
    s.last_record,
    s.expected_cadence,
    CASE
      WHEN s.last_record IS NULL THEN 'NEVER_ACTIVATED'
      WHEN s.last_record < now() - (s.expected_cadence * 3) THEN 'STALE'
      ELSE 'HEALTHY'
    END AS status
  FROM (
    SELECT 'live_game_state'::text AS table_name, count(*)::bigint AS row_count, max(updated_at) AS last_record, interval '6 minutes' AS expected_cadence FROM public.live_game_state
    UNION ALL
    SELECT 'espn_summary_snapshots', count(*)::bigint, max(snapshot_at), interval '24 hours' FROM public.espn_summary_snapshots
    UNION ALL
    SELECT 'price_snapshots', count(*)::bigint, max(captured_at), interval '24 hours' FROM public.price_snapshots
    UNION ALL
    SELECT 'live_forecast_snapshots', count(*)::bigint, max(created_at), interval '6 minutes' FROM public.live_forecast_snapshots
    UNION ALL
    SELECT 'ai_chat_picks', count(*)::bigint, max(created_at), interval '24 hours' FROM public.ai_chat_picks
    UNION ALL
    SELECT 'injury_snapshots', count(*)::bigint, max(created_at), interval '24 hours' FROM public.injury_snapshots
    UNION ALL
    SELECT 'prediction_market_snapshots', count(*)::bigint, max(captured_at), interval '6 minutes' FROM public.prediction_market_snapshots
    UNION ALL
    SELECT 'live_signal_snapshots', count(*)::bigint, max(snapshot_at), interval '6 minutes' FROM public.live_signal_snapshots
    UNION ALL
    SELECT 'ai_pick_snapshots', count(*)::bigint, max(created_at), interval '24 hours' FROM public.ai_pick_snapshots
    UNION ALL
    SELECT 'soccer_live_odds_snapshots', count(*)::bigint, max(captured_at), interval '10 minutes' FROM public.soccer_live_odds_snapshots
    UNION ALL
    SELECT 'live_context_snapshots', count(*)::bigint, max(captured_at), interval '6 minutes' FROM public.live_context_snapshots
    UNION ALL
    SELECT 'poly_price_history', count(*)::bigint, max(snapshot_at), interval '6 minutes' FROM public.poly_price_history
  ) s
  ORDER BY
    CASE
      WHEN s.last_record IS NULL THEN 1
      WHEN s.last_record < now() - (s.expected_cadence * 3) THEN 2
      ELSE 3
    END,
    s.table_name;
$$;

-- --------------------------------------------------------------------------
-- Second-pass guardrail: assert all required snapshot cron jobs are active
-- --------------------------------------------------------------------------

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(req.jobname ORDER BY req.jobname)
  INTO v_missing
  FROM (
    VALUES
      ('live-signal-snapshots-2m'),
      ('ai-pick-snapshots-30m'),
      ('soccer-live-odds-snapshots-5m'),
      ('prediction-market-snapshots-2m'),
      ('poly-price-history-2m'),
      ('live-forecast-snapshots-2m'),
      ('ai-chat-picks-from-intel-hourly'),
      ('injury-snapshots-daily'),
      ('snapshot-health-monitor-daily')
  ) AS req(jobname)
  LEFT JOIN cron.job j
    ON j.jobname = req.jobname
   AND j.active = true
  WHERE j.jobid IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing or inactive required snapshot cron jobs: %', array_to_string(v_missing, ', ');
  END IF;
END;
$$;

-- --------------------------------------------------------------------------
-- P0-C: patch get_all_trends NCAAB_ATS layer with opening/current COALESCE
-- --------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regprocedure('public.get_all_trends__legacy(numeric)') IS NULL THEN
    IF to_regprocedure('public.get_all_trends(numeric)') IS NULL THEN
      RAISE EXCEPTION 'Expected function public.get_all_trends(numeric) not found';
    END IF;

    EXECUTE 'ALTER FUNCTION public.get_all_trends(numeric) RENAME TO get_all_trends__legacy';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_all_trends(min_rate numeric DEFAULT 0.55)
RETURNS TABLE(
  layer text,
  league text,
  entity text,
  trend text,
  hit_rate numeric,
  sample integer,
  visibility text,
  data_window text,
  metric_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH base AS (
  SELECT
    b.layer,
    b.league,
    b.entity,
    b.trend,
    b.hit_rate,
    b.sample,
    b.visibility,
    b.data_window,
    b.metric_type
  FROM public.get_all_trends__legacy(min_rate) b
),
raw_games AS (
  SELECT
    m.id,
    m.home_score,
    m.away_score,
    COALESCE(
      public._phase0_to_numeric(m.opening_odds ->> 'homeSpread'),
      public._phase0_to_numeric(m.opening_odds ->> 'home_spread'),
      public._phase0_to_numeric(m.opening_odds ->> 'spread_home'),
      public._phase0_to_numeric(m.opening_odds ->> 'spread_home_value'),
      public._phase0_to_numeric(m.opening_odds ->> 'spread'),
      public._phase0_to_numeric(m.current_odds ->> 'homeSpread'),
      public._phase0_to_numeric(m.current_odds ->> 'home_spread'),
      public._phase0_to_numeric(m.current_odds ->> 'spread_home'),
      public._phase0_to_numeric(m.current_odds ->> 'spread_home_value'),
      public._phase0_to_numeric(m.current_odds ->> 'spread'),
      CASE
        WHEN public._phase0_to_numeric(m.opening_odds ->> 'awaySpread') IS NOT NULL THEN -public._phase0_to_numeric(m.opening_odds ->> 'awaySpread')
        WHEN public._phase0_to_numeric(m.opening_odds ->> 'away_spread') IS NOT NULL THEN -public._phase0_to_numeric(m.opening_odds ->> 'away_spread')
        WHEN public._phase0_to_numeric(m.opening_odds ->> 'spread_away') IS NOT NULL THEN -public._phase0_to_numeric(m.opening_odds ->> 'spread_away')
        WHEN public._phase0_to_numeric(m.opening_odds ->> 'spread_away_value') IS NOT NULL THEN -public._phase0_to_numeric(m.opening_odds ->> 'spread_away_value')
        WHEN public._phase0_to_numeric(m.current_odds ->> 'awaySpread') IS NOT NULL THEN -public._phase0_to_numeric(m.current_odds ->> 'awaySpread')
        WHEN public._phase0_to_numeric(m.current_odds ->> 'away_spread') IS NOT NULL THEN -public._phase0_to_numeric(m.current_odds ->> 'away_spread')
        WHEN public._phase0_to_numeric(m.current_odds ->> 'spread_away') IS NOT NULL THEN -public._phase0_to_numeric(m.current_odds ->> 'spread_away')
        WHEN public._phase0_to_numeric(m.current_odds ->> 'spread_away_value') IS NOT NULL THEN -public._phase0_to_numeric(m.current_odds ->> 'spread_away_value')
        ELSE NULL
      END
    ) AS home_spread
  FROM public.matches m
  WHERE lower(COALESCE(m.league_id, '')) IN ('mens-college-basketball', 'ncaab')
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
    AND (
      upper(COALESCE(m.status, '')) LIKE '%FINAL%'
      OR upper(COALESCE(m.status, '')) LIKE '%FINISHED%'
      OR upper(COALESCE(m.status, '')) LIKE '%COMPLETE%'
    )
),
scored AS (
  SELECT
    CASE
      WHEN rg.home_spread > 0 THEN rg.home_spread
      WHEN rg.home_spread < 0 THEN -rg.home_spread
      ELSE NULL
    END AS dog_line,
    CASE
      WHEN rg.home_spread > 0 THEN CASE WHEN (rg.home_score + rg.home_spread) > rg.away_score THEN 1 ELSE 0 END
      WHEN rg.home_spread < 0 THEN CASE WHEN (rg.away_score - rg.home_spread) > rg.home_score THEN 1 ELSE 0 END
      ELSE NULL
    END AS dog_cover_flag
  FROM raw_games rg
  WHERE rg.home_spread IS NOT NULL
    AND rg.home_spread <> 0
),
bucketed AS (
  SELECT
    CASE
      WHEN dog_line >= 0 AND dog_line < 5 THEN 'Dog +0-5'
      WHEN dog_line >= 5 AND dog_line < 10 THEN 'Dog +5-10'
      WHEN dog_line >= 10 AND dog_line < 15 THEN 'Dog +10-15'
      WHEN dog_line >= 15 THEN 'Dog +15+'
      ELSE NULL
    END AS entity,
    dog_cover_flag
  FROM scored
),
ncaab_ats AS (
  SELECT
    'NCAAB_ATS'::text AS layer,
    'ncaab'::text AS league,
    b.entity,
    'DOG ATS'::text AS trend,
    round(avg(b.dog_cover_flag)::numeric * 100.0, 1) AS hit_rate,
    count(*)::integer AS sample,
    'PROPRIETARY'::text AS visibility,
    '2025-26 season'::text AS data_window,
    'rate'::text AS metric_type
  FROM bucketed b
  WHERE b.entity IS NOT NULL
  GROUP BY b.entity
  HAVING count(*) >= 10
     AND avg(b.dog_cover_flag)::numeric >= GREATEST(COALESCE(min_rate, 0), 0)
)
SELECT *
FROM base
WHERE layer <> 'NCAAB_ATS'

UNION ALL

SELECT *
FROM ncaab_ats;
$$;

REVOKE ALL ON FUNCTION public.get_all_trends(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_trends(numeric) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_all_trends(numeric)
IS 'Returns trend layers with NCAAB_ATS computed from COALESCE(opening_odds, current_odds) to prevent missing-spread undercount.';
