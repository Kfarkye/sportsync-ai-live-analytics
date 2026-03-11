CREATE OR REPLACE VIEW v_pbp_event_market_context AS
WITH joined AS (
  SELECT
    e.event_id,
    e.match_id,
    e.league_id,
    e.sport,
    e.event_family,
    e.event_type_raw,
    e.event_at,
    e.sequence,
    e.period,
    e.clock,
    e.team_side,
    e.team_name,
    e.primary_player_name,
    e.secondary_player_name,
    e.player_in,
    e.player_out,
    e.card_type,
    e.play_type,
    e.scoring_value,
    e.is_scoring_play,
    e.event_text,
    e.home_team,
    e.away_team,
    e.home_score,
    e.away_score,
    e.score_margin,
    e.score_margin_abs,
    e.lead_state,
    e.score_state_tag,
    e.team_side_source,
    e.team_name_source,
    e.primary_player_source,
    e.secondary_player_source,
    e.scoring_value_source,
    e.event_quality_band,
    e.quality_flags,
    m.status AS match_status,
    m.start_time,
    m.current_odds,
    m.opening_odds,
    m.closing_odds,
    lcs.snapshot_id AS context_snapshot_id,
    lcs.captured_at AS context_captured_at,
    ABS(EXTRACT(EPOCH FROM (lcs.captured_at - e.event_at)))::integer AS context_time_delta_sec,
    lcs.state_version,
    lcs.state_bucket,
    lcs.odds_total AS context_total,
    lcs.odds_home_ml AS context_home_ml,
    lcs.odds_away_ml AS context_away_ml,
    lcs.home_score AS context_home_score,
    lcs.away_score AS context_away_score,
    los.id AS odds_snapshot_id,
    los.captured_at AS odds_captured_at,
    ABS(EXTRACT(EPOCH FROM (los.captured_at - e.event_at)))::integer AS odds_time_delta_sec,
    COALESCE(los.market_type, 'main') AS odds_market_type,
    los.provider AS odds_provider,
    los.source AS odds_source,
    los.home_ml,
    los.away_ml,
    los.draw_ml,
    los.spread_home,
    los.spread_away,
    los.spread_home_price,
    los.spread_away_price,
    los.total,
    los.over_price,
    los.under_price
  FROM v_pbp_events_normalized e
  LEFT JOIN matches m
    ON m.id = e.match_id
  LEFT JOIN LATERAL (
    SELECT lcs.*
    FROM live_context_snapshots lcs
    WHERE lcs.match_id = e.match_id
      AND lcs.captured_at BETWEEN e.event_at - INTERVAL '15 minutes' AND e.event_at + INTERVAL '15 minutes'
    ORDER BY ABS(EXTRACT(EPOCH FROM (lcs.captured_at - e.event_at))) ASC, lcs.captured_at DESC
    LIMIT 1
  ) lcs ON true
  LEFT JOIN LATERAL (
    SELECT los.*
    FROM live_odds_snapshots los
    WHERE los.match_id = e.match_id
      AND los.captured_at BETWEEN e.event_at - INTERVAL '15 minutes' AND e.event_at + INTERVAL '15 minutes'
    ORDER BY ABS(EXTRACT(EPOCH FROM (los.captured_at - e.event_at))) ASC, los.captured_at DESC
    LIMIT 1
  ) los ON true
),
parsed AS (
  SELECT
    j.*,
    CASE
      WHEN (regexp_match(COALESCE(j.closing_odds->>'moneylineHome', j.closing_odds->>'home_ml', j.opening_odds->>'moneylineHome', j.opening_odds->>'home_ml', j.current_odds->>'moneylineHome', j.current_odds->>'home_ml', ''), '([+-]?\d+(?:\.\d+)?)')) IS NOT NULL
        THEN ((regexp_match(COALESCE(j.closing_odds->>'moneylineHome', j.closing_odds->>'home_ml', j.opening_odds->>'moneylineHome', j.opening_odds->>'home_ml', j.current_odds->>'moneylineHome', j.current_odds->>'home_ml', ''), '([+-]?\d+(?:\.\d+)?)'))[1])::numeric
      ELSE NULL
    END AS pregame_home_ml_num,
    CASE
      WHEN (regexp_match(COALESCE(j.closing_odds->>'moneylineAway', j.closing_odds->>'away_ml', j.opening_odds->>'moneylineAway', j.opening_odds->>'away_ml', j.current_odds->>'moneylineAway', j.current_odds->>'away_ml', ''), '([+-]?\d+(?:\.\d+)?)')) IS NOT NULL
        THEN ((regexp_match(COALESCE(j.closing_odds->>'moneylineAway', j.closing_odds->>'away_ml', j.opening_odds->>'moneylineAway', j.opening_odds->>'away_ml', j.current_odds->>'moneylineAway', j.current_odds->>'away_ml', ''), '([+-]?\d+(?:\.\d+)?)'))[1])::numeric
      ELSE NULL
    END AS pregame_away_ml_num,
    CASE
      WHEN (regexp_match(COALESCE(j.closing_odds->>'total', j.closing_odds->>'overUnder', j.opening_odds->>'total', j.opening_odds->>'overUnder', j.current_odds->>'total', j.current_odds->>'overUnder', ''), '([+-]?\d+(?:\.\d+)?)')) IS NOT NULL
        THEN ((regexp_match(COALESCE(j.closing_odds->>'total', j.closing_odds->>'overUnder', j.opening_odds->>'total', j.opening_odds->>'overUnder', j.current_odds->>'total', j.current_odds->>'overUnder', ''), '([+-]?\d+(?:\.\d+)?)'))[1])::numeric
      ELSE NULL
    END AS pregame_total_num,
    CASE
      WHEN (regexp_match(COALESCE(j.closing_odds->>'homeSpread', j.closing_odds->>'spread', j.opening_odds->>'homeSpread', j.opening_odds->>'spread', j.current_odds->>'homeSpread', j.current_odds->>'spread', ''), '([+-]?\d+(?:\.\d+)?)')) IS NOT NULL
        THEN ((regexp_match(COALESCE(j.closing_odds->>'homeSpread', j.closing_odds->>'spread', j.opening_odds->>'homeSpread', j.opening_odds->>'spread', j.current_odds->>'homeSpread', j.current_odds->>'spread', ''), '([+-]?\d+(?:\.\d+)?)'))[1])::numeric
      ELSE NULL
    END AS pregame_home_spread_num
  FROM joined j
)
SELECT
  p.event_id,
  p.match_id,
  p.league_id,
  p.sport,
  p.event_family,
  p.event_type_raw,
  p.event_at,
  p.sequence,
  p.period,
  p.clock,
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
  p.home_team,
  p.away_team,
  p.home_score,
  p.away_score,
  p.score_margin,
  p.score_margin_abs,
  p.lead_state,
  p.score_state_tag,
  p.team_side_source,
  p.team_name_source,
  p.primary_player_source,
  p.secondary_player_source,
  p.scoring_value_source,
  p.event_quality_band,
  p.quality_flags,
  p.match_status,
  p.start_time,
  p.context_snapshot_id,
  p.context_captured_at,
  p.context_time_delta_sec,
  p.state_version,
  p.state_bucket,
  p.context_total,
  p.context_home_ml,
  p.context_away_ml,
  p.context_home_score,
  p.context_away_score,
  p.odds_snapshot_id,
  p.odds_captured_at,
  p.odds_time_delta_sec,
  p.odds_market_type,
  p.odds_provider,
  p.odds_source,
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
  p.pregame_home_ml_num,
  p.pregame_away_ml_num,
  p.pregame_total_num,
  p.pregame_home_spread_num,
  CASE
    WHEN p.pregame_home_ml_num IS NULL OR p.pregame_away_ml_num IS NULL THEN NULL
    WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0)
    ELSE 100.0 / (p.pregame_home_ml_num + 100.0)
  END AS pregame_home_implied_prob,
  CASE
    WHEN p.pregame_home_ml_num IS NULL OR p.pregame_away_ml_num IS NULL THEN NULL
    WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0)
    ELSE 100.0 / (p.pregame_away_ml_num + 100.0)
  END AS pregame_away_implied_prob,
  CASE
    WHEN p.pregame_home_ml_num IS NULL OR p.pregame_away_ml_num IS NULL THEN NULL
    WHEN (
      CASE WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0) ELSE 100.0 / (p.pregame_home_ml_num + 100.0) END
    ) >= (
      CASE WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0) ELSE 100.0 / (p.pregame_away_ml_num + 100.0) END
    ) THEN 'home'
    ELSE 'away'
  END AS pregame_favorite_side,
  CASE
    WHEN p.pregame_home_ml_num IS NULL OR p.pregame_away_ml_num IS NULL THEN NULL
    WHEN GREATEST(
      CASE WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0) ELSE 100.0 / (p.pregame_home_ml_num + 100.0) END,
      CASE WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0) ELSE 100.0 / (p.pregame_away_ml_num + 100.0) END
    ) >= 0.75 THEN 'heavy_favorite'
    WHEN GREATEST(
      CASE WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0) ELSE 100.0 / (p.pregame_home_ml_num + 100.0) END,
      CASE WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0) ELSE 100.0 / (p.pregame_away_ml_num + 100.0) END
    ) >= 0.60 THEN 'favorite'
    ELSE 'coinflip'
  END AS pregame_moneyline_bucket,
  CASE
    WHEN p.pregame_total_num IS NULL THEN NULL
    WHEN p.pregame_total_num < 2.5 THEN 'low_total'
    WHEN p.pregame_total_num <= 3.0 THEN 'mid_total'
    ELSE 'high_total'
  END AS pregame_total_bucket,
  CASE
    WHEN p.pregame_home_spread_num IS NULL THEN NULL
    WHEN ABS(p.pregame_home_spread_num) <= 3 THEN 'tight_spread'
    WHEN ABS(p.pregame_home_spread_num) <= 7 THEN 'mid_spread'
    ELSE 'wide_spread'
  END AS pregame_spread_bucket,
  CASE
    WHEN p.sport = 'soccer' THEN CONCAT(
      COALESCE(
        CASE
          WHEN p.pregame_total_num IS NULL THEN NULL
          WHEN p.pregame_total_num < 2.5 THEN 'LOW_TOTAL'
          WHEN p.pregame_total_num <= 3.0 THEN 'MID_TOTAL'
          ELSE 'HIGH_TOTAL'
        END,
        'TOTAL_UNKNOWN'
      ),
      ' | ',
      COALESCE(
        CASE
          WHEN p.pregame_home_ml_num IS NULL OR p.pregame_away_ml_num IS NULL THEN NULL
          WHEN (
            CASE WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0) ELSE 100.0 / (p.pregame_home_ml_num + 100.0) END
          ) >= (
            CASE WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0) ELSE 100.0 / (p.pregame_away_ml_num + 100.0) END
          ) THEN 'HOME_FAV'
          ELSE 'AWAY_FAV'
        END,
        'FAV_UNKNOWN'
      )
    )
    ELSE CONCAT(
      COALESCE(
        CASE
          WHEN p.pregame_home_spread_num IS NULL THEN NULL
          WHEN ABS(p.pregame_home_spread_num) <= 3 THEN 'TIGHT_SPREAD'
          WHEN ABS(p.pregame_home_spread_num) <= 7 THEN 'MID_SPREAD'
          ELSE 'WIDE_SPREAD'
        END,
        'SPREAD_UNKNOWN'
      ),
      ' | ',
      COALESCE(
        CASE
          WHEN p.pregame_home_ml_num IS NULL OR p.pregame_away_ml_num IS NULL THEN NULL
          WHEN (
            CASE WHEN p.pregame_home_ml_num < 0 THEN ABS(p.pregame_home_ml_num) / (ABS(p.pregame_home_ml_num) + 100.0) ELSE 100.0 / (p.pregame_home_ml_num + 100.0) END
          ) >= (
            CASE WHEN p.pregame_away_ml_num < 0 THEN ABS(p.pregame_away_ml_num) / (ABS(p.pregame_away_ml_num) + 100.0) ELSE 100.0 / (p.pregame_away_ml_num + 100.0) END
          ) THEN 'HOME_FAV'
          ELSE 'AWAY_FAV'
        END,
        'FAV_UNKNOWN'
      )
    )
  END AS pregame_match_label
FROM parsed p;
