BEGIN;

CREATE OR REPLACE FUNCTION public.apply_kalshi_closing_prices_from_snapshots(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  IF to_regclass('public.kalshi_line_markets') IS NULL THEN
    RETURN 0;
  END IF;

  WITH incoming AS (
    SELECT
      trim(COALESCE(value->>'market_ticker', '')) AS market_ticker,
      CASE
        WHEN COALESCE(value->>'closing_price', '') ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN (value->>'closing_price')::numeric
        ELSE NULL
      END AS closing_price,
      CASE
        WHEN COALESCE(value->>'captured_at', '') = '' THEN NULL
        ELSE (value->>'captured_at')::timestamptz
      END AS captured_at
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS t(value)
  ), dedup AS (
    SELECT DISTINCT ON (i.market_ticker)
      i.market_ticker,
      i.closing_price
    FROM incoming i
    WHERE i.market_ticker <> ''
      AND i.closing_price IS NOT NULL
    ORDER BY i.market_ticker, i.captured_at DESC NULLS LAST
  ), updates AS (
    UPDATE public.kalshi_line_markets lm
    SET closing_price = d.closing_price
    FROM dedup d
    WHERE lm.market_ticker = d.market_ticker
      AND lm.closing_price IS NULL
    RETURNING 1
  )
  SELECT COUNT(*)::integer INTO v_updated FROM updates;

  RETURN COALESCE(v_updated, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_kalshi_closing_prices_from_snapshots(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.kalshi_team_match_score(p_event_team text, p_match_team text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_event text;
  v_match text;
  v_event_tokens text[];
  v_match_tokens text[];
  v_event_first text;
  v_match_first text;
  v_event_two text;
  v_match_two text;
BEGIN
  v_event := lower(trim(COALESCE(p_event_team, '')));
  v_match := lower(trim(COALESCE(p_match_team, '')));

  IF v_event = '' OR v_match = '' THEN
    RETURN 0;
  END IF;

  v_event := regexp_replace(v_event, '[^a-z0-9]+', ' ', 'g');
  v_event := regexp_replace(v_event, '\s+', ' ', 'g');
  v_event := trim(v_event);

  v_match := regexp_replace(v_match, '[^a-z0-9]+', ' ', 'g');
  v_match := regexp_replace(v_match, '\s+', ' ', 'g');
  v_match := trim(v_match);

  IF v_event = '' OR v_match = '' THEN
    RETURN 0;
  END IF;

  IF v_event = v_match THEN
    RETURN 100;
  END IF;

  IF position(v_event IN v_match) > 0 OR position(v_match IN v_event) > 0 THEN
    RETURN 86;
  END IF;

  v_event_tokens := string_to_array(v_event, ' ');
  v_match_tokens := string_to_array(v_match, ' ');

  v_event_first := COALESCE(v_event_tokens[1], '');
  v_match_first := COALESCE(v_match_tokens[1], '');
  v_event_two := trim(COALESCE(v_event_tokens[1], '') || ' ' || COALESCE(v_event_tokens[2], ''));
  v_match_two := trim(COALESCE(v_match_tokens[1], '') || ' ' || COALESCE(v_match_tokens[2], ''));

  IF v_event_two <> '' AND (position(v_event_two IN v_match) > 0 OR v_event_two = v_match_two) THEN
    RETURN 74;
  END IF;

  IF v_match_two <> '' AND position(v_match_two IN v_event) > 0 THEN
    RETURN 70;
  END IF;

  IF v_event_first <> '' AND v_event_first = v_match_first THEN
    IF length(COALESCE(v_event_tokens[2], '')) > 0
       AND length(COALESCE(v_match_tokens[2], '')) > 0
       AND left(COALESCE(v_event_tokens[2], ''), 1) = left(COALESCE(v_match_tokens[2], ''), 1) THEN
      RETURN 66;
    END IF;
    RETURN 52;
  END IF;

  RETURN 0;
END;
$$;

DROP MATERIALIZED VIEW IF EXISTS public.mv_espn_kalshi_total_divergence_curve;

CREATE MATERIALIZED VIEW public.mv_espn_kalshi_total_divergence_curve AS
WITH kalshi_total_events AS (
  SELECT
    kl.event_ticker,
    lower(COALESCE(MAX(kl.league), '')) AS league_id,
    MIN(kl.game_date)::date AS kalshi_game_date,
    MAX(kl.title) AS title,
    MAX(kl.subtitle) AS subtitle,
    NULLIF(trim((regexp_match(MAX(kl.title), '^(.+?)\s+at\s+(.+?)(?::|$)'))[1]), '') AS away_team_hint,
    NULLIF(trim((regexp_match(MAX(kl.title), '^(.+?)\s+at\s+(.+?)(?::|$)'))[2]), '') AS home_team_hint
  FROM public.kalshi_line_markets kl
  WHERE lower(COALESCE(kl.market_kind, '')) = 'total'
    AND kl.event_ticker IS NOT NULL
    AND kl.game_date IS NOT NULL
  GROUP BY kl.event_ticker
),
match_base AS (
  SELECT
    m.id AS match_id,
    lower(COALESCE(m.league_id, '')) AS league_id,
    m.home_team,
    m.away_team,
    m.start_time,
    (m.start_time AT TIME ZONE 'utc')::date AS match_game_date,
    public.safe_to_numeric(m.opening_odds->>'total') AS dk_open_total
  FROM public.matches m
  WHERE m.start_time IS NOT NULL
    AND m.home_team IS NOT NULL
    AND m.away_team IS NOT NULL
),
candidate_map AS (
  SELECT
    kte.event_ticker,
    kte.league_id AS kalshi_league_id,
    kte.kalshi_game_date,
    kte.home_team_hint,
    kte.away_team_hint,
    mb.match_id,
    mb.start_time AS match_start_time,
    mb.match_game_date,
    mb.home_team,
    mb.away_team,
    mb.dk_open_total,
    public.kalshi_team_match_score(kte.home_team_hint, mb.home_team) AS home_score,
    public.kalshi_team_match_score(kte.away_team_hint, mb.away_team) AS away_score,
    abs(mb.match_game_date - kte.kalshi_game_date) AS date_gap_days,
    ROW_NUMBER() OVER (
      PARTITION BY kte.event_ticker
      ORDER BY
        (
          public.kalshi_team_match_score(kte.home_team_hint, mb.home_team)
          + public.kalshi_team_match_score(kte.away_team_hint, mb.away_team)
        ) DESC,
        abs(mb.match_game_date - kte.kalshi_game_date) ASC,
        mb.start_time ASC
    ) AS match_rank
  FROM kalshi_total_events kte
  JOIN match_base mb
    ON (
      mb.league_id = kte.league_id
      OR (kte.league_id = 'ncaamb' AND mb.league_id = 'mens-college-basketball')
      OR (kte.league_id = 'mens-college-basketball' AND mb.league_id = 'ncaamb')
    )
   AND mb.match_game_date BETWEEN (kte.kalshi_game_date - 1) AND (kte.kalshi_game_date + 1)
  WHERE kte.home_team_hint IS NOT NULL
    AND kte.away_team_hint IS NOT NULL
),
kalshi_match_map AS (
  SELECT
    cm.event_ticker,
    cm.match_id,
    cm.match_start_time,
    cm.kalshi_game_date,
    cm.home_team_hint AS kalshi_home_team_hint,
    cm.away_team_hint AS kalshi_away_team_hint,
    cm.home_team AS match_home_team,
    cm.away_team AS match_away_team,
    cm.dk_open_total,
    cm.home_score,
    cm.away_score,
    cm.date_gap_days
  FROM candidate_map cm
  WHERE cm.match_rank = 1
    AND cm.home_score >= 52
    AND cm.away_score >= 52
),
espn_opening AS (
  SELECT DISTINCT ON (ep.match_id)
    ep.match_id,
    ep.espn_event_id,
    ep.league_id,
    ep.sequence_number AS espn_opening_sequence,
    ep.total_over_prob AS espn_opening_total_over_prob,
    COALESCE(ep.last_modified, ep.created_at) AS espn_opened_at
  FROM public.espn_probabilities ep
  WHERE ep.total_over_prob IS NOT NULL
  ORDER BY ep.match_id, ep.sequence_number ASC, COALESCE(ep.last_modified, ep.created_at) ASC
),
kalshi_curve AS (
  SELECT
    kmm.match_id,
    kmm.event_ticker,
    kl.market_ticker,
    kl.line_value::numeric AS kalshi_line_value,
    kmm.dk_open_total,
    kl.closing_price,
    kl.settlement_price,
    kl.status AS kalshi_market_status,
    lp.yes_price AS latest_pregame_price,
    lp.captured_at AS latest_pregame_captured_at,
    la.yes_price AS latest_any_price,
    la.captured_at AS latest_any_captured_at,
    ll.yes_price AS latest_live_price,
    ll.captured_at AS latest_live_captured_at
  FROM kalshi_match_map kmm
  JOIN public.kalshi_line_markets kl
    ON kl.event_ticker = kmm.event_ticker
   AND lower(COALESCE(kl.market_kind, '')) = 'total'
   AND kl.line_value IS NOT NULL
   AND lower(COALESCE(kl.line_side, kl.team_name, '')) LIKE 'over%'
  LEFT JOIN LATERAL (
    SELECT s.yes_price, s.captured_at
    FROM public.kalshi_orderbook_snapshots s
    WHERE s.market_ticker = kl.market_ticker
      AND s.snapshot_type = 'pregame'
      AND s.yes_price IS NOT NULL
    ORDER BY s.captured_at DESC
    LIMIT 1
  ) lp ON true
  LEFT JOIN LATERAL (
    SELECT s.yes_price, s.captured_at
    FROM public.kalshi_orderbook_snapshots s
    WHERE s.market_ticker = kl.market_ticker
      AND s.yes_price IS NOT NULL
    ORDER BY s.captured_at DESC
    LIMIT 1
  ) la ON true
  LEFT JOIN LATERAL (
    SELECT s.yes_price, s.captured_at
    FROM public.kalshi_orderbook_snapshots s
    WHERE s.market_ticker = kl.market_ticker
      AND s.snapshot_type = 'live'
      AND s.yes_price IS NOT NULL
    ORDER BY s.captured_at DESC
    LIMIT 1
  ) ll ON true
),
curve_ranked AS (
  SELECT
    kc.*,
    COALESCE(kc.closing_price, kc.latest_pregame_price, kc.latest_any_price) AS kalshi_implied_over_prob,
    CASE
      WHEN kc.closing_price IS NOT NULL THEN 'closing_price'
      WHEN kc.latest_pregame_price IS NOT NULL THEN 'pregame_snapshot'
      WHEN kc.latest_any_price IS NOT NULL THEN 'latest_snapshot'
      ELSE 'unavailable'
    END AS kalshi_price_source,
    COALESCE(kc.latest_pregame_captured_at, kc.latest_any_captured_at) AS kalshi_price_captured_at,
    ROW_NUMBER() OVER (
      PARTITION BY kc.match_id
      ORDER BY abs(kc.kalshi_line_value - kc.dk_open_total), kc.kalshi_line_value
    ) AS dk_anchor_rank,
    COUNT(*) OVER (PARTITION BY kc.match_id) AS curve_points_per_match
  FROM kalshi_curve kc
  WHERE kc.dk_open_total IS NOT NULL
    AND COALESCE(kc.closing_price, kc.latest_pregame_price, kc.latest_any_price) IS NOT NULL
),
final AS (
  SELECT
    cr.match_id,
    eo.espn_event_id,
    eo.league_id AS espn_league_id,
    eo.espn_opening_sequence,
    eo.espn_opening_total_over_prob,
    eo.espn_opened_at,
    kmm.match_start_time,
    kmm.kalshi_game_date,
    kmm.match_home_team AS home_team,
    kmm.match_away_team AS away_team,
    cr.event_ticker AS kalshi_event_ticker,
    cr.market_ticker AS kalshi_market_ticker,
    cr.kalshi_line_value,
    cr.dk_open_total,
    (cr.kalshi_line_value - cr.dk_open_total) AS line_delta_vs_dk,
    cr.kalshi_implied_over_prob,
    (cr.kalshi_implied_over_prob - eo.espn_opening_total_over_prob) AS espn_kalshi_prob_gap,
    (cr.dk_anchor_rank = 1) AS is_dk_anchor_line,
    cr.curve_points_per_match,
    cr.kalshi_price_source,
    cr.kalshi_price_captured_at,
    cr.latest_live_price AS latest_live_over_prob,
    cr.latest_live_captured_at,
    cr.settlement_price,
    cr.kalshi_market_status,
    kmm.home_score AS team_match_home_score,
    kmm.away_score AS team_match_away_score,
    kmm.date_gap_days
  FROM curve_ranked cr
  JOIN kalshi_match_map kmm
    ON kmm.match_id = cr.match_id
   AND kmm.event_ticker = cr.event_ticker
  JOIN espn_opening eo
    ON eo.match_id = cr.match_id
)
SELECT *
FROM final;

CREATE UNIQUE INDEX mv_espn_kalshi_total_divergence_curve_uidx
  ON public.mv_espn_kalshi_total_divergence_curve (match_id, kalshi_market_ticker);

CREATE INDEX mv_espn_kalshi_total_divergence_curve_anchor_idx
  ON public.mv_espn_kalshi_total_divergence_curve (match_id, is_dk_anchor_line);

CREATE INDEX mv_espn_kalshi_total_divergence_curve_event_idx
  ON public.mv_espn_kalshi_total_divergence_curve (kalshi_event_ticker, kalshi_line_value);

CREATE OR REPLACE FUNCTION public.refresh_mv_espn_kalshi_total_divergence_curve()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_espn_kalshi_total_divergence_curve;
END;
$$;

GRANT SELECT ON public.mv_espn_kalshi_total_divergence_curve TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_mv_espn_kalshi_total_divergence_curve() TO service_role;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR v_job_id IN
      SELECT jobid
      FROM cron.job
      WHERE jobname IN (
        'drain-kalshi-orderbook',
        'drain-kalshi-orderbook-snapshot',
        'drain-kalshi-orderbook-pregame',
        'drain-kalshi-orderbook-live',
        'refresh-mv-espn-kalshi-total-divergence'
      )
    LOOP
      PERFORM cron.unschedule(v_job_id);
    END LOOP;

    PERFORM cron.schedule(
      'drain-kalshi-orderbook-pregame',
      '*/2 * * * *',
      $job$
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.matches m
            WHERE m.start_time IS NOT NULL
              AND lower(COALESCE(m.league_id, '')) IN ('nba', 'nfl', 'mlb', 'mens-college-basketball', 'ncaamb')
              AND m.start_time >= (now() - interval '10 minutes')
              AND m.start_time <= (now() + interval '50 minutes')
              AND upper(COALESCE(m.status, '')) NOT IN ('STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_POSTPONED', 'POST', 'FINAL')
          ) THEN net.http_post(
            url := current_setting('app.settings.supabase_url') || '/functions/v1/drain-kalshi-orderbook',
            headers := jsonb_build_object(
              'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
              'Content-Type', 'application/json'
            ),
            body := jsonb_build_object(
              'phase', 'snapshot',
              'sport', 'all',
              'window', 'pregame',
              'max_markets', 220
            )
          )
          ELSE NULL
        END;
      $job$
    );

    PERFORM cron.schedule(
      'drain-kalshi-orderbook-live',
      '*/2 * * * *',
      $job$
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.matches m
            WHERE m.start_time IS NOT NULL
              AND lower(COALESCE(m.league_id, '')) IN ('nba', 'nfl', 'mlb', 'mens-college-basketball', 'ncaamb')
              AND m.start_time >= (now() - interval '6 hours')
              AND m.start_time <= (now() + interval '20 minutes')
              AND upper(COALESCE(m.status, '')) NOT IN ('STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_POSTPONED', 'POST', 'FINAL')
              AND (
                COALESCE(m.period, 0) > 0
                OR lower(COALESCE(m.status, '')) LIKE '%in_progress%'
                OR lower(COALESCE(m.status, '')) LIKE '%live%'
                OR lower(COALESCE(m.status, '')) LIKE '%half%'
                OR lower(COALESCE(m.status, '')) LIKE '%quarter%'
              )
          ) THEN net.http_post(
            url := current_setting('app.settings.supabase_url') || '/functions/v1/drain-kalshi-orderbook',
            headers := jsonb_build_object(
              'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
              'Content-Type', 'application/json'
            ),
            body := jsonb_build_object(
              'phase', 'snapshot',
              'sport', 'all',
              'window', 'live',
              'max_markets', 220
            )
          )
          ELSE NULL
        END;
      $job$
    );

    PERFORM cron.schedule(
      'refresh-mv-espn-kalshi-total-divergence',
      '*/5 * * * *',
      $job$
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.kalshi_orderbook_snapshots s
            WHERE s.captured_at >= (now() - interval '24 hours')
          ) THEN public.refresh_mv_espn_kalshi_total_divergence_curve()
          ELSE NULL
        END;
      $job$
    );
  END IF;
END;
$$;

COMMIT;
