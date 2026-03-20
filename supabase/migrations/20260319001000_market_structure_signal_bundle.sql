-- Market structure signal bundle configured to existing schema.
-- Sources:
--   matches, opening_lines, closing_lines
--   espn_probabilities, live_odds_snapshots
--   kalshi_orderbook_snapshots, mv_espn_kalshi_total_divergence_curve

DROP VIEW IF EXISTS public.v_trigger_performance_summary CASCADE;
DROP VIEW IF EXISTS public.v_trigger_hedge_windows CASCADE;
DROP VIEW IF EXISTS public.v_clob_repricing_delta CASCADE;
DROP VIEW IF EXISTS public.v_kalshi_market_match_map CASCADE;
DROP VIEW IF EXISTS public.v_overshoot_summary CASCADE;
DROP VIEW IF EXISTS public.v_pregame_clv_summary CASCADE;
DROP VIEW IF EXISTS public.v_espn_extreme_triggers CASCADE;
DROP VIEW IF EXISTS public.v_dk_risk_steam_maturity CASCADE;
DROP FUNCTION IF EXISTS public.get_pregame_sharp_signals(date);
DROP FUNCTION IF EXISTS public.refresh_market_structure_views();
DROP MATERIALIZED VIEW IF EXISTS public.mv_middle_windows CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.mv_pregame_clv CASCADE;

-- 1) Pregame CLV backbone
CREATE MATERIALIZED VIEW public.mv_pregame_clv AS
WITH base AS (
  SELECT
    m.id AS match_id,
    m.league_id,
    m.sport,
    m.start_time,
    m.start_time::date AS game_date,
    m.home_team,
    m.away_team,
    m.status,
    m.home_score,
    m.away_score,
    o.total::numeric AS open_total,
    c.total::numeric AS close_total,
    o.home_spread::numeric AS open_home_spread,
    c.home_spread::numeric AS close_home_spread,
    o.away_spread::numeric AS open_away_spread,
    c.away_spread::numeric AS close_away_spread,
    o.home_ml AS open_home_ml,
    o.away_ml AS open_away_ml,
    c.home_ml AS close_home_ml,
    c.away_ml AS close_away_ml,
    (m.home_score + m.away_score)::numeric AS final_total,
    (m.home_score - m.away_score)::numeric AS final_margin
  FROM public.matches m
  JOIN public.opening_lines o
    ON o.match_id = m.id
  JOIN public.closing_lines c
    ON c.match_id = m.id
  WHERE o.total IS NOT NULL
    AND c.total IS NOT NULL
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
    AND m.status IN ('STATUS_FINAL', 'STATUS_FULL_TIME')
),
classified AS (
  SELECT
    b.*,
    (b.close_total - b.open_total)::numeric AS move_points,
    abs(b.close_total - b.open_total)::numeric AS abs_move_points,
    (b.close_home_spread - b.open_home_spread)::numeric AS spread_move_points,
    abs(b.close_home_spread - b.open_home_spread)::numeric AS abs_spread_move_points,
    CASE
      WHEN b.close_total - b.open_total <= -10 THEN 'sharp_under'
      WHEN b.close_total - b.open_total <= -2 THEN 'moderate_under'
      WHEN b.close_total - b.open_total < 2 THEN 'flat'
      WHEN b.close_total - b.open_total < 10 THEN 'moderate_over'
      ELSE 'sharp_over'
    END AS move_class,
    CASE
      WHEN b.close_home_spread - b.open_home_spread <= -5 THEN 'sharp_home'
      WHEN b.close_home_spread - b.open_home_spread <= -1.5 THEN 'moderate_home'
      WHEN b.close_home_spread - b.open_home_spread < 1.5 THEN 'flat'
      WHEN b.close_home_spread - b.open_home_spread < 5 THEN 'moderate_away'
      ELSE 'sharp_away'
    END AS spread_move_class,
    CASE
      WHEN b.close_total < b.open_total AND b.final_total < b.close_total THEN true
      WHEN b.close_total > b.open_total AND b.final_total > b.close_total THEN true
      WHEN b.close_total = b.open_total THEN NULL
      ELSE false
    END AS move_direction_hit
  FROM base b
)
SELECT
  match_id,
  league_id,
  sport,
  game_date,
  start_time,
  home_team,
  away_team,
  status,
  home_score,
  away_score,
  open_total,
  close_total,
  final_total,
  open_home_spread,
  close_home_spread,
  open_away_spread,
  close_away_spread,
  open_home_ml,
  open_away_ml,
  close_home_ml,
  close_away_ml,
  move_points,
  abs_move_points,
  spread_move_points,
  abs_spread_move_points,
  move_class,
  spread_move_class,
  move_direction_hit,
  move_points AS total_move,
  move_class AS total_move_class,
  spread_move_points AS spread_move,
  (final_total - open_total)::numeric AS margin_vs_open,
  (final_total - close_total)::numeric AS margin_vs_close,
  (final_total > open_total) AS over_open,
  (final_total > close_total) AS over_close,
  final_margin
