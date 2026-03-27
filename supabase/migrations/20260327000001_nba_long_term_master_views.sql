-- Long-term NBA canonical analytics structure
-- 1) mv_nba_game_master: one row per game
-- 2) mv_nba_team_game_master: two rows per game (team perspective)
--
-- Zone mapping:
-- - DATA/ID (Amazon+Google): canonical game/team identities and normalization.
-- - MONEY (Stripe): normalized opening/live/closing market fields.
-- - OPS (SRE+Amazon): refresh function + indexed materialized views.

DROP MATERIALIZED VIEW IF EXISTS public.mv_nba_team_game_master;
DROP MATERIALIZED VIEW IF EXISTS public.mv_nba_game_master;
DROP FUNCTION IF EXISTS public.refresh_nba_master_views();

CREATE OR REPLACE FUNCTION public.jsonb_numeric_any(p_payload jsonb, p_keys text[])
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    SELECT CASE
      WHEN cleaned ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN cleaned::numeric
      ELSE NULL
    END
    FROM unnest(p_keys) AS k
    CROSS JOIN LATERAL (
      SELECT BTRIM(REGEXP_REPLACE(p_payload ->> k, '[,$[:space:]]', '', 'g')) AS cleaned
    ) AS v
    WHERE p_payload IS NOT NULL
      AND p_payload ? k
      AND NULLIF(BTRIM(p_payload ->> k), '') IS NOT NULL
    LIMIT 1
  );
$$;

