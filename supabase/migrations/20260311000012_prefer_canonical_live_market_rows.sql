CREATE OR REPLACE VIEW v_live_market_snapshots_unified AS
SELECT
  CONCAT('live_odds_snapshots:', los.id::text) AS snapshot_key,
  los.id::bigint AS unified_snapshot_id,
  los.match_id,
  los.sport,
  los.league_id,
  los.provider,
  los.provider_id,
  los.market_type,
  los.captured_at,
  los.status,
  los.period,
  los.clock,
  NULL::smallint AS match_minute,
  los.home_score,
  los.away_score,
  los.home_team,
  los.away_team,
  los.home_ml::numeric AS home_ml,
  los.away_ml::numeric AS away_ml,
  los.draw_ml::numeric AS draw_ml,
  los.spread_home,
  los.spread_away,
  los.spread_home_price::numeric AS spread_home_price,
  los.spread_away_price::numeric AS spread_away_price,
  los.total,
  los.over_price::numeric AS over_price,
  los.under_price::numeric AS under_price,
  los.is_live,
  los.source,
  los.raw_payload,
  'live_odds_snapshots'::text AS snapshot_origin,
  CASE
    WHEN los.source = 'odds_api' THEN 0
    WHEN los.source = 'espn_core' THEN 1
    WHEN los.source = 'match_current_odds' THEN 2
    WHEN los.source = 'espn_summary' THEN 3
    ELSE 4
  END AS research_source_rank,
  CASE
    WHEN los.market_type = 'main' THEN 0
    WHEN los.market_type = 'live' THEN 1
    WHEN los.market_type = 'close' THEN 2
    WHEN los.market_type = 'open' THEN 3
    ELSE 4
  END AS research_market_rank,
  CASE
    WHEN los.market_type IN ('main', 'live') THEN true
    ELSE false
  END AS is_research_preferred
FROM live_odds_snapshots los
UNION ALL
SELECT
  CONCAT('soccer_live_odds_snapshots:', slos.id) AS snapshot_key,
  ABS(hashtext(slos.id))::bigint AS unified_snapshot_id,
  slos.match_id,
  'soccer'::text AS sport,
  slos.league_id,
  'SoccerLiveSnapshot'::text AS provider,
  slos.source AS provider_id,
  'main'::text AS market_type,
  slos.captured_at,
  'live'::text AS status,
  NULL::integer AS period,
  slos.game_clock AS clock,
  slos.match_minute,
  slos.home_score::integer AS home_score,
  slos.away_score::integer AS away_score,
  NULL::text AS home_team,
  NULL::text AS away_team,
  slos.live_home_ml,
  slos.live_away_ml,
  slos.live_draw_ml,
  slos.live_spread AS spread_home,
  CASE WHEN slos.live_spread IS NOT NULL THEN -slos.live_spread ELSE NULL END AS spread_away,
  slos.live_home_spread_price AS spread_home_price,
  slos.live_away_spread_price AS spread_away_price,
  slos.live_total AS total,
  slos.live_over_price AS over_price,
  slos.live_under_price AS under_price,
  true AS is_live,
  COALESCE(slos.source, 'soccer_live_odds_snapshots') AS source,
  jsonb_build_object(
    'trigger_type', slos.trigger_type,
    'trigger_detail', slos.trigger_detail,
    'match_minute', slos.match_minute,
    'game_clock', slos.game_clock,
    'alt_lines', slos.alt_lines,
    'player_props', slos.player_props,
    'live_btts_yes', slos.live_btts_yes,
    'live_btts_no', slos.live_btts_no,
    'drain_version', slos.drain_version,
    'odds_format', slos.odds_format,
    'created_at', slos.created_at,
    'snapshot_stage', 'main',
    'snapshot_source', COALESCE(slos.source, 'soccer_live_odds_snapshots')
  ) AS raw_payload,
  'soccer_live_odds_snapshots'::text AS snapshot_origin,
  2 AS research_source_rank,
  0 AS research_market_rank,
  true AS is_research_preferred
FROM soccer_live_odds_snapshots slos;