FROM classified;

CREATE UNIQUE INDEX IF NOT EXISTS mv_pregame_clv_match_uidx
  ON public.mv_pregame_clv (match_id);
CREATE INDEX IF NOT EXISTS mv_pregame_clv_sport_date_idx
  ON public.mv_pregame_clv (sport, game_date);
CREATE INDEX IF NOT EXISTS mv_pregame_clv_move_class_idx
  ON public.mv_pregame_clv (move_class);

-- 2) Pregame CLV summary
CREATE VIEW public.v_pregame_clv_summary AS
SELECT
  sport,
  league_id,
  move_class,
  COUNT(*) AS games,
  round(avg(move_points), 2) AS avg_move_points,
  round(
    100.0 * avg(CASE WHEN move_direction_hit IS TRUE THEN 1.0 ELSE 0.0 END),
    1
  ) AS direction_hit_rate_pct
FROM public.mv_pregame_clv
GROUP BY sport, league_id, move_class
ORDER BY sport, league_id, move_class;

-- 3) Kalshi market normalization map (single place for match joins)
CREATE VIEW public.v_kalshi_market_match_map AS
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
  d.is_dk_anchor_line
FROM public.mv_espn_kalshi_total_divergence_curve d
WHERE d.match_id IS NOT NULL
  AND d.kalshi_market_ticker IS NOT NULL;

-- 4) Kalshi CLOB repricing delta
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

-- 5) ESPN extreme triggers
CREATE VIEW public.v_espn_extreme_triggers AS
WITH tagged AS (
  SELECT
    ep.match_id,
    ep.league_id,
    ep.sport,
    ep.sequence_number,
    ep.total_over_prob::numeric AS total_over_prob,
    ep.seconds_left,
    coalesce(ep.last_modified, ep.created_at) AS snapshot_ts,
    CASE
      WHEN ep.total_over_prob <= 0.05 THEN 'under_extreme'
      WHEN ep.total_over_prob >= 0.95 THEN 'over_extreme'
      ELSE NULL
    END AS trigger_type
  FROM public.espn_probabilities ep
  WHERE ep.total_over_prob IS NOT NULL
),
ranked AS (
  SELECT
    t.*,
    row_number() OVER (
      PARTITION BY t.match_id, t.trigger_type
      ORDER BY t.sequence_number ASC, t.snapshot_ts ASC
    ) AS rn
  FROM tagged t
  WHERE t.trigger_type IS NOT NULL
)
SELECT
  match_id,
  league_id,
  sport,
  trigger_type,
  snapshot_ts AS trigger_ts,
  total_over_prob,
  sequence_number AS trigger_sequence,
  seconds_left
FROM ranked
WHERE rn = 1;

-- 6) Live middle windows (DraftKings-led)
CREATE MATERIALIZED VIEW public.mv_middle_windows AS
WITH pregame AS (
  SELECT
    c.match_id,
    c.sport,
    c.league_id,
    c.game_date,
    c.home_team,
    c.away_team,
    c.open_total,
    c.close_total,
    c.final_total,
    coalesce(c.close_total, c.open_total) AS pregame_anchor_total
  FROM public.mv_pregame_clv c
),
live_dk AS (
  SELECT
    los.match_id,
    min(los.total::numeric) AS min_live_total,
    max(los.total::numeric) AS max_live_total,
    min(los.captured_at) AS first_live_ts,
    max(los.captured_at) AS last_live_ts
  FROM public.live_odds_snapshots los
  WHERE los.total IS NOT NULL
    AND los.provider ILIKE 'Draft%'
  GROUP BY los.match_id
),
corridors AS (
  SELECT
    p.match_id,
    p.sport,
    p.league_id,
    p.game_date,
    p.home_team,
    p.away_team,
    p.open_total,
    p.close_total,
    p.final_total,
    p.pregame_anchor_total,
    l.min_live_total,
    l.max_live_total,
    l.first_live_ts,
    l.last_live_ts,
    round(abs(l.min_live_total - p.pregame_anchor_total), 2) AS low_side_deviation,
    round(abs(l.max_live_total - p.pregame_anchor_total), 2) AS high_side_deviation,
    round(
      greatest(
        abs(l.min_live_total - p.pregame_anchor_total),
        abs(l.max_live_total - p.pregame_anchor_total)
      ),
      2
    ) AS max_live_deviation
  FROM pregame p
  JOIN live_dk l
    ON l.match_id = p.match_id
)
SELECT
  c.*,
  (
    c.min_live_total <= c.pregame_anchor_total - 6
    OR c.max_live_total >= c.pregame_anchor_total + 6
  ) AS has_6pt_middle_window,
  (
    c.min_live_total <= c.pregame_anchor_total - 10
    OR c.max_live_total >= c.pregame_anchor_total + 10
  ) AS has_10pt_middle_window,
  (
    c.final_total BETWEEN least(c.pregame_anchor_total, c.max_live_total)
                     AND greatest(c.pregame_anchor_total, c.min_live_total)
  ) AS final_inside_implied_window