CREATE MATERIALIZED VIEW public.mv_nba_game_master AS
WITH nba_events AS (
  SELECT
    ge.match_id,
    ge.created_at,
    ge.odds_open,
    ge.odds_close,
    ge.odds_live
  FROM public.game_events ge
  WHERE ge.league_id = 'nba'
),
event_rollup AS (
  SELECT
    ne.match_id,
    COUNT(*)::bigint AS event_row_count,
    MIN(ne.created_at) AS first_event_at,
    MAX(ne.created_at) AS last_event_at,
    MAX((ne.odds_open IS NOT NULL)::int)::boolean AS has_event_open,
    MAX((ne.odds_close IS NOT NULL)::int)::boolean AS has_event_close,
    MAX((ne.odds_live IS NOT NULL)::int)::boolean AS has_event_live
  FROM nba_events ne
  GROUP BY ne.match_id
),
event_open AS (
  SELECT DISTINCT ON (ne.match_id)
    ne.match_id,
    ne.odds_open,
    ne.created_at AS odds_open_at
  FROM nba_events ne
  WHERE ne.odds_open IS NOT NULL
  ORDER BY ne.match_id, ne.created_at ASC
),
event_close AS (
  SELECT DISTINCT ON (ne.match_id)
    ne.match_id,
    ne.odds_close,
    ne.created_at AS odds_close_at
  FROM nba_events ne
  WHERE ne.odds_close IS NOT NULL
  ORDER BY ne.match_id, ne.created_at DESC
),
event_live_latest AS (
  SELECT DISTINCT ON (ne.match_id)
    ne.match_id,
    ne.odds_live,
    ne.created_at AS odds_live_at
  FROM nba_events ne
  WHERE ne.odds_live IS NOT NULL
  ORDER BY ne.match_id, ne.created_at DESC
),
event_snapshot AS (
  -- Fallback: first odds_snapshot in period 1 (DK closing line at tip-off)
  -- Normalizes nested JSON structure into flat keys matching odds_close format
  SELECT DISTINCT ON (ge.match_id)
    ge.match_id,
    jsonb_build_object(
      'total',      COALESCE(ge.odds_snapshot->'total'->>'line',
                             ge.odds_snapshot->>'total'),
      'homeSpread', COALESCE(ge.odds_snapshot->'spread'->>'line',
                             ge.odds_snapshot->>'homeSpread',
                             ge.odds_snapshot->>'home_spread'),
      'homeML',     COALESCE(ge.odds_snapshot->'moneyline'->>'home',
                             ge.odds_snapshot->>'homeML',
                             ge.odds_snapshot->>'home_ml',
                             ge.odds_snapshot->>'homeWin'),
      'awayML',     COALESCE(ge.odds_snapshot->'moneyline'->>'away',
                             ge.odds_snapshot->>'awayML',
                             ge.odds_snapshot->>'away_ml',
                             ge.odds_snapshot->>'awayWin'),
      'overUnder',  COALESCE(ge.odds_snapshot->'total'->>'line',
                             ge.odds_snapshot->>'overUnder',
                             ge.odds_snapshot->>'total'),
      'provider',   COALESCE(ge.odds_snapshot->>'provider', 'snapshot_fallback')
    ) AS odds_snapshot_flat,
    ge.created_at AS odds_snapshot_at
  FROM public.game_events ge
  WHERE ge.league_id = 'nba'
    AND ge.odds_snapshot IS NOT NULL
    AND ge.period = 1
  ORDER BY ge.match_id, ge.sequence ASC
),
base AS (
  SELECT
    m.id AS match_id,
    m.start_time,
    (m.start_time AT TIME ZONE 'UTC')::date AS game_date_utc,
    m.status,
    m.league_id,
    m.sport,
    m.home_team,
    m.away_team,
    m.home_score,
    m.away_score,
    CASE
      WHEN m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      THEN (m.home_score + m.away_score)::numeric
      ELSE NULL
    END AS total_points,
    CASE
      WHEN m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      THEN (m.home_score - m.away_score)::numeric
      ELSE NULL
    END AS home_margin,
    m.opening_odds,
    m.current_odds,
    m.closing_odds,
    COALESCE(m.opening_odds, eo.odds_open) AS opening_odds_merged,
    COALESCE(m.current_odds, el.odds_live) AS live_odds_merged,
    COALESCE(m.closing_odds, ec.odds_close, es.odds_snapshot_flat) AS closing_odds_merged,
    eo.odds_open AS opening_odds_event,
    eo.odds_open_at,
    el.odds_live AS live_odds_event,
    el.odds_live_at,
    ec.odds_close AS closing_odds_event,
    ec.odds_close_at,
    es.odds_snapshot_flat AS closing_odds_snapshot,
    es.odds_snapshot_at,
    COALESCE(er.event_row_count, 0)::bigint AS event_row_count,
    er.first_event_at,
    er.last_event_at,
    COALESCE(er.has_event_open, false) AS has_event_open,
    COALESCE(er.has_event_live, false) AS has_event_live,
    COALESCE(er.has_event_close, false) AS has_event_close
  FROM public.matches m
  LEFT JOIN event_rollup er
    ON er.match_id = m.id
  LEFT JOIN event_open eo
    ON eo.match_id = m.id
  LEFT JOIN event_live_latest el
    ON el.match_id = m.id
  LEFT JOIN event_close ec
    ON ec.match_id = m.id
  LEFT JOIN event_snapshot es
    ON es.match_id = m.id
  WHERE m.league_id = 'nba'
    AND m.id LIKE '%_nba'
),
normalized AS (
  SELECT
    b.*,
    public.jsonb_numeric_any(
      b.opening_odds_merged,
      ARRAY['homeML','home_ml','homeWin','moneylineHome','homeMoneyline']
    ) AS home_ml_open,
    public.jsonb_numeric_any(
      b.opening_odds_merged,
      ARRAY['awayML','away_ml','awayWin','moneylineAway','awayMoneyline']
    ) AS away_ml_open,
    public.jsonb_numeric_any(
      b.opening_odds_merged,
      ARRAY['homeSpread','home_spread','spread']
    ) AS home_spread_open,
    public.jsonb_numeric_any(
      b.opening_odds_merged,
      ARRAY['total','overUnder']
    ) AS total_open,
    public.jsonb_numeric_any(
      b.live_odds_merged,
      ARRAY['homeML','homeWin','moneylineHome','homeMoneyline']
    ) AS home_ml_live,
    public.jsonb_numeric_any(
      b.live_odds_merged,
      ARRAY['awayML','awayWin','moneylineAway','awayMoneyline']
    ) AS away_ml_live,
    public.jsonb_numeric_any(
      b.live_odds_merged,
      ARRAY['homeSpread','spread']
    ) AS home_spread_live,
    public.jsonb_numeric_any(
      b.live_odds_merged,
      ARRAY['total','overUnder']
    ) AS total_live,
    public.jsonb_numeric_any(
      b.closing_odds_merged,
      ARRAY['homeML','home_ml','homeWin','moneylineHome','homeMoneyline']
    ) AS home_ml_close,
    public.jsonb_numeric_any(
      b.closing_odds_merged,
      ARRAY['awayML','away_ml','awayWin','moneylineAway','awayMoneyline']
    ) AS away_ml_close,
    public.jsonb_numeric_any(
      b.closing_odds_merged,
      ARRAY['homeSpread','home_spread','spread']
    ) AS home_spread_close,
    public.jsonb_numeric_any(
      b.closing_odds_merged,
      ARRAY['total','overUnder']
    ) AS total_close
  FROM base b
)
SELECT
  n.match_id,
  n.start_time,
  n.game_date_utc,
  n.status,
  n.league_id,
  n.sport,
  n.home_team,
  n.away_team,
  n.home_score,
  n.away_score,
  n.total_points,
  n.home_margin,
  n.home_ml_open,
  n.away_ml_open,
  n.home_spread_open,
  n.total_open,
  n.home_ml_live,
  n.away_ml_live,
  n.home_spread_live,
  n.total_live,
  n.home_ml_close,
  n.away_ml_close,
  n.home_spread_close,
  n.total_close,
  CASE
    WHEN n.total_open IS NOT NULL AND n.total_close IS NOT NULL THEN n.total_close - n.total_open
    ELSE NULL
  END AS total_move_open_to_close,
  CASE
    WHEN n.home_spread_open IS NOT NULL AND n.home_spread_close IS NOT NULL THEN n.home_spread_close - n.home_spread_open
    ELSE NULL
  END AS spread_move_open_to_close,
  CASE
    WHEN n.home_ml_open IS NOT NULL AND n.home_ml_close IS NOT NULL THEN n.home_ml_close - n.home_ml_open
    ELSE NULL
  END AS home_ml_move_open_to_close,
  CASE
    WHEN n.total_close IS NOT NULL AND n.total_points IS NOT NULL THEN n.total_points - n.total_close
    ELSE NULL
  END AS total_vs_close,
  CASE
    WHEN n.home_spread_close IS NOT NULL AND n.home_margin IS NOT NULL THEN n.home_margin + n.home_spread_close
    ELSE NULL
  END AS home_spread_result_vs_close,
  CASE
    WHEN n.home_margin IS NOT NULL THEN
      CASE
        WHEN n.home_margin > 0 THEN 'HOME_WIN'
        WHEN n.home_margin < 0 THEN 'AWAY_WIN'
        ELSE 'TIE'
      END
    ELSE NULL
  END AS winner_result,
  CASE
    WHEN n.total_close IS NOT NULL AND n.total_points IS NOT NULL THEN
      CASE
        WHEN n.total_points > n.total_close THEN 'OVER'
        WHEN n.total_points < n.total_close THEN 'UNDER'
        ELSE 'PUSH'
      END
    ELSE NULL
  END AS total_result_close,
  CASE
    WHEN n.home_spread_close IS NOT NULL AND n.home_margin IS NOT NULL THEN
      CASE
        WHEN (n.home_margin + n.home_spread_close) > 0 THEN 'HOME_COVER'
        WHEN (n.home_margin + n.home_spread_close) < 0 THEN 'AWAY_COVER'
        ELSE 'PUSH'
      END
    ELSE NULL
  END AS spread_result_close,
  n.event_row_count,
  n.first_event_at,
  n.last_event_at,
  n.has_event_open,
  n.has_event_live,
  n.has_event_close,
  n.odds_open_at,
  n.odds_live_at,
  n.odds_close_at,
  n.opening_odds,
  n.current_odds,
  n.closing_odds,
  n.opening_odds_event,
  n.live_odds_event,
  n.closing_odds_event,
  (UPPER(COALESCE(n.status, '')) = 'STATUS_FINAL') AS is_final,
  (n.home_score IS NOT NULL AND n.away_score IS NOT NULL) AS has_final_score,
  (n.total_open IS NOT NULL AND n.home_spread_open IS NOT NULL AND n.home_ml_open IS NOT NULL AND n.away_ml_open IS NOT NULL) AS has_opening_core_markets,
  (n.total_close IS NOT NULL AND n.home_spread_close IS NOT NULL AND n.home_ml_close IS NOT NULL AND n.away_ml_close IS NOT NULL) AS has_closing_core_markets,
  CASE
    WHEN UPPER(COALESCE(n.status, '')) = 'STATUS_FINAL'
      AND n.home_score IS NOT NULL
      AND n.away_score IS NOT NULL
      AND n.total_open IS NOT NULL
      AND n.total_close IS NOT NULL
      AND n.home_spread_close IS NOT NULL
    THEN 'A'
    WHEN UPPER(COALESCE(n.status, '')) = 'STATUS_FINAL'
      AND n.home_score IS NOT NULL
      AND n.away_score IS NOT NULL
    THEN 'B'
    WHEN n.total_open IS NOT NULL OR n.total_close IS NOT NULL OR n.event_row_count > 0
    THEN 'C'
    ELSE 'D'
  END AS data_quality_tier