CREATE OR REPLACE VIEW v_first_goal_repricing AS
WITH first_goals AS (
  SELECT
    e.*,
    ROW_NUMBER() OVER (PARTITION BY e.match_id ORDER BY e.event_at ASC, e.sequence ASC) AS rn
  FROM v_pbp_events_normalized e
  WHERE e.sport = 'soccer'
    AND e.event_family = 'score'
)
SELECT
  fg.match_id,
  fg.league_id,
  fg.event_id,
  fg.sequence,
  fg.event_at AS goal_at,
  fg.period,
  fg.clock,
  fg.home_team,
  fg.away_team,
  fg.team_side AS scoring_side,
  fg.team_name AS scoring_team,
  fg.primary_player_name AS scorer_name,
  fg.home_score,
  fg.away_score,
  fg.score_margin,
  fg.score_state_tag,
  pre.snapshot_key AS pre_snapshot_key,
  pre.snapshot_origin AS pre_snapshot_origin,
  pre.provider AS pre_provider,
  pre.market_type AS pre_market_type,
  pre.captured_at AS pre_captured_at,
  post.snapshot_key AS post_snapshot_key,
  post.snapshot_origin AS post_snapshot_origin,
  post.provider AS post_provider,
  post.market_type AS post_market_type,
  post.captured_at AS post_captured_at,
  CASE
    WHEN pre.captured_at IS NULL OR post.captured_at IS NULL THEN NULL
    ELSE ABS(EXTRACT(EPOCH FROM (post.captured_at - pre.captured_at)))::integer
  END AS repricing_window_sec,
  pre.home_ml AS pre_home_ml,
  post.home_ml AS post_home_ml,
  CASE WHEN pre.home_ml IS NOT NULL AND post.home_ml IS NOT NULL THEN post.home_ml - pre.home_ml ELSE NULL END AS home_ml_shift,
  pre.away_ml AS pre_away_ml,
  post.away_ml AS post_away_ml,
  CASE WHEN pre.away_ml IS NOT NULL AND post.away_ml IS NOT NULL THEN post.away_ml - pre.away_ml ELSE NULL END AS away_ml_shift,
  pre.draw_ml AS pre_draw_ml,
  post.draw_ml AS post_draw_ml,
  CASE WHEN pre.draw_ml IS NOT NULL AND post.draw_ml IS NOT NULL THEN post.draw_ml - pre.draw_ml ELSE NULL END AS draw_ml_shift,
  pre.total AS pre_total,
  post.total AS post_total,
  CASE WHEN pre.total IS NOT NULL AND post.total IS NOT NULL THEN post.total - pre.total ELSE NULL END AS total_shift,
  pre.over_price AS pre_over_price,
  post.over_price AS post_over_price,
  pre.under_price AS pre_under_price,
  post.under_price AS post_under_price
FROM first_goals fg
LEFT JOIN LATERAL (
  SELECT s.*
  FROM v_live_market_snapshots_unified s
  WHERE s.match_id = fg.match_id
    AND s.captured_at BETWEEN fg.event_at - INTERVAL '10 minutes' AND fg.event_at
  ORDER BY s.research_source_rank ASC, s.research_market_rank ASC, s.captured_at DESC
  LIMIT 1
) pre ON true
LEFT JOIN LATERAL (
  SELECT s.*
  FROM v_live_market_snapshots_unified s
  WHERE s.match_id = fg.match_id
    AND s.captured_at BETWEEN fg.event_at AND fg.event_at + INTERVAL '10 minutes'
  ORDER BY s.research_source_rank ASC, s.research_market_rank ASC, s.captured_at ASC
  LIMIT 1
) post ON true
WHERE fg.rn = 1;

CREATE OR REPLACE VIEW v_red_card_market_shift AS
WITH red_cards AS (
  SELECT
    e.*,
    ROW_NUMBER() OVER (PARTITION BY e.match_id, e.event_at, e.sequence ORDER BY e.event_at ASC, e.sequence ASC) AS rn
  FROM v_pbp_events_normalized e
  WHERE e.sport = 'soccer'
    AND e.event_family = 'discipline'
    AND (
      e.card_type = 'red'
      OR e.event_type_raw = 'red_card'
      OR COALESCE(e.event_text, '') ILIKE '%red card%'
    )
)
SELECT
  rc.match_id,
  rc.league_id,
  rc.event_id,
  rc.sequence,
  rc.event_at AS red_card_at,
  rc.period,
  rc.clock,
  rc.home_team,
  rc.away_team,
  rc.team_side AS penalized_side,
  rc.team_name AS penalized_team,
  rc.primary_player_name,
  rc.secondary_player_name,
  rc.home_score,
  rc.away_score,
  rc.score_margin,
  rc.score_state_tag,
  rc.event_text,
  pre.snapshot_key AS pre_snapshot_key,
  pre.snapshot_origin AS pre_snapshot_origin,
  pre.provider AS pre_provider,
  pre.market_type AS pre_market_type,
  pre.captured_at AS pre_captured_at,
  post.snapshot_key AS post_snapshot_key,
  post.snapshot_origin AS post_snapshot_origin,
  post.provider AS post_provider,
  post.market_type AS post_market_type,
  post.captured_at AS post_captured_at,
  CASE
    WHEN pre.captured_at IS NULL OR post.captured_at IS NULL THEN NULL
    ELSE ABS(EXTRACT(EPOCH FROM (post.captured_at - pre.captured_at)))::integer
  END AS repricing_window_sec,
  pre.home_ml AS pre_home_ml,
  post.home_ml AS post_home_ml,
  CASE WHEN pre.home_ml IS NOT NULL AND post.home_ml IS NOT NULL THEN post.home_ml - pre.home_ml ELSE NULL END AS home_ml_shift,
  pre.away_ml AS pre_away_ml,
  post.away_ml AS post_away_ml,
  CASE WHEN pre.away_ml IS NOT NULL AND post.away_ml IS NOT NULL THEN post.away_ml - pre.away_ml ELSE NULL END AS away_ml_shift,
  pre.draw_ml AS pre_draw_ml,
  post.draw_ml AS post_draw_ml,
  CASE WHEN pre.draw_ml IS NOT NULL AND post.draw_ml IS NOT NULL THEN post.draw_ml - pre.draw_ml ELSE NULL END AS draw_ml_shift,
  pre.total AS pre_total,
  post.total AS post_total,
  CASE WHEN pre.total IS NOT NULL AND post.total IS NOT NULL THEN post.total - pre.total ELSE NULL END AS total_shift
