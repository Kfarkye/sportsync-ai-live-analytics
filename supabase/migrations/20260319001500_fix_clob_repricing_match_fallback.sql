-- Improve Kalshi CLOB -> match mapping coverage by adding a fallback path
-- through kalshi_line_markets + kalshi_team_map + matches.

DROP VIEW IF EXISTS public.v_clob_repricing_delta CASCADE;
DROP VIEW IF EXISTS public.v_kalshi_market_match_map CASCADE;

CREATE VIEW public.v_kalshi_market_match_map AS
WITH divergence_map AS (
  SELECT DISTINCT
    d.match_id,
    d.espn_event_id,
    d.espn_league_id AS league_id,
    d.match_start_time,
    d.home_team,
    d.away_team,
    d.kalshi_event_ticker AS event_ticker,
    d.kalshi_market_ticker AS market_ticker,
    d.kalshi_line_value AS line_value,
    d.dk_open_total,
    d.espn_opening_total_over_prob::numeric AS open_book_implied_prob,
    d.is_dk_anchor_line,
    0 AS source_priority
  FROM public.mv_espn_kalshi_total_divergence_curve d
  WHERE d.match_id IS NOT NULL
    AND d.kalshi_market_ticker IS NOT NULL
),
fallback_game_markets AS (
  SELECT
    m.id AS match_id,
    NULL::text AS espn_event_id,
    m.league_id,
    m.start_time AS match_start_time,
    m.home_team,
    m.away_team,
    lm.event_ticker,
    lm.market_ticker,
    lm.line_value,
    NULL::numeric AS dk_open_total,
    NULL::numeric AS open_book_implied_prob,
    FALSE AS is_dk_anchor_line,
    1 AS source_priority
  FROM public.kalshi_line_markets lm
  JOIN public.kalshi_team_map away_map
    ON away_map.kalshi_name = trim(split_part(lm.title, ' at ', 1))
   AND away_map.league = lm.league
  JOIN public.kalshi_team_map home_map
    ON home_map.kalshi_name = trim(split_part(split_part(lm.title, ' at ', 2), ' Winner?', 1))
   AND home_map.league = lm.league
  JOIN public.matches m
    ON m.start_time::date = lm.game_date
   AND m.home_team = home_map.espn_name
   AND m.away_team = away_map.espn_name
  WHERE lm.title LIKE '% at % Winner?'
),
unioned AS (
  SELECT * FROM divergence_map
  UNION ALL
  SELECT * FROM fallback_game_markets
)
SELECT DISTINCT ON (u.market_ticker)
  u.match_id,
  u.espn_event_id,
  u.league_id,
  u.match_start_time,
  u.home_team,
  u.away_team,
  u.event_ticker,
  u.market_ticker,
  u.line_value,
  u.dk_open_total,
  u.open_book_implied_prob,
  u.is_dk_anchor_line
FROM unioned u
ORDER BY u.market_ticker, u.source_priority;

CREATE VIEW public.v_clob_repricing_delta AS
WITH snapshot_probs AS (
  SELECT
    s.market_ticker,
    s.event_ticker,
    s.captured_at,
    CASE
      WHEN coalesce(s.yes_price, s.last_trade_price, s.yes_best_bid) IS NULL THEN NULL
      WHEN coalesce(s.yes_price, s.last_trade_price, s.yes_best_bid) BETWEEN 0 AND 1
        THEN coalesce(s.yes_price, s.last_trade_price, s.yes_best_bid)::numeric
      WHEN coalesce(s.yes_price, s.last_trade_price, s.yes_best_bid) BETWEEN 1 AND 100
        THEN (coalesce(s.yes_price, s.last_trade_price, s.yes_best_bid)::numeric / 100.0)
      ELSE NULL
    END AS clob_prob
  FROM public.kalshi_orderbook_snapshots s
),
ranked AS (
  SELECT
    sp.market_ticker,
    sp.event_ticker,
    sp.captured_at,
    sp.clob_prob,
    row_number() OVER (
      PARTITION BY sp.market_ticker
      ORDER BY sp.captured_at ASC
    ) AS rn_first,
    row_number() OVER (
      PARTITION BY sp.market_ticker
      ORDER BY sp.captured_at DESC
    ) AS rn_last,
    count(*) OVER (
      PARTITION BY sp.market_ticker
    ) AS snapshot_count
  FROM snapshot_probs sp
  WHERE sp.clob_prob IS NOT NULL
),
agg AS (
  SELECT
    r.market_ticker,
    max(r.event_ticker) AS event_ticker,
    max(CASE WHEN r.rn_first = 1 THEN r.clob_prob END) AS first_clob_prob,
    max(CASE WHEN r.rn_last = 1 THEN r.clob_prob END) AS latest_clob_prob,
    max(r.snapshot_count) AS snapshot_count,
    min(r.captured_at) AS first_snapshot_ts,
    max(r.captured_at) AS latest_snapshot_ts
  FROM ranked r
  GROUP BY r.market_ticker
)
SELECT
  km.match_id,
  km.market_ticker,
  coalesce(agg.event_ticker, km.event_ticker) AS event_ticker,
  km.league_id,
  km.home_team,
  km.away_team,
  km.line_value,
  km.is_dk_anchor_line,
  km.open_book_implied_prob,
  agg.first_clob_prob,
  agg.latest_clob_prob,
  round((agg.latest_clob_prob - agg.first_clob_prob)::numeric, 4) AS delta_first_to_latest,
  round((agg.latest_clob_prob - km.open_book_implied_prob)::numeric, 4) AS delta_open_to_latest,
  agg.snapshot_count,
  agg.first_snapshot_ts,
  agg.latest_snapshot_ts,
  CASE
    WHEN agg.snapshot_count >= 5 THEN 'usable'
    WHEN agg.snapshot_count BETWEEN 2 AND 4 THEN 'thin'
    WHEN agg.snapshot_count = 1 THEN 'insufficient'
    ELSE 'missing'
  END AS coverage_grade
FROM agg
LEFT JOIN public.v_kalshi_market_match_map km
  ON km.market_ticker = agg.market_ticker;

GRANT SELECT ON public.v_kalshi_market_match_map TO anon, authenticated, service_role;
GRANT SELECT ON public.v_clob_repricing_delta TO anon, authenticated, service_role;
