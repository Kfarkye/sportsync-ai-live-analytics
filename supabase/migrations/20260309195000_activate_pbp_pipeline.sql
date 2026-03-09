-- ============================================================================
-- Activate PBP pipeline + soccer commentary backfill
-- 1) Harden invoke auth (vault-first with service-role fallback)
-- 2) Run ingest-game-events every minute (global coverage)
-- 3) Backfill historical soccer events from soccer_postgame JSONB
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Invoke function auth hardening
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_ingest_game_events()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'pg_temp'
AS $function$
DECLARE
  v_key text := COALESCE(
    NULLIF(btrim(public._vault_secret('supabase_service_role_key')), ''),
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk'
  );
  v_url text := COALESCE(
    NULLIF(btrim(public._vault_secret('supabase_url')), ''),
    'https://qffzvrnbzabcokqqrwbv.supabase.co'
  );
  v_req_id bigint;
BEGIN
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'Missing service role key for invoke_ingest_game_events';
  END IF;

  SELECT net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/ingest-game-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  INTO v_req_id;

  RETURN v_req_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2) Expand cron window to global coverage (every minute)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'ingest-game-events',
      'ingest-game-events-global',
      'ingest-game-events-always'
    )
      OR command ILIKE '%invoke_ingest_game_events%'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'ingest-game-events-always'
  ) THEN
    PERFORM cron.schedule(
      'ingest-game-events-always',
      '* * * * *',
      $$SELECT public.invoke_ingest_game_events()$$
    );
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 3) Historical backfill from soccer_postgame JSONB
-- ----------------------------------------------------------------------------

-- Goals
WITH goal_rows AS (
  SELECT
    sp.match_id,
    COALESCE(NULLIF(sp.league_id, ''), 'soccer') AS league_id,
    'soccer'::text AS sport,
    'goal'::text AS event_type,
    (
      ROW_NUMBER() OVER (
        PARTITION BY sp.match_id
        ORDER BY
          COALESCE(NULLIF(regexp_replace(COALESCE(g->>'minute', ''), '[^0-9]', '', 'g'), ''), '0')::int,
          COALESCE(g->>'scorer', ''),
          COALESCE(g->>'description', '')
      ) * 100
    )::int AS sequence,
    CASE
      WHEN COALESCE(NULLIF(regexp_replace(COALESCE(g->>'minute', ''), '[^0-9]', '', 'g'), ''), '0')::int <= 45 THEN 1
      ELSE 2
    END::int AS period,
    NULLIF(g->>'minute', '') AS clock,
    COALESCE(sp.home_score, 0)::int AS home_score,
    COALESCE(sp.away_score, 0)::int AS away_score,
    jsonb_build_object(
      'text', g->>'description',
      'type', g->>'type',
      'team', g->>'team',
      'player', g->>'scorer',
      'assister', g->>'assister',
      'side', g->>'side',
      'scoring_play', true
    ) AS play_data,
    'postgame_backfill'::text AS source,
    COALESCE(sp.start_time, sp.created_at, NOW()) AS created_at
  FROM public.soccer_postgame sp
  CROSS JOIN LATERAL jsonb_array_elements(sp.goals) AS g
  WHERE sp.goals IS NOT NULL
    AND jsonb_typeof(sp.goals) = 'array'
    AND jsonb_array_length(sp.goals) > 0
)
INSERT INTO public.game_events (
  match_id,
  league_id,
  sport,
  event_type,
  sequence,
  period,
  clock,
  home_score,
  away_score,
  play_data,
  odds_snapshot,
  box_snapshot,
  source,
  created_at
)
SELECT
  match_id,
  league_id,
  sport,
  event_type,
  sequence,
  period,
  clock,
  home_score,
  away_score,
  play_data,
  NULL::jsonb,
  NULL::jsonb,
  source,
  created_at
FROM goal_rows
ON CONFLICT (match_id, event_type, sequence) DO NOTHING;