FROM corridors c;

CREATE UNIQUE INDEX IF NOT EXISTS mv_middle_windows_match_uidx
  ON public.mv_middle_windows (match_id);
CREATE INDEX IF NOT EXISTS mv_middle_windows_sport_date_idx
  ON public.mv_middle_windows (sport, game_date);

-- 7) Trigger to nearest hedge quote
CREATE VIEW public.v_trigger_hedge_windows AS
WITH pregame AS (
  SELECT
    p.match_id,
    p.sport,
    p.league_id,
    p.game_date,
    p.home_team,
    p.away_team,
    p.final_total,
    coalesce(p.close_total, p.open_total) AS pregame_anchor_total
  FROM public.mv_pregame_clv p
),
triggered AS (
  SELECT
    t.match_id,
    t.trigger_type,
    t.trigger_ts,
    t.total_over_prob
  FROM public.v_espn_extreme_triggers t
),
nearest_live AS (
  SELECT
    p.match_id,
    p.sport,
    p.league_id,
    p.game_date,
    p.home_team,
    p.away_team,
    p.pregame_anchor_total,
    p.final_total,
    t.trigger_type,
    t.trigger_ts,
    t.total_over_prob,
    q.captured_at AS live_snapshot_ts,
    q.total::numeric AS hedge_live_total,
    abs(extract(epoch FROM (q.captured_at - t.trigger_ts)))::numeric AS seconds_from_trigger
  FROM pregame p
  JOIN triggered t
    ON t.match_id = p.match_id
  LEFT JOIN LATERAL (
    SELECT
      los.captured_at,
      los.total
    FROM public.live_odds_snapshots los
    WHERE los.match_id = p.match_id
      AND los.total IS NOT NULL
      AND los.provider ILIKE 'Draft%'
    ORDER BY abs(extract(epoch FROM (los.captured_at - t.trigger_ts)))
    LIMIT 1
  ) q ON true
)
SELECT
  n.match_id,
  n.sport,
  n.league_id,
  n.game_date,
  n.home_team,
  n.away_team,
  n.trigger_type,
  n.trigger_ts,
  n.live_snapshot_ts,
  n.seconds_from_trigger,
  n.pregame_anchor_total,
  n.hedge_live_total,
  round(abs(n.hedge_live_total - n.pregame_anchor_total), 2) AS corridor_width_points,
  n.final_total,
  (
    n.final_total BETWEEN least(n.pregame_anchor_total, n.hedge_live_total)
                     AND greatest(n.pregame_anchor_total, n.hedge_live_total)
  ) AS final_landed_in_trigger_corridor,
  TRUE AS pattern_present,
  TRUE AS trigger_seen,
  (n.hedge_live_total IS NOT NULL) AS nearest_live_quote_found,
  (abs(n.hedge_live_total - n.pregame_anchor_total) >= 6) AS corridor_observed,
  (
    n.final_total BETWEEN least(n.pregame_anchor_total, n.hedge_live_total)
                     AND greatest(n.pregame_anchor_total, n.hedge_live_total)
  ) AS final_inside_corridor
FROM nearest_live n;

-- 8) Trigger performance summary
CREATE VIEW public.v_trigger_performance_summary AS
SELECT
  sport,
  trigger_type,
  count(*) AS games,
  round(avg(corridor_width_points), 2) AS avg_corridor_width_points,
  round(
    100.0 * avg(CASE WHEN final_landed_in_trigger_corridor THEN 1.0 ELSE 0.0 END),
    1
  ) AS middle_rate_pct,
  round(avg(seconds_from_trigger), 1) AS avg_seconds_from_trigger_to_live_quote
FROM public.v_trigger_hedge_windows
GROUP BY sport, trigger_type
ORDER BY sport, trigger_type;

