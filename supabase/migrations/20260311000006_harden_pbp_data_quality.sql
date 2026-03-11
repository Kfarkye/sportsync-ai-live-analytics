-- Migration: harden_pbp_data_quality

CREATE OR REPLACE VIEW v_pbp_events_normalized AS
WITH base AS (
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
    NULLIF(LOWER(COALESCE(ge.play_data->>'side', ge.play_data->>'homeAway')), '') AS raw_team_side,
    COALESCE(NULLIF(ge.play_data->>'team', ''), NULLIF(ge.play_data->>'team_name', '')) AS raw_team_name,
    COALESCE(
      NULLIF(ge.play_data->>'player', ''),
      NULLIF(ge.play_data->>'scorer', ''),
      NULLIF(ge.play_data->>'batter', ''),
      NULLIF(ge.play_data->>'pitcher', ''),
      NULLIF(ge.play_data->>'shooter', '')
    ) AS raw_primary_player_name,
    COALESCE(
      NULLIF(ge.play_data->>'assister', ''),
      NULLIF(ge.play_data->>'assist', ''),
      NULLIF(ge.play_data->>'player_in', ''),
      NULLIF(ge.play_data->>'player_out', '')
    ) AS raw_secondary_player_name,
    NULLIF(ge.play_data->>'player_in', '') AS player_in,
    NULLIF(ge.play_data->>'player_out', '') AS player_out,
    NULLIF(ge.play_data->>'card_type', '') AS card_type,
    NULLIF(ge.play_data->>'type', '') AS raw_play_type,
    CASE
      WHEN (ge.play_data->>'points') ~ '^-?[0-9]+$' THEN (ge.play_data->>'points')::integer
      WHEN ge.event_type = 'goal' THEN 1
      ELSE NULL
    END AS raw_scoring_value,
    COALESCE((ge.play_data->>'scoring_play')::boolean, ge.event_type IN ('goal', 'score')) AS raw_is_scoring_play,
    COALESCE(NULLIF(ge.play_data->>'text', ''), NULLIF(ge.play_data->>'description', '')) AS raw_event_text,
    ge.play_data AS raw_event,
    ge.box_snapshot,
    ge.odds_open,
    ge.odds_close,
    ge.odds_live,
    ge.bet365_live,
    ge.dk_live_200,
    ge.player_props,
    ge.match_state,
    LAG(ge.home_score) OVER (
      PARTITION BY ge.match_id
      ORDER BY ge.created_at, ge.sequence, ge.id
    ) AS prev_home_score,
    LAG(ge.away_score) OVER (
      PARTITION BY ge.match_id
      ORDER BY ge.created_at, ge.sequence, ge.id
    ) AS prev_away_score
  FROM game_events ge
  LEFT JOIN matches m
    ON m.id = ge.match_id
),
resolved AS (
  SELECT
    b.*,
    CASE
      WHEN b.raw_team_side IN ('home', 'h') THEN 'home'
      WHEN b.raw_team_side IN ('away', 'a', 'visitor', 'visitors') THEN 'away'
      ELSE NULL
    END AS team_side_from_payload,
    CASE
      WHEN b.raw_team_name IS NULL THEN NULL
      WHEN LOWER(REGEXP_REPLACE(b.raw_team_name, '[^a-zA-Z0-9]+', '', 'g')) = LOWER(REGEXP_REPLACE(COALESCE(b.home_team, ''), '[^a-zA-Z0-9]+', '', 'g')) THEN 'home'
      WHEN LOWER(REGEXP_REPLACE(b.raw_team_name, '[^a-zA-Z0-9]+', '', 'g')) = LOWER(REGEXP_REPLACE(COALESCE(b.away_team, ''), '[^a-zA-Z0-9]+', '', 'g')) THEN 'away'
      WHEN LOWER(REGEXP_REPLACE(b.raw_team_name, '[^a-zA-Z0-9]+', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(COALESCE(b.home_team, ''), '[^a-zA-Z0-9]+', '', 'g')) || '%' THEN 'home'
      WHEN LOWER(REGEXP_REPLACE(b.raw_team_name, '[^a-zA-Z0-9]+', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(COALESCE(b.away_team, ''), '[^a-zA-Z0-9]+', '', 'g')) || '%' THEN 'away'
      ELSE NULL
    END AS team_side_from_team_name,
    CASE
      WHEN COALESCE(b.home_score, 0) > COALESCE(b.prev_home_score, COALESCE(b.home_score, 0))
        AND COALESCE(b.away_score, 0) = COALESCE(b.prev_away_score, COALESCE(b.away_score, 0)) THEN 'home'
      WHEN COALESCE(b.away_score, 0) > COALESCE(b.prev_away_score, COALESCE(b.away_score, 0))
        AND COALESCE(b.home_score, 0) = COALESCE(b.prev_home_score, COALESCE(b.home_score, 0)) THEN 'away'
      ELSE NULL
    END AS team_side_from_score_delta,
    CASE
      WHEN b.sport <> 'soccer' OR b.raw_event_text IS NULL THEN NULL
      ELSE COALESCE(
        SUBSTRING(b.raw_event_text FROM '^Substitution, ([^.]+)\\.'),
        SUBSTRING(b.raw_event_text FROM '^Corner, ([^.]+)\\.'),
        SUBSTRING(b.raw_event_text FROM '^Offside, ([^.]+)\\.'),
        SUBSTRING(b.raw_event_text FROM '^Penalty ([^.]+)\\.'),
        SUBSTRING(b.raw_event_text FROM '^Foul by ([^(\\.]+)')
      )
    END AS team_name_from_text,
    CASE
      WHEN b.raw_primary_player_name IS NOT NULL THEN b.raw_primary_player_name
      WHEN b.raw_event_text IS NULL THEN NULL
      WHEN b.sport = 'basketball' THEN COALESCE(
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) makes '),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) misses '),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) defensive rebound'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) offensive rebound'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) enters the game'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) bad pass'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) turnover'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) personal take foul'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) personal foul'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) shooting foul'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) loose ball foul'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) offensive foul'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) foul'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) blocks '),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) steals ')
      )
      WHEN b.sport = 'hockey' THEN COALESCE(
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) Wrist Shot'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) Slap Shot'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) Backhand'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) Tip-In'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) Snap Shot'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) Wrap-around'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) faceoff won'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) Giveaway'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) Takeaway')
      )
      WHEN b.sport = 'soccer' THEN COALESCE(
        SUBSTRING(b.raw_event_text FROM '\. ([^.]+?) \('),
        SUBSTRING(b.raw_event_text FROM '^Substitution, [^.]+\\. ([^.]+?) replaces '),
        SUBSTRING(b.raw_event_text FROM '^Penalty [^.]+\\. ([^.]+?) draws a foul'),
        SUBSTRING(b.raw_event_text FROM '^([^,]+?) \(')
      )
      ELSE NULL
    END AS primary_player_from_text,
    CASE
      WHEN b.raw_secondary_player_name IS NOT NULL THEN b.raw_secondary_player_name
      WHEN b.raw_event_text IS NULL THEN NULL
      ELSE COALESCE(
        SUBSTRING(b.raw_event_text FROM 'Assisted by ([^.]+?)(?: following|\.|$)'),
        SUBSTRING(b.raw_event_text FROM '^Substitution, [^.]+\\. [^.]+? replaces ([^.]+?)\\.'),
        SUBSTRING(b.raw_event_text FROM 'Conceded by ([^.]+?)(?:\.|$)'),
        SUBSTRING(b.raw_event_text FROM 'against ([^.]+?)(?:\.|$)')
      )
    END AS secondary_player_from_text,
    CASE
      WHEN b.raw_scoring_value IS NOT NULL THEN b.raw_scoring_value
      WHEN COALESCE(b.home_score, 0) > COALESCE(b.prev_home_score, COALESCE(b.home_score, 0))
        AND COALESCE(b.away_score, 0) = COALESCE(b.prev_away_score, COALESCE(b.away_score, 0))
        THEN COALESCE(b.home_score, 0) - COALESCE(b.prev_home_score, COALESCE(b.home_score, 0))
      WHEN COALESCE(b.away_score, 0) > COALESCE(b.prev_away_score, COALESCE(b.away_score, 0))
        AND COALESCE(b.home_score, 0) = COALESCE(b.prev_home_score, COALESCE(b.home_score, 0))
        THEN COALESCE(b.away_score, 0) - COALESCE(b.prev_away_score, COALESCE(b.away_score, 0))
      ELSE NULL
    END AS scoring_value_resolved
  FROM base b
),
finalized AS (
  SELECT
    r.*,
    COALESCE(
      r.team_side_from_payload,
      r.team_side_from_team_name,
      CASE
        WHEN r.team_name_from_text IS NULL THEN NULL
        WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) = LOWER(REGEXP_REPLACE(COALESCE(r.home_team, ''), '[^a-zA-Z0-9]+', '', 'g')) THEN 'home'
        WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) = LOWER(REGEXP_REPLACE(COALESCE(r.away_team, ''), '[^a-zA-Z0-9]+', '', 'g')) THEN 'away'
        WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(COALESCE(r.home_team, ''), '[^a-zA-Z0-9]+', '', 'g')) || '%' THEN 'home'
        WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(COALESCE(r.away_team, ''), '[^a-zA-Z0-9]+', '', 'g')) || '%' THEN 'away'
        ELSE NULL
      END,
      r.team_side_from_score_delta
    ) AS resolved_team_side,
    COALESCE(
      r.raw_team_name,
      r.team_name_from_text,
      CASE
        WHEN COALESCE(
          r.team_side_from_payload,
          r.team_side_from_team_name,
          CASE
            WHEN r.team_name_from_text IS NULL THEN NULL
            WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) = LOWER(REGEXP_REPLACE(COALESCE(r.home_team, ''), '[^a-zA-Z0-9]+', '', 'g')) THEN 'home'
            WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) = LOWER(REGEXP_REPLACE(COALESCE(r.away_team, ''), '[^a-zA-Z0-9]+', '', 'g')) THEN 'away'
            WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(COALESCE(r.home_team, ''), '[^a-zA-Z0-9]+', '', 'g')) || '%' THEN 'home'
            WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(COALESCE(r.away_team, ''), '[^a-zA-Z0-9]+', '', 'g')) || '%' THEN 'away'
            ELSE NULL
          END,
          r.team_side_from_score_delta
        ) = 'home' THEN r.home_team
        WHEN COALESCE(
          r.team_side_from_payload,
          r.team_side_from_team_name,
          CASE
            WHEN r.team_name_from_text IS NULL THEN NULL
            WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) = LOWER(REGEXP_REPLACE(COALESCE(r.home_team, ''), '[^a-zA-Z0-9]+', '', 'g')) THEN 'home'
            WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) = LOWER(REGEXP_REPLACE(COALESCE(r.away_team, ''), '[^a-zA-Z0-9]+', '', 'g')) THEN 'away'
            WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(COALESCE(r.home_team, ''), '[^a-zA-Z0-9]+', '', 'g')) || '%' THEN 'home'
            WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(COALESCE(r.away_team, ''), '[^a-zA-Z0-9]+', '', 'g')) || '%' THEN 'away'
            ELSE NULL
          END,
          r.team_side_from_score_delta
        ) = 'away' THEN r.away_team
        ELSE NULL
      END
    ) AS resolved_team_name,
    COALESCE(r.raw_primary_player_name, r.primary_player_from_text) AS resolved_primary_player_name,
    COALESCE(r.raw_secondary_player_name, r.secondary_player_from_text) AS resolved_secondary_player_name,
    CASE
      WHEN r.raw_team_side IS NOT NULL THEN 'payload'
      WHEN r.team_side_from_team_name IS NOT NULL THEN 'team_name_match'
      WHEN r.team_name_from_text IS NOT NULL THEN 'event_text_team_match'
      WHEN r.team_side_from_score_delta IS NOT NULL THEN 'score_delta'
      ELSE 'missing'
    END AS team_side_source,
    CASE
      WHEN r.raw_team_name IS NOT NULL THEN 'payload'
      WHEN r.team_name_from_text IS NOT NULL THEN 'event_text'
      WHEN COALESCE(r.team_side_from_payload, r.team_side_from_team_name, r.team_side_from_score_delta) IS NOT NULL THEN 'side_to_match_team'
      ELSE 'missing'
    END AS team_name_source,
    CASE
      WHEN r.raw_primary_player_name IS NOT NULL THEN 'payload'
      WHEN r.primary_player_from_text IS NOT NULL THEN 'event_text'
      ELSE 'missing'
    END AS primary_player_source,
    CASE
      WHEN r.raw_secondary_player_name IS NOT NULL THEN 'payload'
      WHEN r.secondary_player_from_text IS NOT NULL THEN 'event_text'
      ELSE 'missing'
    END AS secondary_player_source,
    CASE
      WHEN r.raw_scoring_value IS NOT NULL THEN 'payload'
      WHEN r.scoring_value_resolved IS NOT NULL THEN 'score_delta'
      ELSE 'missing'
    END AS scoring_value_source,
    CASE
      WHEN r.raw_play_type IS NOT NULL THEN r.raw_play_type
      ELSE INITCAP(REPLACE(r.event_type_raw, '_', ' '))
    END AS resolved_play_type,
    CASE
      WHEN COALESCE(r.home_score, 0) > COALESCE(r.away_score, 0) THEN 'home_lead'
      WHEN COALESCE(r.away_score, 0) > COALESCE(r.home_score, 0) THEN 'away_lead'
      ELSE 'tied'
    END AS lead_state,
    COALESCE(r.home_score, 0) - COALESCE(r.away_score, 0) AS score_margin,
    ABS(COALESCE(r.home_score, 0) - COALESCE(r.away_score, 0)) AS score_margin_abs,
    CASE
      WHEN COALESCE(r.home_score, 0) = COALESCE(r.away_score, 0) THEN 'tied'
      WHEN ABS(COALESCE(r.home_score, 0) - COALESCE(r.away_score, 0)) = 1 THEN 'one_score'
      WHEN ABS(COALESCE(r.home_score, 0) - COALESCE(r.away_score, 0)) <= 3 THEN 'competitive'
      ELSE 'blowout'
    END AS score_state_tag,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN COALESCE(r.raw_event_text, '') = '' THEN 'missing_text' END,
      CASE WHEN COALESCE(r.raw_team_name, r.team_name_from_text, CASE WHEN COALESCE(r.team_side_from_payload, r.team_side_from_team_name, r.team_side_from_score_delta) = 'home' THEN r.home_team WHEN COALESCE(r.team_side_from_payload, r.team_side_from_team_name, r.team_side_from_score_delta) = 'away' THEN r.away_team END) IS NULL THEN 'missing_team_name' END,
      CASE WHEN COALESCE(r.team_side_from_payload, r.team_side_from_team_name, CASE WHEN r.team_name_from_text IS NULL THEN NULL WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) = LOWER(REGEXP_REPLACE(COALESCE(r.home_team, ''), '[^a-zA-Z0-9]+', '', 'g')) THEN 'home' WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) = LOWER(REGEXP_REPLACE(COALESCE(r.away_team, ''), '[^a-zA-Z0-9]+', '', 'g')) THEN 'away' WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(COALESCE(r.home_team, ''), '[^a-zA-Z0-9]+', '', 'g')) || '%' THEN 'home' WHEN LOWER(REGEXP_REPLACE(r.team_name_from_text, '[^a-zA-Z0-9]+', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(COALESCE(r.away_team, ''), '[^a-zA-Z0-9]+', '', 'g')) || '%' THEN 'away' ELSE NULL END, r.team_side_from_score_delta) IS NULL THEN 'missing_team_side' END,
      CASE WHEN COALESCE(r.raw_primary_player_name, r.primary_player_from_text) IS NULL AND r.event_family IN ('score', 'play') THEN 'missing_primary_player' END,
      CASE WHEN COALESCE(r.raw_scoring_value, r.scoring_value_resolved) IS NULL AND r.event_family = 'score' THEN 'missing_scoring_value' END
    ], NULL::text) AS quality_flags
  FROM resolved r
)
SELECT
  f.event_id,
  f.match_id,
  f.league_id,
  f.sport,
  f.event_type_raw,
  f.event_family,
  f.sequence,
  f.event_at,
  f.period,
  f.clock,
  f.home_score,
  f.away_score,
  f.home_team,
  f.away_team,
  f.start_time,
  f.match_status,
  f.source,
  f.resolved_team_side AS team_side,
  f.resolved_team_name AS team_name,
  f.resolved_primary_player_name AS primary_player_name,
  f.resolved_secondary_player_name AS secondary_player_name,
  f.player_in,
  f.player_out,
  f.card_type,
  f.resolved_play_type AS play_type,
  f.scoring_value_resolved AS scoring_value,
  COALESCE(f.raw_is_scoring_play, f.scoring_value_resolved IS NOT NULL) AS is_scoring_play,
  f.raw_event_text AS event_text,
  f.raw_event,
  f.box_snapshot,
  f.odds_open,
  f.odds_close,
  f.odds_live,
  f.bet365_live,
  f.dk_live_200,
  f.player_props,
  f.match_state,
  CASE
    WHEN f.resolved_team_side = 'home' THEN f.away_team
    WHEN f.resolved_team_side = 'away' THEN f.home_team
    ELSE NULL
  END AS opponent_team,
  f.raw_team_side,
  f.raw_team_name,
  f.raw_primary_player_name,
  f.raw_secondary_player_name,
  f.team_side_source,
  f.team_name_source,
  f.primary_player_source,
  f.secondary_player_source,
  f.scoring_value_source,
  f.lead_state,
  f.score_margin,
  f.score_margin_abs,
  f.score_state_tag,
  CASE
    WHEN COALESCE(ARRAY_LENGTH(f.quality_flags, 1), 0) = 0 THEN 'high'
    WHEN COALESCE(ARRAY_LENGTH(f.quality_flags, 1), 0) <= 2 THEN 'medium'
    ELSE 'low'
  END AS event_quality_band,
  f.quality_flags