-- Cards
WITH card_rows AS (
  SELECT
    sp.match_id,
    COALESCE(NULLIF(sp.league_id, ''), 'soccer') AS league_id,
    'soccer'::text AS sport,
    CASE
      WHEN lower(COALESCE(c->>'card_type', '')) = 'red' THEN 'red_card'
      ELSE 'card'
    END::text AS event_type,
    (
      ROW_NUMBER() OVER (
        PARTITION BY sp.match_id
        ORDER BY
          COALESCE(NULLIF(regexp_replace(COALESCE(c->>'minute', ''), '[^0-9]', '', 'g'), ''), '0')::int,
          COALESCE(c->>'player', ''),
          COALESCE(c->>'team', '')
      ) * 100 + 50000
    )::int AS sequence,
    CASE
      WHEN COALESCE(NULLIF(regexp_replace(COALESCE(c->>'minute', ''), '[^0-9]', '', 'g'), ''), '0')::int <= 45 THEN 1
      ELSE 2
    END::int AS period,
    NULLIF(c->>'minute', '') AS clock,
    COALESCE(sp.home_score, 0)::int AS home_score,
    COALESCE(sp.away_score, 0)::int AS away_score,
    jsonb_build_object(
      'text', COALESCE(c->>'player', 'Unknown') || ' receives a ' || COALESCE(c->>'card_type', 'yellow') || ' card',
      'type', c->>'card_type',
      'team', c->>'team',
      'player', c->>'player',
      'side', c->>'side'
    ) AS play_data,
    'postgame_backfill'::text AS source,
    COALESCE(sp.start_time, sp.created_at, NOW()) AS created_at
  FROM public.soccer_postgame sp
  CROSS JOIN LATERAL jsonb_array_elements(sp.cards) AS c
  WHERE sp.cards IS NOT NULL
    AND jsonb_typeof(sp.cards) = 'array'
    AND jsonb_array_length(sp.cards) > 0
)
INSERT INTO public.game_events (
  match_id,
  league_id,
  sport,
  event_type,
  sequence,
  period,
  clock,
  home_score,
  away_score,
  play_data,
  odds_snapshot,
  box_snapshot,
  source,
  created_at
)
SELECT
  match_id,
  league_id,
  sport,
  event_type,
  sequence,
  period,
  clock,
  home_score,
  away_score,
  play_data,
  NULL::jsonb,
  NULL::jsonb,
  source,
  created_at
FROM card_rows
ON CONFLICT (match_id, event_type, sequence) DO NOTHING;

-- Timeline (subs, corners, fouls, period markers, etc.)
WITH timeline_rows AS (
  SELECT
    sp.match_id,
    COALESCE(NULLIF(sp.league_id, ''), 'soccer') AS league_id,
    'soccer'::text AS sport,
    CASE
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%goal%' THEN 'goal'
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%yellow%' THEN 'card'
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%red%' THEN 'red_card'
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%sub%' THEN 'substitution'
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%corner%' THEN 'corner'
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%foul%' THEN 'foul'
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%offside%' THEN 'offside'
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%penalty%' THEN 'penalty'
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%save%' THEN 'save'
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%kickoff%' THEN 'kickoff'
      WHEN lower(COALESCE(t->>'type', '')) LIKE '%half%'
        OR lower(COALESCE(t->>'type', '')) LIKE '%end%'
      THEN 'period_end'
      ELSE 'play'
    END::text AS event_type,
    (
      ROW_NUMBER() OVER (
        PARTITION BY sp.match_id
        ORDER BY
          COALESCE(NULLIF(regexp_replace(COALESCE(t->>'minute', ''), '[^0-9]', '', 'g'), ''), '0')::int,
          COALESCE(t->>'type', ''),
          COALESCE(t->>'description', '')
      ) * 100 + 90000
    )::int AS sequence,
    CASE
      WHEN COALESCE(NULLIF(regexp_replace(COALESCE(t->>'minute', ''), '[^0-9]', '', 'g'), ''), '0')::int <= 45 THEN 1
      ELSE 2
    END::int AS period,
    NULLIF(t->>'minute', '') AS clock,
    COALESCE(sp.home_score, 0)::int AS home_score,
    COALESCE(sp.away_score, 0)::int AS away_score,
    jsonb_build_object(
      'text', t->>'description',
      'type', t->>'type',
      'team', t->>'team',
      'players', t->'players',
      'side', t->>'side'
    ) AS play_data,
    'postgame_backfill'::text AS source,
    COALESCE(sp.start_time, sp.created_at, NOW()) AS created_at
  FROM public.soccer_postgame sp
  CROSS JOIN LATERAL jsonb_array_elements(sp.timeline) AS t
  WHERE sp.timeline IS NOT NULL
    AND jsonb_typeof(sp.timeline) = 'array'
    AND jsonb_array_length(sp.timeline) > 0
    AND lower(COALESCE(t->>'type', '')) NOT IN ('kickoff', 'start 2nd half')
)
INSERT INTO public.game_events (
  match_id,
  league_id,
  sport,
  event_type,
  sequence,
  period,
  clock,
  home_score,
  away_score,
  play_data,
  odds_snapshot,
  box_snapshot,
  source,
  created_at
)
SELECT
  match_id,
  league_id,
  sport,
  event_type,
  sequence,
  period,
  clock,
  home_score,
  away_score,
  play_data,
  NULL::jsonb,
  NULL::jsonb,
  source,
  created_at
FROM timeline_rows
ON CONFLICT (match_id, event_type, sequence) DO NOTHING;
