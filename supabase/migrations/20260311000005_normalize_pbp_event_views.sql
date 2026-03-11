-- Migration: normalize_pbp_event_views

CREATE INDEX IF NOT EXISTS idx_ge_match_created_at
  ON game_events (match_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lcs_match_time
  ON live_context_snapshots (match_id, captured_at DESC);

CREATE OR REPLACE VIEW v_pbp_events_normalized AS
SELECT
  ge.id AS event_id,
  ge.match_id,
  COALESCE(NULLIF(ge.league_id, ''), m.league_id, m."leagueId") AS league_id,
  LOWER(COALESCE(NULLIF(ge.sport, ''), NULLIF(m.sport, ''))) AS sport,
  ge.event_type AS event_type_raw,
  CASE
    WHEN ge.event_type IN ('goal', 'score') OR COALESCE((ge.play_data->>'scoring_play')::boolean, false) THEN 'score'
    WHEN ge.event_type IN ('card', 'red_card', 'foul', 'penalty') THEN 'discipline'
    WHEN ge.event_type = 'substitution' THEN 'substitution'
    WHEN ge.event_type IN ('timeout', 'challenge', 'period_end', 'kickoff') THEN 'stoppage'
    ELSE 'play'
  END AS event_family,
  ge.sequence,
  ge.created_at AS event_at,
  ge.period,
  ge.clock,
  ge.home_score,
  ge.away_score,
  COALESCE(NULLIF(m.home_team, ''), ge.match_state->>'home_team') AS home_team,
  COALESCE(NULLIF(m.away_team, ''), ge.match_state->>'away_team') AS away_team,
  m.start_time,
  m.status AS match_status,
  ge.source,
  COALESCE(NULLIF(ge.play_data->>'side', ''), NULLIF(ge.play_data->>'homeAway', '')) AS team_side,
  COALESCE(NULLIF(ge.play_data->>'team', ''), NULLIF(ge.play_data->>'team_name', '')) AS team_name,
  COALESCE(
    NULLIF(ge.play_data->>'player', ''),
    NULLIF(ge.play_data->>'scorer', ''),
    NULLIF(ge.play_data->>'batter', ''),
    NULLIF(ge.play_data->>'pitcher', ''),
    NULLIF(ge.play_data->>'shooter', '')
  ) AS primary_player_name,
  COALESCE(
    NULLIF(ge.play_data->>'assister', ''),
    NULLIF(ge.play_data->>'assist', ''),
    NULLIF(ge.play_data->>'player_in', ''),
    NULLIF(ge.play_data->>'player_out', '')
  ) AS secondary_player_name,
  NULLIF(ge.play_data->>'player_in', '') AS player_in,
  NULLIF(ge.play_data->>'player_out', '') AS player_out,
  NULLIF(ge.play_data->>'card_type', '') AS card_type,
  NULLIF(ge.play_data->>'type', '') AS play_type,
  CASE
    WHEN (ge.play_data->>'points') ~ '^-?[0-9]+$' THEN (ge.play_data->>'points')::integer
    WHEN ge.event_type = 'goal' THEN 1
    ELSE NULL
  END AS scoring_value,
  COALESCE((ge.play_data->>'scoring_play')::boolean, ge.event_type IN ('goal', 'score')) AS is_scoring_play,
  COALESCE(NULLIF(ge.play_data->>'text', ''), NULLIF(ge.play_data->>'description', '')) AS event_text,
  ge.play_data AS raw_event,
  ge.box_snapshot,
  ge.odds_open,
  ge.odds_close,
  ge.odds_live,
  ge.bet365_live,
  ge.dk_live_200,
  ge.player_props,
  ge.match_state
FROM game_events ge
LEFT JOIN matches m
  ON m.id = ge.match_id;

CREATE OR REPLACE VIEW v_pbp_event_market_context AS
SELECT
  e.*,
  lcs.id AS context_snapshot_id,
  lcs.captured_at AS context_captured_at,
  ABS(EXTRACT(EPOCH FROM (lcs.captured_at - e.event_at)))::integer AS context_time_delta_sec,
  lcs.game_status,
  lcs.situation,
  lcs.last_play AS context_last_play,
  lcs.recent_plays,
  lcs.momentum,
  lcs.predictor,
  lcs.stats AS context_stats,
  lcs.leaders AS context_leaders,
  lcs.advanced_metrics,
  lcs.match_context,
  lcs.deterministic_signals,
  lcs.odds_current AS context_odds_current,
  lcs.odds_total AS context_total,
  lcs.odds_home_ml AS context_home_ml,
  lcs.odds_away_ml AS context_away_ml,
  los.id AS odds_snapshot_id,
  los.captured_at AS odds_captured_at,
  ABS(EXTRACT(EPOCH FROM (los.captured_at - e.event_at)))::integer AS odds_time_delta_sec,
  los.provider AS odds_provider,
  los.provider_id AS odds_provider_id,
  los.market_type AS odds_market_type,
  los.status AS odds_status,
  los.home_ml,
  los.away_ml,
  los.draw_ml,
  los.spread_home,
  los.spread_away,
  los.spread_home_price,
  los.spread_away_price,
  los.total,
  los.over_price,
  los.under_price,
  los.is_live AS odds_is_live,
  los.source AS odds_source,
  los.raw_payload AS odds_raw_payload,
  m.current_odds,
  m.opening_odds,
  m.closing_odds
FROM v_pbp_events_normalized e
LEFT JOIN matches m
  ON m.id = e.match_id
LEFT JOIN LATERAL (
  SELECT lcs.*
  FROM live_context_snapshots lcs
  WHERE lcs.match_id = e.match_id
    AND lcs.captured_at BETWEEN e.event_at - INTERVAL '10 minutes' AND e.event_at + INTERVAL '10 minutes'
  ORDER BY
    ABS(EXTRACT(EPOCH FROM (lcs.captured_at - e.event_at))) ASC,
    lcs.captured_at DESC
  LIMIT 1
) lcs
  ON true
LEFT JOIN LATERAL (
  SELECT los.*
  FROM live_odds_snapshots los
  WHERE los.match_id = e.match_id
    AND los.captured_at BETWEEN e.event_at - INTERVAL '10 minutes' AND e.event_at + INTERVAL '10 minutes'
  ORDER BY
    ABS(EXTRACT(EPOCH FROM (los.captured_at - e.event_at))) ASC,
    los.captured_at DESC
  LIMIT 1
) los
  ON true;