FROM finalized f;

CREATE OR REPLACE VIEW v_pbp_event_market_context AS
WITH joined AS (
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
    ON true
),
parsed AS (
  SELECT
    j.*,
    CASE
      WHEN NULLIF(REGEXP_REPLACE(COALESCE(j.closing_odds->>'moneylineHome', j.closing_odds->>'home_ml', j.opening_odds->>'moneylineHome', j.opening_odds->>'home_ml', j.current_odds->>'moneylineHome', j.current_odds->>'home_ml', ''), '[^0-9\-\.]+', '', 'g'), '') IS NOT NULL
        THEN NULLIF(REGEXP_REPLACE(COALESCE(j.closing_odds->>'moneylineHome', j.closing_odds->>'home_ml', j.opening_odds->>'moneylineHome', j.opening_odds->>'home_ml', j.current_odds->>'moneylineHome', j.current_odds->>'home_ml', ''), '[^0-9\-\.]+', '', 'g'), '')::numeric
      ELSE NULL
    END AS pregame_home_ml_num,
    CASE
      WHEN NULLIF(REGEXP_REPLACE(COALESCE(j.closing_odds->>'moneylineAway', j.closing_odds->>'away_ml', j.opening_odds->>'moneylineAway', j.opening_odds->>'away_ml', j.current_odds->>'moneylineAway', j.current_odds->>'away_ml', ''), '[^0-9\-\.]+', '', 'g'), '') IS NOT NULL
        THEN NULLIF(REGEXP_REPLACE(COALESCE(j.closing_odds->>'moneylineAway', j.closing_odds->>'away_ml', j.opening_odds->>'moneylineAway', j.opening_odds->>'away_ml', j.current_odds->>'moneylineAway', j.current_odds->>'away_ml', ''), '[^0-9\-\.]+', '', 'g'), '')::numeric
      ELSE NULL
    END AS pregame_away_ml_num,
    CASE
      WHEN NULLIF(REGEXP_REPLACE(COALESCE(j.closing_odds->>'total', j.closing_odds->>'overUnder', j.opening_odds->>'total', j.opening_odds->>'overUnder', j.current_odds->>'total', j.current_odds->>'overUnder', ''), '[^0-9\-\.]+', '', 'g'), '') IS NOT NULL
        THEN NULLIF(REGEXP_REPLACE(COALESCE(j.closing_odds->>'total', j.closing_odds->>'overUnder', j.opening_odds->>'total', j.opening_odds->>'overUnder', j.current_odds->>'total', j.current_odds->>'overUnder', ''), '[^0-9\-\.]+', '', 'g'), '')::numeric
      ELSE NULL
    END AS pregame_total_num,
    CASE
      WHEN NULLIF(REGEXP_REPLACE(COALESCE(j.closing_odds->>'homeSpread', j.closing_odds->>'spread', j.opening_odds->>'homeSpread', j.opening_odds->>'spread', j.current_odds->>'homeSpread', j.current_odds->>'spread', ''), '[^0-9\-\.]+', '', 'g'), '') IS NOT NULL
        THEN NULLIF(REGEXP_REPLACE(COALESCE(j.closing_odds->>'homeSpread', j.closing_odds->>'spread', j.opening_odds->>'homeSpread', j.opening_odds->>'spread', j.current_odds->>'homeSpread', j.current_odds->>'spread', ''), '[^0-9\-\.]+', '', 'g'), '')::numeric
      ELSE NULL
    END AS pregame_home_spread_num
  FROM joined j
)
SELECT
  p.event_id,
  p.match_id,
  p.league_id,
  p.sport,
  p.event_type_raw,
  p.event_family,
  p.sequence,
  p.event_at,
  p.period,
  p.clock,
  p.home_score,
  p.away_score,
  p.home_team,
  p.away_team,
  p.start_time,
  p.match_status,
  p.source,
  p.team_side,
  p.team_name,
  p.primary_player_name,
  p.secondary_player_name,
  p.player_in,
  p.player_out,
  p.card_type,
  p.play_type,
  p.scoring_value,
  p.is_scoring_play,
  p.event_text,
  p.raw_event,
  p.box_snapshot,
  p.odds_open,
  p.odds_close,
  p.odds_live,
  p.bet365_live,
  p.dk_live_200,
  p.player_props,
  p.match_state,
  p.context_snapshot_id,
  p.context_captured_at,
  p.context_time_delta_sec,
  p.game_status,
  p.situation,
  p.context_last_play,
  p.recent_plays,
  p.momentum,
  p.predictor,
  p.context_stats,
  p.context_leaders,
  p.advanced_metrics,
  p.match_context,
  p.deterministic_signals,
  p.context_odds_current,
  p.context_total,
  p.context_home_ml,
  p.context_away_ml,
  p.odds_snapshot_id,
  p.odds_captured_at,
  p.odds_time_delta_sec,
  p.odds_provider,
  p.odds_provider_id,
  p.odds_market_type,
  p.odds_status,
  p.home_ml,
  p.away_ml,
  p.draw_ml,
  p.spread_home,
  p.spread_away,
  p.spread_home_price,
  p.spread_away_price,
  p.total,
  p.over_price,
  p.under_price,
  p.odds_is_live,
  p.odds_source,
  p.odds_raw_payload,
  p.current_odds,
  p.opening_odds,
  p.closing_odds,
  p.opponent_team,
  p.raw_team_side,
  p.raw_team_name,
  p.raw_primary_player_name,
  p.raw_secondary_player_name,
  p.team_side_source,
  p.team_name_source,
  p.primary_player_source,
  p.secondary_player_source,
  p.scoring_value_source,
  p.lead_state,
  p.score_margin,
  p.score_margin_abs,
  p.score_state_tag,
  p.event_quality_band,
  p.quality_flags,
  CASE
    WHEN p.context_snapshot_id IS NULL THEN 'missing'
    WHEN p.context_time_delta_sec <= 30 THEN 'exact'
    WHEN p.context_time_delta_sec <= 120 THEN 'near'
    ELSE 'stale'
  END AS context_join_quality,
  CASE
    WHEN p.odds_snapshot_id IS NULL THEN 'missing'
    WHEN p.odds_time_delta_sec <= 30 THEN 'exact'
    WHEN p.odds_time_delta_sec <= 120 THEN 'near'
    ELSE 'stale'
  END AS odds_join_quality,
  CASE
    WHEN p.pregame_home_ml_num IS NULL OR p.pregame_away_ml_num IS NULL THEN NULL
    WHEN (
      CASE
        WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0)
        ELSE 100.0 / (p.pregame_home_ml_num + 100.0)
      END
    ) >= (
      CASE
        WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0)
        ELSE 100.0 / (p.pregame_away_ml_num + 100.0)
      END
    ) THEN 'home'
    ELSE 'away'
  END AS pregame_favorite_side,
  CASE
    WHEN p.pregame_home_ml_num IS NULL OR p.pregame_away_ml_num IS NULL THEN NULL
    ELSE GREATEST(
      CASE
        WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0)
        ELSE 100.0 / (p.pregame_home_ml_num + 100.0)
      END,
      CASE
        WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0)
        ELSE 100.0 / (p.pregame_away_ml_num + 100.0)
      END
    )
  END AS pregame_favorite_implied_prob,
  CASE
    WHEN p.pregame_home_ml_num IS NULL OR p.pregame_away_ml_num IS NULL THEN NULL
    WHEN ABS(
      (
        CASE
          WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0)
          ELSE 100.0 / (p.pregame_home_ml_num + 100.0)
        END
      ) - (
        CASE
          WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0)
          ELSE 100.0 / (p.pregame_away_ml_num + 100.0)
        END
      )
    ) < 0.03 THEN 'pickem'
    WHEN GREATEST(
      CASE
        WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0)
        ELSE 100.0 / (p.pregame_home_ml_num + 100.0)
      END,
      CASE
        WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0)
        ELSE 100.0 / (p.pregame_away_ml_num + 100.0)
      END
    ) >= 0.70 THEN 'heavy_favorite'
    WHEN GREATEST(
      CASE
        WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0)
        ELSE 100.0 / (p.pregame_home_ml_num + 100.0)
      END,
      CASE
        WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0)
        ELSE 100.0 / (p.pregame_away_ml_num + 100.0)
      END
    ) >= 0.58 THEN 'moderate_favorite'
    ELSE 'light_favorite'
  END AS pregame_moneyline_bucket,
  CASE
    WHEN p.pregame_total_num IS NULL THEN NULL
    WHEN p.sport = 'soccer' AND p.pregame_total_num <= 2.5 THEN 'low_total'
    WHEN p.sport = 'soccer' AND p.pregame_total_num > 3.0 THEN 'high_total'
    WHEN p.sport = 'basketball' AND p.pregame_total_num < 220 THEN 'low_total'
    WHEN p.sport = 'basketball' AND p.pregame_total_num > 235 THEN 'high_total'
    WHEN p.sport IN ('hockey', 'baseball') AND p.pregame_total_num < 5.5 THEN 'low_total'
    WHEN p.sport IN ('hockey', 'baseball') AND p.pregame_total_num > 6.5 THEN 'high_total'
    ELSE 'mid_total'
  END AS pregame_total_bucket,
  CASE
    WHEN p.pregame_home_spread_num IS NULL THEN NULL
    WHEN p.sport = 'basketball' AND ABS(p.pregame_home_spread_num) <= 3 THEN 'tight_spread'
    WHEN p.sport = 'basketball' AND ABS(p.pregame_home_spread_num) > 7 THEN 'wide_spread'
    WHEN p.sport = 'soccer' AND ABS(p.pregame_home_spread_num) <= 0.5 THEN 'tight_spread'
    WHEN p.sport = 'soccer' AND ABS(p.pregame_home_spread_num) > 1.5 THEN 'wide_spread'
    WHEN p.sport IN ('hockey', 'baseball') AND ABS(p.pregame_home_spread_num) <= 0.5 THEN 'tight_spread'
    WHEN p.sport IN ('hockey', 'baseball') AND ABS(p.pregame_home_spread_num) > 1.5 THEN 'wide_spread'
    ELSE 'mid_spread'
  END AS pregame_spread_bucket,
  CONCAT_WS(' | ',
    p.sport,
    COALESCE(
      CASE
        WHEN p.pregame_home_ml_num IS NULL OR p.pregame_away_ml_num IS NULL THEN NULL
        WHEN ABS(
          (
            CASE
              WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0)
              ELSE 100.0 / (p.pregame_home_ml_num + 100.0)
            END
          ) - (
            CASE
              WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0)
              ELSE 100.0 / (p.pregame_away_ml_num + 100.0)
            END
          )
        ) < 0.03 THEN 'pickem'
        WHEN GREATEST(
          CASE
            WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0)
            ELSE 100.0 / (p.pregame_home_ml_num + 100.0)
          END,
          CASE
            WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0)
            ELSE 100.0 / (p.pregame_away_ml_num + 100.0)
          END
        ) >= 0.70 THEN 'heavy_favorite'
        WHEN GREATEST(
          CASE
            WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0)
            ELSE 100.0 / (p.pregame_home_ml_num + 100.0)
          END,
          CASE
            WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0)
            ELSE 100.0 / (p.pregame_away_ml_num + 100.0)
          END
        ) >= 0.58 THEN 'moderate_favorite'
        ELSE 'light_favorite'
      END,
      'unlabeled_market'
    ),
    COALESCE(
      CASE
        WHEN p.pregame_total_num IS NULL THEN NULL
        WHEN p.sport = 'soccer' AND p.pregame_total_num <= 2.5 THEN 'low_total'
        WHEN p.sport = 'soccer' AND p.pregame_total_num > 3.0 THEN 'high_total'
        WHEN p.sport = 'basketball' AND p.pregame_total_num < 220 THEN 'low_total'
        WHEN p.sport = 'basketball' AND p.pregame_total_num > 235 THEN 'high_total'
        WHEN p.sport IN ('hockey', 'baseball') AND p.pregame_total_num < 5.5 THEN 'low_total'
        WHEN p.sport IN ('hockey', 'baseball') AND p.pregame_total_num > 6.5 THEN 'high_total'
        ELSE 'mid_total'
      END,
      'unlabeled_total'
    )
  ) AS pregame_match_label,
  p.pregame_home_ml_num,
  p.pregame_away_ml_num,
  p.pregame_total_num,
  p.pregame_home_spread_num
FROM parsed p;
