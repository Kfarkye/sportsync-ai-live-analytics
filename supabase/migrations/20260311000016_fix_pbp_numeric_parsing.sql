-- Patch: rebuild v_pbp_event_market_context with safe numeric extraction
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
