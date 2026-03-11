-- Migration: create_live_market_research_clean_views
-- Add cleaned research views on top of the raw repricing views.
-- Goals:
-- 1. keep only usable pre/post market samples
-- 2. dedupe true red-card events
-- 3. resolve basketball timeout attribution from event text and drop TV timeouts

CREATE OR REPLACE VIEW v_first_goal_repricing_clean AS
SELECT *
FROM v_first_goal_repricing r
WHERE r.pre_snapshot_origin IS NOT NULL
  AND r.post_snapshot_origin IS NOT NULL
  AND (
    r.pre_home_ml IS NOT NULL OR r.post_home_ml IS NOT NULL OR
    r.pre_draw_ml IS NOT NULL OR r.post_draw_ml IS NOT NULL OR
    r.pre_total IS NOT NULL OR r.post_total IS NOT NULL
  );

CREATE OR REPLACE VIEW v_red_card_market_shift_clean AS
WITH eligible AS (
  SELECT
    r.*,
    COALESCE(r.primary_player_name, REGEXP_REPLACE(r.event_text, '\s*receives a red card.*$', '', 'i')) AS carded_player,
    ROW_NUMBER() OVER (
      PARTITION BY
        r.match_id,
        COALESCE(r.penalized_team, ''),
        COALESCE(r.penalized_side, ''),
        COALESCE(r.primary_player_name, REGEXP_REPLACE(r.event_text, '\s*receives a red card.*$', '', 'i'), ''),
        DATE_TRUNC('minute', r.red_card_at)
      ORDER BY r.red_card_at ASC, r.event_id
    ) AS dedupe_rank
  FROM v_red_card_market_shift r
  WHERE r.event_text IS NOT NULL
    AND r.event_text NOT ILIKE 'Goal!%'
    AND (
      r.event_text ILIKE '%red card%'
      OR r.event_text ILIKE 'Second yellow card%'
      OR r.event_text ILIKE '%shown the red card%'
      OR r.event_text ILIKE '%receives a red card%'
    )
)
SELECT *
FROM eligible e
WHERE e.dedupe_rank = 1
  AND e.pre_snapshot_origin IS NOT NULL
  AND e.post_snapshot_origin IS NOT NULL
  AND (
    e.pre_home_ml IS NOT NULL OR e.post_home_ml IS NOT NULL OR
    e.pre_draw_ml IS NOT NULL OR e.post_draw_ml IS NOT NULL OR
    e.pre_total IS NOT NULL OR e.post_total IS NOT NULL
  );

CREATE OR REPLACE VIEW v_timeout_response_basketball_clean AS
WITH resolved AS (
  SELECT
    t.*,
    NULLIF(REGEXP_REPLACE(COALESCE(t.event_text, ''), '\s*Timeout\s*$', '', 'i'), '') AS timeout_team_from_text,
    CASE
      WHEN COALESCE(t.timeout_team, '') <> '' THEN t.timeout_team
      WHEN COALESCE(t.event_text, '') ILIKE 'Official TV Timeout%' THEN NULL
      ELSE NULLIF(REGEXP_REPLACE(COALESCE(t.event_text, ''), '\s*Timeout\s*$', '', 'i'), '')
    END AS resolved_timeout_team,
    CASE
      WHEN t.timeout_side IS NOT NULL THEN t.timeout_side
      WHEN COALESCE(t.event_text, '') ILIKE 'Official TV Timeout%' THEN NULL
      WHEN LOWER(REGEXP_REPLACE(COALESCE(t.event_text, ''), '\s*Timeout\s*$', '', 'i')) = LOWER(COALESCE(t.home_team, '')) THEN 'home'
      WHEN LOWER(REGEXP_REPLACE(COALESCE(t.event_text, ''), '\s*Timeout\s*$', '', 'i')) = LOWER(COALESCE(t.away_team, '')) THEN 'away'
      WHEN LOWER(COALESCE(t.home_team, '')) LIKE '%' || LOWER(COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(t.event_text, ''), '\s*Timeout\s*$', '', 'i'), ''), '')) || '%' THEN 'home'
      WHEN LOWER(COALESCE(t.away_team, '')) LIKE '%' || LOWER(COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(t.event_text, ''), '\s*Timeout\s*$', '', 'i'), ''), '')) || '%' THEN 'away'
      ELSE NULL
    END AS resolved_timeout_side
  FROM v_timeout_response_basketball t
)
SELECT
  r.match_id,
  r.league_id,
  r.event_id,
  r.sequence,
  r.timeout_at,
  r.period,
  r.clock,
  r.home_team,
  r.away_team,
  r.resolved_timeout_side AS timeout_side,
  r.resolved_timeout_team AS timeout_team,
  r.home_score,
  r.away_score,
  r.score_margin,
  r.score_state_tag,
  r.event_text,
  r.pre_snapshot_key,
  r.pre_snapshot_origin,
  r.pre_provider,
  r.pre_captured_at,
  r.post_snapshot_key,
  r.post_snapshot_origin,
  r.post_provider,
  r.post_captured_at,
  r.response_window_sec,
  r.pre_home_ml,
  r.post_home_ml,
  r.home_ml_shift,
  r.pre_away_ml,
  r.post_away_ml,
  r.away_ml_shift,
  r.pre_total,
  r.post_total,
  r.total_shift,
  r.pre_spread_home,
  r.post_spread_home,
  r.spread_home_shift
FROM resolved r
WHERE COALESCE(r.event_text, '') NOT ILIKE 'Official TV Timeout%'
  AND COALESCE(r.event_text, '') NOT ILIKE '%challenge%'
  AND r.resolved_timeout_team IS NOT NULL
  AND r.pre_snapshot_origin IS NOT NULL
  AND r.post_snapshot_origin IS NOT NULL
  AND (
    r.pre_home_ml IS NOT NULL OR r.post_home_ml IS NOT NULL OR
    r.pre_total IS NOT NULL OR r.post_total IS NOT NULL OR
    r.pre_spread_home IS NOT NULL OR r.post_spread_home IS NOT NULL
  );