-- 9) Overshoot summary
CREATE VIEW public.v_overshoot_summary AS
SELECT
  sport,
  league_id,
  move_class,
  count(*) AS games,
  round(
    100.0 * avg(
      CASE
        WHEN move_class = 'sharp_under' AND final_total > close_total THEN 1.0
        WHEN move_class = 'sharp_over'  AND final_total < close_total THEN 1.0
        ELSE 0.0
      END
    ),
    1
  ) AS overshoot_rate_pct
FROM public.mv_pregame_clv
WHERE move_class IN ('sharp_under', 'sharp_over')
GROUP BY sport, league_id, move_class
ORDER BY sport, league_id, move_class;

-- 10) DK risk x steam maturity state table (consumer-safe)
CREATE VIEW public.v_dk_risk_steam_maturity AS
WITH trigger_base AS (
  SELECT
    lmt.id AS trigger_id,
    lmt.match_id,
    lmt.league,
    lmt.sport,
    lmt.movement_timestamp,
    lmt.period,
    lmt.clock,
    lmt.old_total::numeric AS old_total,
    lmt.new_total::numeric AS new_total,
    lmt.movement_size::numeric AS movement_size,
    lmt.movement_direction
  FROM public.line_movement_triggers lmt
  WHERE lmt.old_total IS NOT NULL
    AND lmt.new_total IS NOT NULL
),
quotes AS (
  SELECT
    tb.trigger_id,
    count(DISTINCT los.provider) AS providers_seen_2m,
    min(los.total::numeric) AS min_total_2m,
    max(los.total::numeric) AS max_total_2m,
    max(CASE WHEN los.provider ILIKE 'Draft%' THEN los.total::numeric END) AS dk_total_2m
  FROM trigger_base tb
  LEFT JOIN public.live_odds_snapshots los
    ON los.match_id = tb.match_id
   AND los.total IS NOT NULL
   AND los.captured_at BETWEEN tb.movement_timestamp - interval '2 minutes'
                           AND tb.movement_timestamp + interval '2 minutes'
  GROUP BY tb.trigger_id
),
cumulative AS (
  SELECT
    tb.*,
    row_number() OVER (
      PARTITION BY tb.match_id
      ORDER BY tb.movement_timestamp
    ) AS trigger_index,
    sum(abs(tb.movement_size)) OVER (
      PARTITION BY tb.match_id
      ORDER BY tb.movement_timestamp
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_move_points,
    lag(tb.movement_direction) OVER (
      PARTITION BY tb.match_id
      ORDER BY tb.movement_timestamp
    ) AS prev_direction
  FROM trigger_base tb
)
SELECT
  c.trigger_id,
  c.match_id,
  c.league,
  c.sport,
  c.movement_timestamp,
  c.period,
  c.clock,
  c.old_total,
  c.new_total,
  c.movement_size,
  c.movement_direction,
  c.trigger_index,
  c.cumulative_move_points,
  q.providers_seen_2m,
  q.dk_total_2m,
  q.min_total_2m,
  q.max_total_2m,
  round((q.max_total_2m - q.min_total_2m), 2) AS dispersion_2m,
  CASE
    WHEN c.trigger_index <= 2
      AND c.movement_size >= 2
      AND coalesce(q.providers_seen_2m, 0) <= 1
      THEN 'risk_reprice'
    WHEN coalesce(q.providers_seen_2m, 0) >= 2
      AND c.cumulative_move_points < 10
      THEN 'true_steam'
    WHEN c.cumulative_move_points >= 12
      AND c.movement_size < 2
      THEN 'steam_exhausted'
    WHEN c.cumulative_move_points >= 12
      AND c.prev_direction IS NOT NULL
      AND c.prev_direction <> c.movement_direction
      THEN 'revert_window'
    ELSE 'forming'
  END AS state_class
FROM cumulative c
LEFT JOIN quotes q
  ON q.trigger_id = c.trigger_id;

-- 11) Daily consumer-safe pregame signal function
CREATE OR REPLACE FUNCTION public.get_pregame_sharp_signals(signal_date date)
RETURNS TABLE (
  match_id text,
  sport text,
  game_date date,
  matchup text,
  open_total numeric,
  latest_close_total numeric,
  move_points numeric,
  move_class text,
  historical_direction_hit_rate_pct numeric,
  open_book_implied_prob numeric,
  latest_clob_prob numeric,
  clob_delta numeric,
  clob_coverage_grade text
)
LANGUAGE sql
STABLE
AS $$
WITH day_games AS (
  SELECT
    m.id AS match_id,
    m.sport,
    m.start_time::date AS game_date,
    m.home_team,
    m.away_team,
    o.total::numeric AS open_total,
    coalesce(c.total::numeric, o.total::numeric) AS latest_close_total
  FROM public.matches m
  JOIN public.opening_lines o
    ON o.match_id = m.id
  LEFT JOIN public.closing_lines c
    ON c.match_id = m.id
  WHERE m.start_time::date = signal_date
    AND o.total IS NOT NULL
),
classified AS (
  SELECT
    g.*,
    (g.latest_close_total - g.open_total)::numeric AS move_points,
    CASE
      WHEN g.latest_close_total - g.open_total <= -10 THEN 'sharp_under'
      WHEN g.latest_close_total - g.open_total <= -2 THEN 'moderate_under'
      WHEN g.latest_close_total - g.open_total < 2 THEN 'flat'
      WHEN g.latest_close_total - g.open_total < 10 THEN 'moderate_over'
      ELSE 'sharp_over'
    END AS move_class
  FROM day_games g
),
hist AS (
  SELECT
    m.sport,
    m.move_class,
    round(
      100.0 * avg(CASE WHEN m.move_direction_hit IS TRUE THEN 1.0 ELSE 0.0 END),
      1
    ) AS historical_direction_hit_rate_pct
  FROM public.mv_pregame_clv m
  GROUP BY m.sport, m.move_class
),
best_clob AS (
  SELECT DISTINCT ON (c.match_id)
    c.match_id,
    c.open_book_implied_prob,
    c.latest_clob_prob,
    c.delta_open_to_latest,
    c.coverage_grade,
    c.is_dk_anchor_line,
    c.snapshot_count,
    c.latest_snapshot_ts
  FROM public.v_clob_repricing_delta c
  WHERE c.match_id IS NOT NULL
  ORDER BY
    c.match_id,
    CASE WHEN c.is_dk_anchor_line THEN 0 ELSE 1 END,
    c.snapshot_count DESC,
    c.latest_snapshot_ts DESC NULLS LAST
)
SELECT
  cls.match_id,
  cls.sport,
  cls.game_date,
  cls.home_team || ' vs ' || cls.away_team AS matchup,
  cls.open_total,
  cls.latest_close_total,
  round(cls.move_points, 2) AS move_points,
  cls.move_class,
  h.historical_direction_hit_rate_pct,
  bc.open_book_implied_prob,
  bc.latest_clob_prob,
  bc.delta_open_to_latest AS clob_delta,
  bc.coverage_grade AS clob_coverage_grade