FROM normalized n;

CREATE UNIQUE INDEX mv_nba_game_master_match_uidx
  ON public.mv_nba_game_master (match_id);

CREATE INDEX mv_nba_game_master_start_idx
  ON public.mv_nba_game_master (start_time DESC);

CREATE INDEX mv_nba_game_master_quality_idx
  ON public.mv_nba_game_master (data_quality_tier, is_final);

CREATE INDEX mv_nba_game_master_home_idx
  ON public.mv_nba_game_master (home_team);

CREATE INDEX mv_nba_game_master_away_idx
  ON public.mv_nba_game_master (away_team);

CREATE MATERIALIZED VIEW public.mv_nba_team_game_master AS
SELECT
  g.match_id,
  g.start_time,
  g.game_date_utc,
  g.status,
  g.is_final,
  g.data_quality_tier,
  g.team_name,
  g.opponent_name,
  g.is_home,
  g.team_score,
  g.opponent_score,
  g.team_margin,
  g.total_points,
  g.team_ml_open,
  g.opponent_ml_open,
  g.team_spread_open,
  g.total_open,
  g.team_ml_live,
  g.opponent_ml_live,
  g.team_spread_live,
  g.total_live,
  g.team_ml_close,
  g.opponent_ml_close,
  g.team_spread_close,
  g.total_close,
  CASE
    WHEN g.total_open IS NOT NULL AND g.total_close IS NOT NULL THEN g.total_close - g.total_open
    ELSE NULL
  END AS total_move_open_to_close,
  CASE
    WHEN g.team_spread_open IS NOT NULL AND g.team_spread_close IS NOT NULL THEN g.team_spread_close - g.team_spread_open
    ELSE NULL
  END AS spread_move_open_to_close,
  CASE
    WHEN g.team_ml_open IS NOT NULL AND g.team_ml_close IS NOT NULL THEN g.team_ml_close - g.team_ml_open
    ELSE NULL
  END AS team_ml_move_open_to_close,
  CASE
    WHEN g.total_close IS NOT NULL AND g.total_points IS NOT NULL THEN g.total_points - g.total_close
    ELSE NULL
  END AS total_vs_close,
  CASE
    WHEN g.team_spread_close IS NOT NULL AND g.team_margin IS NOT NULL THEN g.team_margin + g.team_spread_close
    ELSE NULL
  END AS spread_result_vs_close,
  CASE
    WHEN g.team_margin IS NOT NULL THEN
      CASE
        WHEN g.team_margin > 0 THEN 'WIN'
        WHEN g.team_margin < 0 THEN 'LOSS'
        ELSE 'TIE'
      END
    ELSE NULL
  END AS team_result,
  CASE
    WHEN g.total_close IS NOT NULL AND g.total_points IS NOT NULL THEN
      CASE
        WHEN g.total_points > g.total_close THEN 'OVER'
        WHEN g.total_points < g.total_close THEN 'UNDER'
        ELSE 'PUSH'
      END
    ELSE NULL
  END AS total_result_close,
  CASE
    WHEN g.team_spread_close IS NOT NULL AND g.team_margin IS NOT NULL THEN
      CASE
        WHEN (g.team_margin + g.team_spread_close) > 0 THEN 'COVER'
        WHEN (g.team_margin + g.team_spread_close) < 0 THEN 'NO_COVER'
        ELSE 'PUSH'
      END
    ELSE NULL
  END AS spread_result_close,
  g.event_row_count,
  g.first_event_at,
  g.last_event_at,
  g.has_event_open,
  g.has_event_live,
  g.has_event_close