FROM red_cards rc
LEFT JOIN LATERAL (
  SELECT s.*
  FROM v_live_market_snapshots_unified s
  WHERE s.match_id = rc.match_id
    AND s.captured_at BETWEEN rc.event_at - INTERVAL '10 minutes' AND rc.event_at
  ORDER BY s.research_source_rank ASC, s.research_market_rank ASC, s.captured_at DESC
  LIMIT 1
) pre ON true
LEFT JOIN LATERAL (
  SELECT s.*
  FROM v_live_market_snapshots_unified s
  WHERE s.match_id = rc.match_id
    AND s.captured_at BETWEEN rc.event_at AND rc.event_at + INTERVAL '10 minutes'
  ORDER BY s.research_source_rank ASC, s.research_market_rank ASC, s.captured_at ASC
  LIMIT 1
) post ON true
WHERE rc.rn = 1;

CREATE OR REPLACE VIEW v_timeout_response_basketball AS
WITH timeout_events AS (
  SELECT
    e.*,
    ROW_NUMBER() OVER (PARTITION BY e.match_id, e.event_at, e.sequence ORDER BY e.event_at ASC, e.sequence ASC) AS rn
  FROM v_pbp_events_normalized e
  WHERE e.sport = 'basketball'
    AND (
      e.event_type_raw = 'timeout'
      OR COALESCE(e.play_type, '') ILIKE '%timeout%'
      OR COALESCE(e.event_text, '') ILIKE '%timeout%'
    )
)
SELECT
  te.match_id,
  te.league_id,
  te.event_id,
  te.sequence,
  te.event_at AS timeout_at,
  te.period,
  te.clock,
  te.home_team,
  te.away_team,
  te.team_side AS timeout_side,
  te.team_name AS timeout_team,
  te.home_score,
  te.away_score,
  te.score_margin,
  te.score_state_tag,
  te.event_text,
  pre.snapshot_key AS pre_snapshot_key,
  pre.snapshot_origin AS pre_snapshot_origin,
  pre.provider AS pre_provider,
  pre.market_type AS pre_market_type,
  pre.captured_at AS pre_captured_at,
  post.snapshot_key AS post_snapshot_key,
  post.snapshot_origin AS post_snapshot_origin,
  post.provider AS post_provider,
  post.market_type AS post_market_type,
  post.captured_at AS post_captured_at,
  CASE
    WHEN pre.captured_at IS NULL OR post.captured_at IS NULL THEN NULL
    ELSE ABS(EXTRACT(EPOCH FROM (post.captured_at - pre.captured_at)))::integer
  END AS response_window_sec,
  pre.home_ml AS pre_home_ml,
  post.home_ml AS post_home_ml,
  CASE WHEN pre.home_ml IS NOT NULL AND post.home_ml IS NOT NULL THEN post.home_ml - pre.home_ml ELSE NULL END AS home_ml_shift,
  pre.away_ml AS pre_away_ml,
  post.away_ml AS post_away_ml,
  CASE WHEN pre.away_ml IS NOT NULL AND post.away_ml IS NOT NULL THEN post.away_ml - pre.away_ml ELSE NULL END AS away_ml_shift,
  pre.total AS pre_total,
  post.total AS post_total,
  CASE WHEN pre.total IS NOT NULL AND post.total IS NOT NULL THEN post.total - pre.total ELSE NULL END AS total_shift,
  pre.spread_home AS pre_spread_home,
  post.spread_home AS post_spread_home,
  CASE WHEN pre.spread_home IS NOT NULL AND post.spread_home IS NOT NULL THEN post.spread_home - pre.spread_home ELSE NULL END AS spread_home_shift
FROM timeout_events te
LEFT JOIN LATERAL (
  SELECT s.*
  FROM v_live_market_snapshots_unified s
  WHERE s.match_id = te.match_id
    AND s.captured_at BETWEEN te.event_at - INTERVAL '5 minutes' AND te.event_at
  ORDER BY s.research_source_rank ASC, s.research_market_rank ASC, s.captured_at DESC
  LIMIT 1
) pre ON true
LEFT JOIN LATERAL (
  SELECT s.*
  FROM v_live_market_snapshots_unified s
  WHERE s.match_id = te.match_id
    AND s.captured_at BETWEEN te.event_at AND te.event_at + INTERVAL '5 minutes'
  ORDER BY s.research_source_rank ASC, s.research_market_rank ASC, s.captured_at ASC
  LIMIT 1
) post ON true
WHERE te.rn = 1;