FROM classified cls
LEFT JOIN hist h
  ON h.sport = cls.sport
 AND h.move_class = cls.move_class
LEFT JOIN best_clob bc
  ON bc.match_id = cls.match_id
ORDER BY
  CASE cls.move_class
    WHEN 'moderate_under' THEN 1
    WHEN 'sharp_under' THEN 2
    WHEN 'flat' THEN 3
    WHEN 'moderate_over' THEN 4
    WHEN 'sharp_over' THEN 5
    ELSE 6
  END,
  abs(cls.move_points) DESC;
$$;

-- 12) Refresh helper for cron/manual execution
CREATE OR REPLACE FUNCTION public.refresh_market_structure_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.mv_pregame_clv;
  REFRESH MATERIALIZED VIEW public.mv_middle_windows;
END;
$$;

-- Performance indexes for nearest-quote joins
CREATE INDEX IF NOT EXISTS idx_live_odds_snapshots_match_provider_time_total
  ON public.live_odds_snapshots (match_id, provider, captured_at)
  WHERE total IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_espn_probabilities_match_seq_total_over
  ON public.espn_probabilities (match_id, sequence_number)
  WHERE total_over_prob IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kalshi_orderbook_snapshots_market_time
  ON public.kalshi_orderbook_snapshots (market_ticker, captured_at);

GRANT SELECT ON public.mv_pregame_clv TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_middle_windows TO anon, authenticated, service_role;
GRANT SELECT ON public.v_pregame_clv_summary TO anon, authenticated, service_role;
GRANT SELECT ON public.v_kalshi_market_match_map TO anon, authenticated, service_role;
GRANT SELECT ON public.v_clob_repricing_delta TO anon, authenticated, service_role;
GRANT SELECT ON public.v_espn_extreme_triggers TO anon, authenticated, service_role;
GRANT SELECT ON public.v_trigger_hedge_windows TO anon, authenticated, service_role;
GRANT SELECT ON public.v_trigger_performance_summary TO anon, authenticated, service_role;
GRANT SELECT ON public.v_overshoot_summary TO anon, authenticated, service_role;
GRANT SELECT ON public.v_dk_risk_steam_maturity TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pregame_sharp_signals(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_market_structure_views() TO service_role;