FROM (
  SELECT
    mgm.match_id,
    mgm.start_time,
    mgm.game_date_utc,
    mgm.status,
    mgm.is_final,
    mgm.data_quality_tier,
    mgm.home_team AS team_name,
    mgm.away_team AS opponent_name,
    true AS is_home,
    mgm.home_score AS team_score,
    mgm.away_score AS opponent_score,
    mgm.home_margin AS team_margin,
    mgm.total_points,
    mgm.home_ml_open AS team_ml_open,
    mgm.away_ml_open AS opponent_ml_open,
    mgm.home_spread_open AS team_spread_open,
    mgm.total_open,
    mgm.home_ml_live AS team_ml_live,
    mgm.away_ml_live AS opponent_ml_live,
    mgm.home_spread_live AS team_spread_live,
    mgm.total_live,
    mgm.home_ml_close AS team_ml_close,
    mgm.away_ml_close AS opponent_ml_close,
    mgm.home_spread_close AS team_spread_close,
    mgm.total_close,
    mgm.event_row_count,
    mgm.first_event_at,
    mgm.last_event_at,
    mgm.has_event_open,
    mgm.has_event_live,
    mgm.has_event_close
  FROM public.mv_nba_game_master mgm
  UNION ALL
  SELECT
    mgm.match_id,
    mgm.start_time,
    mgm.game_date_utc,
    mgm.status,
    mgm.is_final,
    mgm.data_quality_tier,
    mgm.away_team AS team_name,
    mgm.home_team AS opponent_name,
    false AS is_home,
    mgm.away_score AS team_score,
    mgm.home_score AS opponent_score,
    CASE
      WHEN mgm.home_margin IS NOT NULL THEN -mgm.home_margin
      ELSE NULL
    END AS team_margin,
    mgm.total_points,
    mgm.away_ml_open AS team_ml_open,
    mgm.home_ml_open AS opponent_ml_open,
    CASE
      WHEN mgm.home_spread_open IS NOT NULL THEN -mgm.home_spread_open
      ELSE NULL
    END AS team_spread_open,
    mgm.total_open,
    mgm.away_ml_live AS team_ml_live,
    mgm.home_ml_live AS opponent_ml_live,
    CASE
      WHEN mgm.home_spread_live IS NOT NULL THEN -mgm.home_spread_live
      ELSE NULL
    END AS team_spread_live,
    mgm.total_live,
    mgm.away_ml_close AS team_ml_close,
    mgm.home_ml_close AS opponent_ml_close,
    CASE
      WHEN mgm.home_spread_close IS NOT NULL THEN -mgm.home_spread_close
      ELSE NULL
    END AS team_spread_close,
    mgm.total_close,
    mgm.event_row_count,
    mgm.first_event_at,
    mgm.last_event_at,
    mgm.has_event_open,
    mgm.has_event_live,
    mgm.has_event_close
  FROM public.mv_nba_game_master mgm
) g;

CREATE UNIQUE INDEX mv_nba_team_game_master_uidx
  ON public.mv_nba_team_game_master (match_id, team_name);

CREATE INDEX mv_nba_team_game_master_team_start_idx
  ON public.mv_nba_team_game_master (team_name, start_time DESC);

CREATE INDEX mv_nba_team_game_master_opponent_start_idx
  ON public.mv_nba_team_game_master (opponent_name, start_time DESC);

CREATE INDEX mv_nba_team_game_master_quality_idx
  ON public.mv_nba_team_game_master (data_quality_tier, is_final, team_name);

CREATE OR REPLACE FUNCTION public.refresh_nba_master_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_nba_game_master;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_nba_team_game_master;
END;
$$;

GRANT SELECT ON public.mv_nba_game_master TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_nba_team_game_master TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_nba_master_views() TO service_role;

COMMENT ON MATERIALIZED VIEW public.mv_nba_game_master IS
'Canonical NBA game-level master view: one row per game with normalized opening/live/closing market fields, results, and quality tiers.';

COMMENT ON MATERIALIZED VIEW public.mv_nba_team_game_master IS
'Canonical NBA team-level master view: two rows per game (home + away perspective) derived from mv_nba_game_master.';

COMMENT ON FUNCTION public.refresh_nba_master_views() IS
'Refreshes mv_nba_game_master and mv_nba_team_game_master concurrently.';
