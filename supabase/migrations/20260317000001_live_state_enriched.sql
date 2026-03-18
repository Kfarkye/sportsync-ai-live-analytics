-- NBA live_state_enriched
-- Phase 1 causal-state layer built from live_context_snapshots + matches + live_game_state + game_events.

CREATE OR REPLACE FUNCTION public.safe_to_numeric(p_text text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_text IS NULL THEN NULL
    ELSE NULLIF(REGEXP_REPLACE(p_text, '[^0-9+\.-]', '', 'g'), '')::numeric
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_probability(p_value numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN p_value > 1 THEN p_value / 100.0
    ELSE p_value
  END;
$$;

CREATE OR REPLACE FUNCTION public.american_implied_probability(p_odds numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_odds IS NULL OR p_odds = 0 THEN NULL
    WHEN p_odds > 0 THEN 100.0 / (p_odds + 100.0)
    ELSE ABS(p_odds) / (ABS(p_odds) + 100.0)
  END;
$$;

CREATE OR REPLACE FUNCTION public.devig_home_probability(p_home_odds numeric, p_away_odds numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH probs AS (
    SELECT
      public.american_implied_probability(p_home_odds) AS home_prob,
      public.american_implied_probability(p_away_odds) AS away_prob
  )
  SELECT CASE
    WHEN home_prob IS NULL OR away_prob IS NULL OR (home_prob + away_prob) = 0 THEN NULL
    ELSE home_prob / (home_prob + away_prob)
  END
  FROM probs;
$$;

CREATE OR REPLACE FUNCTION public.nba_clock_to_seconds(p_clock text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cleaned text;
  mins numeric;
  secs numeric;
BEGIN
  IF p_clock IS NULL OR BTRIM(p_clock) = '' THEN
    RETURN NULL;
  END IF;

  cleaned := REGEXP_REPLACE(BTRIM(p_clock), '[^0-9:\.]', '', 'g');
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  IF POSITION(':' IN cleaned) > 0 THEN
    mins := NULLIF(SPLIT_PART(cleaned, ':', 1), '')::numeric;
    secs := NULLIF(SPLIT_PART(cleaned, ':', 2), '')::numeric;
    RETURN COALESCE(mins, 0) * 60 + COALESCE(secs, 0);
  END IF;

  RETURN cleaned::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public.nba_remaining_minutes(p_period integer, p_clock text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_period IS NULL OR p_period <= 0 THEN NULL
    WHEN p_period <= 4 THEN ((4 - p_period) * 12) + (public.nba_clock_to_seconds(p_clock) / 60.0)
    ELSE public.nba_clock_to_seconds(p_clock) / 60.0
  END;
$$;

CREATE OR REPLACE FUNCTION public.extract_snapshot_stat_numeric(
  p_stats jsonb,
  p_label text,
  p_side text
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_stats IS NULL OR jsonb_typeof(p_stats) <> 'array' THEN NULL
    ELSE (
      SELECT public.safe_to_numeric(
        CASE
          WHEN UPPER(p_side) = 'HOME' THEN elem->>'homeValue'
          ELSE elem->>'awayValue'
        END
      )
      FROM jsonb_array_elements(p_stats) AS elem
      WHERE LOWER(elem->>'label') = LOWER(p_label)
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.extract_snapshot_stat_pair_piece(
  p_stats jsonb,
  p_label text,
  p_side text,
  p_piece integer
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_stats IS NULL OR jsonb_typeof(p_stats) <> 'array' THEN NULL
    ELSE (
      SELECT public.safe_to_numeric(
        SPLIT_PART(
          CASE
            WHEN UPPER(p_side) = 'HOME' THEN COALESCE(elem->>'homeValue', '')
            ELSE COALESCE(elem->>'awayValue', '')
          END,
          '-',
          p_piece
        )
      )
      FROM jsonb_array_elements(p_stats) AS elem
      WHERE LOWER(elem->>'label') = LOWER(p_label)
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_entity_id(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR BTRIM(p_value) = '' THEN NULL
    ELSE REGEXP_REPLACE(BTRIM(p_value), '(_[A-Za-z0-9]+)$', '')
  END;
$$;

CREATE OR REPLACE FUNCTION public.parse_spread_magnitude(p_text text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_text IS NULL OR BTRIM(p_text) = '' THEN NULL
    WHEN REGEXP_MATCH(BTRIM(p_text), '(-?[0-9]+(?:\.[0-9]+)?)(?!.*-?[0-9])') IS NULL THEN public.safe_to_numeric(p_text)
    ELSE ABS(((REGEXP_MATCH(BTRIM(p_text), '(-?[0-9]+(?:\.[0-9]+)?)(?!.*-?[0-9])'))[1])::numeric)
  END;
$$;

CREATE OR REPLACE FUNCTION public.nba_elapsed_minutes(p_period integer, p_clock text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_period IS NULL OR p_period <= 0 THEN NULL
    WHEN p_period <= 4 THEN ((p_period - 1) * 12) + (12 - (public.nba_clock_to_seconds(p_clock) / 60.0))
    ELSE 48 + ((p_period - 5) * 5) + (5 - (public.nba_clock_to_seconds(p_clock) / 60.0))
  END;
$$;

CREATE OR REPLACE FUNCTION public.nba_observed_team_possessions(p_stats jsonb, p_side text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.extract_snapshot_stat_pair_piece(p_stats, 'FG', p_side, 2) IS NULL THEN NULL
    ELSE public.extract_snapshot_stat_pair_piece(p_stats, 'FG', p_side, 2)
      + (0.44 * COALESCE(public.extract_snapshot_stat_pair_piece(p_stats, 'FT', p_side, 2), 0))
      - COALESCE(public.extract_snapshot_stat_numeric(p_stats, 'Offensive Rebounds', p_side), 0)
      + COALESCE(
          public.extract_snapshot_stat_numeric(p_stats, 'Total Turnovers', p_side),
          public.extract_snapshot_stat_numeric(p_stats, 'Turnovers', p_side),
          public.extract_snapshot_stat_numeric(p_stats, 'Team Turnovers', p_side),
          0
        )
  END;
$$;

CREATE OR REPLACE FUNCTION public.nba_observed_possessions(p_stats jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH poss AS (
    SELECT
      public.nba_observed_team_possessions(p_stats, 'HOME') AS home_poss,
      public.nba_observed_team_possessions(p_stats, 'AWAY') AS away_poss
  )
  SELECT CASE
    WHEN home_poss IS NULL AND away_poss IS NULL THEN NULL
    WHEN home_poss IS NULL THEN away_poss
    WHEN away_poss IS NULL THEN home_poss
    ELSE (home_poss + away_poss) / 2.0
  END
  FROM poss;
$$;

CREATE OR REPLACE FUNCTION public.nba_observed_pace_48(p_stats jsonb, p_period integer, p_clock text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.nba_observed_possessions(p_stats) IS NULL
      OR public.nba_elapsed_minutes(p_period, p_clock) IS NULL
      OR public.nba_elapsed_minutes(p_period, p_clock) = 0
    THEN NULL
    ELSE (public.nba_observed_possessions(p_stats) / public.nba_elapsed_minutes(p_period, p_clock)) * 48.0
  END;
$$;

CREATE OR REPLACE FUNCTION public.nba_intentional_foul_likelihood_class(
  p_period integer,
  p_remaining_minutes numeric,
  p_score_diff integer,
  p_home_fouls_to_give integer,
  p_away_fouls_to_give integer,
  p_home_timeouts integer,
  p_away_timeouts integer
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  abs_diff integer := ABS(COALESCE(p_score_diff, 0));
  trailing_side text;
  trailing_fouls_to_give integer;
  trailing_timeouts integer;
BEGIN
  IF COALESCE(p_period, 0) < 4 OR p_remaining_minutes IS NULL OR p_remaining_minutes > 3.0 THEN
    RETURN 'NONE';
  END IF;

  IF abs_diff < 3 OR abs_diff > 10 THEN
    RETURN 'NONE';
  END IF;

  trailing_side := CASE
    WHEN COALESCE(p_score_diff, 0) > 0 THEN 'AWAY'
    WHEN COALESCE(p_score_diff, 0) < 0 THEN 'HOME'
    ELSE NULL
  END;

  IF trailing_side IS NULL THEN
    RETURN 'NONE';
  END IF;

  trailing_fouls_to_give := CASE WHEN trailing_side = 'HOME' THEN p_home_fouls_to_give ELSE p_away_fouls_to_give END;
  trailing_timeouts := CASE WHEN trailing_side = 'HOME' THEN p_home_timeouts ELSE p_away_timeouts END;

  IF COALESCE(trailing_fouls_to_give, 99) = 0
    AND COALESCE(trailing_timeouts, 0) > 0
    AND p_remaining_minutes <= 1.75
    AND abs_diff BETWEEN 4 AND 8
  THEN
    RETURN 'HIGH';
  END IF;

  IF COALESCE(trailing_fouls_to_give, 99) <= 1
    AND p_remaining_minutes <= 2.5
    AND abs_diff BETWEEN 4 AND 9
  THEN
    RETURN 'MEDIUM';
  END IF;

  IF COALESCE(trailing_fouls_to_give, 99) <= 1
    AND p_remaining_minutes <= 3.0
    AND abs_diff BETWEEN 3 AND 10
  THEN
    RETURN 'LOW';
  END IF;

  RETURN 'NONE';
END;
$$;

CREATE OR REPLACE FUNCTION public.nba_game_script_class(
  p_period integer,
  p_remaining_minutes numeric,
  p_score_diff integer,
  p_possession_side text,
  p_home_bonus_state text,
  p_away_bonus_state text,
  p_home_timeouts integer,
  p_away_timeouts integer,
  p_intentional_foul_likelihood_class text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  abs_diff integer := ABS(COALESCE(p_score_diff, 0));
  trailing_side text := CASE
    WHEN COALESCE(p_score_diff, 0) > 0 THEN 'AWAY'
    WHEN COALESCE(p_score_diff, 0) < 0 THEN 'HOME'
    ELSE NULL
  END;
BEGIN
  IF COALESCE(p_period, 0) < 4 OR p_remaining_minutes IS NULL OR p_remaining_minutes > 4.0 THEN
    RETURN 'NORMAL_FLOW';
  END IF;

  IF COALESCE(p_intentional_foul_likelihood_class, 'NONE') IN ('HIGH', 'MEDIUM') THEN
    RETURN 'INTENTIONAL_FOUL_WINDOW';
  END IF;

  IF p_remaining_minutes <= 0.35 AND abs_diff <= 1 THEN
    RETURN 'LAST_SHOT';
  END IF;

  IF p_remaining_minutes <= 0.75 AND abs_diff <= 3 AND p_possession_side IS NOT NULL AND trailing_side IS NOT NULL AND p_possession_side = trailing_side THEN
    RETURN 'ONE_POSSESSION_CHASE';
  END IF;

  IF p_remaining_minutes <= 1.25 AND abs_diff <= 3 AND p_possession_side IS NOT NULL AND trailing_side IS NOT NULL AND p_possession_side <> trailing_side THEN
    RETURN 'LEADER_CONTROL';
  END IF;

  IF p_remaining_minutes <= 4.0 AND COALESCE(p_home_bonus_state, 'NONE') <> 'NONE' AND COALESCE(p_away_bonus_state, 'NONE') <> 'NONE' THEN
    RETURN 'DOUBLE_BONUS_ACCELERATION';
  END IF;

  IF p_remaining_minutes <= 2.5 AND abs_diff >= 10 THEN
    RETURN 'CLOCK_BURN';
  END IF;

  IF COALESCE(p_home_timeouts, 0) + COALESCE(p_away_timeouts, 0) <= 2 AND p_remaining_minutes <= 1.5 AND abs_diff <= 6 THEN
    RETURN 'LOW_TIMEOUT_ENDGAME';
  END IF;

  RETURN 'LATE_STANDARD';
END;
$$;

CREATE OR REPLACE FUNCTION public.nba_remaining_possessions_v2(
  p_stats jsonb,
  p_period integer,
  p_clock text,
  p_feed_pace numeric,
  p_score_diff integer,
  p_home_fouls_to_give integer,
  p_away_fouls_to_give integer,
  p_home_timeouts integer,
  p_away_timeouts integer,
  p_home_bonus_state text,
  p_away_bonus_state text,
  p_possession_side text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  remaining_minutes numeric := public.nba_remaining_minutes(p_period, p_clock);
  elapsed_minutes numeric := public.nba_elapsed_minutes(p_period, p_clock);
  observed_pace numeric := public.nba_observed_pace_48(p_stats, p_period, p_clock);
  blend_weight numeric := CASE
    WHEN elapsed_minutes IS NULL THEN 0.35
    ELSE LEAST(0.8, GREATEST(0.2, elapsed_minutes / 36.0))
  END;
  blended_pace numeric;
  intentional_class text := public.nba_intentional_foul_likelihood_class(
    p_period,
    remaining_minutes,
    p_score_diff,
    p_home_fouls_to_give,
    p_away_fouls_to_give,
    p_home_timeouts,
    p_away_timeouts
  );
  game_script text := public.nba_game_script_class(
    p_period,
    remaining_minutes,
    p_score_diff,
    p_possession_side,
    p_home_bonus_state,
    p_away_bonus_state,
    p_home_timeouts,
    p_away_timeouts,
    intentional_class
  );
  multiplier numeric := 1;
BEGIN
  IF remaining_minutes IS NULL THEN
    RETURN NULL;
  END IF;

  blended_pace := CASE
    WHEN observed_pace IS NOT NULL AND p_feed_pace IS NOT NULL THEN (observed_pace * blend_weight) + (p_feed_pace * (1 - blend_weight))
    WHEN observed_pace IS NOT NULL THEN observed_pace
    ELSE p_feed_pace
  END;

  IF blended_pace IS NULL THEN
    RETURN NULL;
  END IF;

  multiplier := CASE
    WHEN intentional_class = 'HIGH' THEN 1.18
    WHEN intentional_class = 'MEDIUM' THEN 1.10
    WHEN intentional_class = 'LOW' THEN 1.04
    WHEN game_script = 'DOUBLE_BONUS_ACCELERATION' THEN 1.06
    WHEN game_script IN ('LAST_SHOT', 'CLOCK_BURN', 'LEADER_CONTROL') THEN 0.90
    ELSE 1
  END;

  RETURN (blended_pace * remaining_minutes * multiplier) / 48.0;
END;
$$;

CREATE OR REPLACE FUNCTION public.derive_nba_possession(
  p_recent_plays jsonb,
  p_home_team_id text,
  p_away_team_id text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  rec record;
  normalized_team_id text;
  normalized_home_team_id text := public.normalize_entity_id(p_home_team_id);
  normalized_away_team_id text := public.normalize_entity_id(p_away_team_id);
  team_side text;
  normalized text;
BEGIN
  IF p_recent_plays IS NULL OR jsonb_typeof(p_recent_plays) <> 'array' THEN
    RETURN jsonb_build_object('side', NULL, 'confidence', 'NONE', 'source', NULL);
  END IF;

  FOR rec IN
    SELECT value
    FROM jsonb_array_elements(p_recent_plays) WITH ORDINALITY AS plays(value, ordinality)
    ORDER BY ordinality DESC
  LOOP
    IF rec.value->>'teamId' IS NULL THEN
      CONTINUE;
    END IF;

    normalized_team_id := public.normalize_entity_id(rec.value->>'teamId');

    team_side := CASE
      WHEN normalized_team_id = normalized_home_team_id THEN 'HOME'
      WHEN normalized_team_id = normalized_away_team_id THEN 'AWAY'
      ELSE NULL
    END;

    IF team_side IS NULL THEN
      CONTINUE;
    END IF;

    normalized := LOWER(COALESCE(rec.value->>'type', '') || ' ' || COALESCE(rec.value->>'text', ''));

    IF normalized ~ 'turnover|travel|bad pass|shot clock turnover|offensive foul' THEN
      RETURN jsonb_build_object(
        'side',
        CASE WHEN team_side = 'HOME' THEN 'AWAY' ELSE 'HOME' END,
        'confidence',
        'HIGH',
        'source',
        'recent_play_turnover'
      );
    ELSIF normalized ~ 'defensive rebound|offensive rebound|steal|gains possession' THEN
      RETURN jsonb_build_object(
        'side',
        team_side,
        'confidence',
        'HIGH',
        'source',
        'recent_play_change'
      );
    ELSIF normalized ~ 'jump ball' THEN
      RETURN jsonb_build_object(
        'side',
        team_side,
        'confidence',
        'MEDIUM',
        'source',
        'recent_play_jump_ball'
      );
    ELSIF normalized ~ 'timeout' THEN
      RETURN jsonb_build_object(
        'side',
        team_side,
        'confidence',
        'MEDIUM',
        'source',
        'recent_play_timeout'
      );
    ELSIF normalized ~ 'makes .*free throw 2 of 2|makes .*free throw 3 of 3|makes .*jumper|makes .*layup|makes .*dunk|makes .*three point|made shot' THEN
      RETURN jsonb_build_object(
        'side',
        CASE WHEN team_side = 'HOME' THEN 'AWAY' ELSE 'HOME' END,
        'confidence',
        'LOW',
        'source',
        'recent_play_make'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('side', NULL, 'confidence', 'NONE', 'source', NULL);
END;
$$;

CREATE TABLE IF NOT EXISTS public.live_state_enriched (
  id bigserial PRIMARY KEY,
  source_snapshot_id bigint NOT NULL UNIQUE,
  match_id text NOT NULL,
  league_id text NOT NULL,
  sport text NOT NULL,
  captured_at timestamptz NOT NULL,
  period integer,
  clock text,
  clock_seconds numeric,
  minute_bucket integer,
  remaining_minutes numeric,
  home_score integer,
  away_score integer,
  score_diff integer,
  total_points integer,
  home_team text,
  away_team text,
  home_team_id text,
  away_team_id text,
  pregame_home_wp numeric,
  pregame_away_wp numeric,
  current_bpi_home_wp numeric,
  current_bpi_away_wp numeric,
  bpi_predicted_margin numeric,
  opening_home_ml numeric,
  opening_away_ml numeric,
  opening_home_spread numeric,
  opening_away_spread numeric,
  opening_total numeric,
  t60_home_ml numeric,
  t60_away_ml numeric,
  t60_home_spread numeric,
  t60_away_spread numeric,
  t60_total numeric,
  t0_home_ml numeric,
  t0_away_ml numeric,
  t0_home_spread numeric,
  t0_away_spread numeric,
  t0_total numeric,
  live_home_ml numeric,
  live_away_ml numeric,
  live_home_spread numeric,
  live_away_spread numeric,
  live_total numeric,
  live_home_implied_prob numeric,
  live_away_implied_prob numeric,
  live_home_devig_prob numeric,
  current_bpi_market_gap numeric,
  pregame_market_gap numeric,
  opening_home_devig_prob numeric,
  pregame_anchor_home_prob numeric,
  pregame_favorite_side text,
  pregame_favorite_prob numeric,
  pregame_model_market_delta numeric,
  pregame_total_anchor numeric,
  opening_spread_abs numeric,
  home_timeouts_remaining integer,
  away_timeouts_remaining integer,
  home_team_fouls integer,
  away_team_fouls integer,
  home_fouls_to_give integer,
  away_fouls_to_give integer,
  home_bonus_state text,
  away_bonus_state text,
  derived_possession_side text,
  derived_possession_confidence text,
  derived_possession_source text,
  trailing_side text,
  foul_extension_flag boolean DEFAULT false,
  pace_live numeric,
  remaining_possessions_est numeric,
  observed_pace_48 numeric,
  home_observed_possessions_est numeric,
  away_observed_possessions_est numeric,
  observed_possessions_est numeric,
  remaining_possessions_est_v2 numeric,
  remaining_possessions_delta numeric,
  game_script_class text,
  intentional_foul_likelihood_class text,
  home_fg_attempts numeric,
  away_fg_attempts numeric,
  home_three_attempts numeric,
  away_three_attempts numeric,
  home_ft_attempts numeric,
  away_ft_attempts numeric,
  home_three_rate numeric,
  away_three_rate numeric,
  home_free_throw_rate numeric,
  away_free_throw_rate numeric,
  home_points_in_paint numeric,
  away_points_in_paint numeric,
  home_fast_break_points numeric,
  away_fast_break_points numeric,
  home_paint_share numeric,
  away_paint_share numeric,
  official_crew_key text,
  official_count integer,
  feature_source jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_state_enriched_match_time
  ON public.live_state_enriched (match_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_state_enriched_league_time
  ON public.live_state_enriched (league_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_state_enriched_gap
  ON public.live_state_enriched (current_bpi_market_gap);

CREATE INDEX IF NOT EXISTS idx_live_context_snapshots_nba_match_time
  ON public.live_context_snapshots (match_id, captured_at DESC)
  WHERE league_id = 'nba';

CREATE INDEX IF NOT EXISTS idx_game_events_bpi_state_lookup
  ON public.game_events (match_id, period, clock, created_at DESC)
  WHERE event_type = 'bpi_probability';

ALTER TABLE public.live_state_enriched ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read live_state_enriched" ON public.live_state_enriched;
CREATE POLICY "Public read live_state_enriched"
ON public.live_state_enriched
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Service role full access live_state_enriched" ON public.live_state_enriched;
CREATE POLICY "Service role full access live_state_enriched"
ON public.live_state_enriched
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.refresh_live_state_enriched_nba(
  p_match_id text DEFAULT NULL,
  p_since timestamptz DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  INSERT INTO public.live_state_enriched (
    source_snapshot_id,
    match_id,
    league_id,
    sport,
    captured_at,
    period,
    clock,
    clock_seconds,
    minute_bucket,
    remaining_minutes,
    home_score,
    away_score,
    score_diff,
    total_points,
    home_team,
    away_team,
    home_team_id,
    away_team_id,
    pregame_home_wp,
    pregame_away_wp,
    current_bpi_home_wp,
    current_bpi_away_wp,
    bpi_predicted_margin,
    opening_home_ml,
    opening_away_ml,
    opening_home_spread,
    opening_away_spread,
    opening_total,
    t60_home_ml,
    t60_away_ml,
    t60_home_spread,
    t60_away_spread,
    t60_total,
    t0_home_ml,
    t0_away_ml,
    t0_home_spread,
    t0_away_spread,
    t0_total,
    live_home_ml,
    live_away_ml,
    live_home_spread,
    live_away_spread,
    live_total,
    live_home_implied_prob,
    live_away_implied_prob,
    live_home_devig_prob,
    current_bpi_market_gap,
    pregame_market_gap,
    opening_home_devig_prob,
    pregame_anchor_home_prob,
    pregame_favorite_side,
    pregame_favorite_prob,
    pregame_model_market_delta,
    pregame_total_anchor,
    opening_spread_abs,
    home_timeouts_remaining,
    away_timeouts_remaining,
    home_team_fouls,
    away_team_fouls,
    home_fouls_to_give,
    away_fouls_to_give,
    home_bonus_state,
    away_bonus_state,
    derived_possession_side,
    derived_possession_confidence,
    derived_possession_source,
    trailing_side,
    foul_extension_flag,
    pace_live,
    remaining_possessions_est,
    observed_pace_48,
    home_observed_possessions_est,
    away_observed_possessions_est,
    observed_possessions_est,
    remaining_possessions_est_v2,
    remaining_possessions_delta,
    game_script_class,
    intentional_foul_likelihood_class,
    home_fg_attempts,
    away_fg_attempts,
    home_three_attempts,
    away_three_attempts,
    home_ft_attempts,
    away_ft_attempts,
    home_three_rate,
    away_three_rate,
    home_free_throw_rate,
    away_free_throw_rate,
    home_points_in_paint,
    away_points_in_paint,
    home_fast_break_points,
    away_fast_break_points,
    home_paint_share,
    away_paint_share,
    official_crew_key,
    official_count,
    feature_source,
    updated_at
  )
  WITH base AS (
    SELECT
      lcs.id AS source_snapshot_id,
      lcs.match_id,
      lcs.league_id,
      lcs.sport,
      lcs.captured_at,
      lcs.period,
      lcs.clock,
      lcs.home_score,
      lcs.away_score,
      COALESCE(lcs.situation, lgs.situation) AS situation,
      COALESCE(lcs.stats, lgs.stats) AS stats,
      COALESCE(lcs.recent_plays, lgs.recent_plays) AS recent_plays,
      COALESCE(lcs.predictor, lgs.predictor) AS predictor,
      COALESCE(lcs.advanced_metrics, lgs.advanced_metrics) AS advanced_metrics,
      COALESCE(lcs.odds_current, lgs.odds->'current') AS odds_current,
      lgs.odds->'t60_snapshot'->'odds' AS t60_odds,
      lgs.odds->'t0_snapshot'->'odds' AS t0_odds,
      m.home_team,
      m.away_team,
      m.home_team_id,
      m.away_team_id,
      m.opening_odds,
      bpi.play_data AS bpi_play_data,
      crew.official_crew_key,
      crew.official_count,
      public.derive_nba_possession(COALESCE(lcs.recent_plays, lgs.recent_plays), m.home_team_id, m.away_team_id) AS possession_meta
    FROM public.live_context_snapshots lcs
    JOIN public.matches m
      ON m.id = lcs.match_id
    LEFT JOIN public.live_game_state lgs
      ON lgs.id = lcs.match_id
    LEFT JOIN LATERAL (
      SELECT ge.play_data
      FROM public.game_events ge
      WHERE ge.match_id = lcs.match_id
        AND ge.event_type = 'bpi_probability'
        AND (
          (COALESCE(ge.period, -1) = COALESCE(lcs.period, -1) AND COALESCE(ge.clock, '') = COALESCE(lcs.clock, ''))
          OR ge.created_at <= lcs.captured_at
        )
      ORDER BY
        CASE
          WHEN COALESCE(ge.period, -1) = COALESCE(lcs.period, -1) AND COALESCE(ge.clock, '') = COALESCE(lcs.clock, '')
            THEN 0
          ELSE 1
        END,
        ge.created_at DESC
      LIMIT 1
    ) bpi ON true
    LEFT JOIN LATERAL (
      SELECT
        STRING_AGG(go.official_name, ' | ' ORDER BY go.official_name) AS official_crew_key,
        COUNT(*)::integer AS official_count
      FROM public.game_officials go
      WHERE go.match_id = lcs.match_id
        AND go.league_id = 'nba'
    ) crew ON true
    WHERE lcs.league_id = 'nba'
      AND (p_match_id IS NULL OR lcs.match_id = p_match_id)
      AND (p_since IS NULL OR lcs.captured_at >= p_since)
  )
  SELECT
    base.source_snapshot_id,
    base.match_id,
    base.league_id,
    base.sport,
    base.captured_at,
    base.period,
    base.clock,
    public.nba_clock_to_seconds(base.clock) AS clock_seconds,
    CASE
      WHEN public.nba_clock_to_seconds(base.clock) IS NULL THEN NULL
      ELSE FLOOR(public.nba_clock_to_seconds(base.clock) / 60.0)::integer
    END AS minute_bucket,
    public.nba_remaining_minutes(base.period, base.clock) AS remaining_minutes,
    base.home_score,
    base.away_score,
    COALESCE(base.home_score, 0) - COALESCE(base.away_score, 0) AS score_diff,
    COALESCE(base.home_score, 0) + COALESCE(base.away_score, 0) AS total_points,
    base.home_team,
    base.away_team,
    base.home_team_id,
    base.away_team_id,
    COALESCE(
      public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'bpiPregameWinPct')),
      public.normalize_probability(public.safe_to_numeric(base.predictor->>'homeTeamChance'))
    ) AS pregame_home_wp,
    COALESCE(
      public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'bpiAwayPregameWinPct')),
      public.normalize_probability(public.safe_to_numeric(base.predictor->>'awayTeamChance'))
    ) AS pregame_away_wp,
    public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'homeWinPct')) AS current_bpi_home_wp,
    public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'awayWinPct')) AS current_bpi_away_wp,
    public.safe_to_numeric(base.bpi_play_data->>'bpiPredictedMov') AS bpi_predicted_margin,
    COALESCE(
      public.safe_to_numeric(base.opening_odds->>'homeWin'),
      public.safe_to_numeric(base.opening_odds->>'home_ml')
    ) AS opening_home_ml,
    COALESCE(
      public.safe_to_numeric(base.opening_odds->>'awayWin'),
      public.safe_to_numeric(base.opening_odds->>'away_ml')
    ) AS opening_away_ml,
    public.safe_to_numeric(base.opening_odds->>'homeSpread') AS opening_home_spread,
    public.safe_to_numeric(base.opening_odds->>'awaySpread') AS opening_away_spread,
    COALESCE(
      public.safe_to_numeric(base.opening_odds->>'total'),
      public.safe_to_numeric(base.opening_odds->>'overUnder')
    ) AS opening_total,
    COALESCE(
      public.safe_to_numeric(base.t60_odds->>'homeML'),
      public.safe_to_numeric(base.t60_odds->>'home_ml'),
      public.safe_to_numeric(base.t60_odds->>'homeWin')
    ) AS t60_home_ml,
    COALESCE(
      public.safe_to_numeric(base.t60_odds->>'awayML'),
      public.safe_to_numeric(base.t60_odds->>'away_ml'),
      public.safe_to_numeric(base.t60_odds->>'awayWin')
    ) AS t60_away_ml,
    COALESCE(
      public.safe_to_numeric(base.t60_odds->>'homeSpread'),
      public.safe_to_numeric(base.t60_odds->>'spread_home_value')
    ) AS t60_home_spread,
    COALESCE(
      public.safe_to_numeric(base.t60_odds->>'awaySpread'),
      public.safe_to_numeric(base.t60_odds->>'spread_away_value')
    ) AS t60_away_spread,
    COALESCE(
      public.safe_to_numeric(base.t60_odds->>'total'),
      public.safe_to_numeric(base.t60_odds->>'total_value')
    ) AS t60_total,
    COALESCE(
      public.safe_to_numeric(base.t0_odds->>'homeML'),
      public.safe_to_numeric(base.t0_odds->>'home_ml'),
      public.safe_to_numeric(base.t0_odds->>'homeWin')
    ) AS t0_home_ml,
    COALESCE(
      public.safe_to_numeric(base.t0_odds->>'awayML'),
      public.safe_to_numeric(base.t0_odds->>'away_ml'),
      public.safe_to_numeric(base.t0_odds->>'awayWin')
    ) AS t0_away_ml,
    COALESCE(
      public.safe_to_numeric(base.t0_odds->>'homeSpread'),
      public.safe_to_numeric(base.t0_odds->>'spread_home_value')
    ) AS t0_home_spread,
    COALESCE(
      public.safe_to_numeric(base.t0_odds->>'awaySpread'),
      public.safe_to_numeric(base.t0_odds->>'spread_away_value')
    ) AS t0_away_spread,
    COALESCE(
      public.safe_to_numeric(base.t0_odds->>'total'),
      public.safe_to_numeric(base.t0_odds->>'total_value')
    ) AS t0_total,
    COALESCE(
      public.safe_to_numeric(base.odds_current->>'homeML'),
      public.safe_to_numeric(base.odds_current->>'home_ml')
    ) AS live_home_ml,
    COALESCE(
      public.safe_to_numeric(base.odds_current->>'awayML'),
      public.safe_to_numeric(base.odds_current->>'away_ml')
    ) AS live_away_ml,
    COALESCE(
      public.safe_to_numeric(base.odds_current->>'homeSpread'),
      public.safe_to_numeric(base.odds_current->>'spread_home_value')
    ) AS live_home_spread,
    COALESCE(
      public.safe_to_numeric(base.odds_current->>'awaySpread'),
      public.safe_to_numeric(base.odds_current->>'spread_away_value')
    ) AS live_away_spread,
    COALESCE(
      public.safe_to_numeric(base.odds_current->>'total'),
      public.safe_to_numeric(base.odds_current->>'total_value'),
      public.safe_to_numeric(base.odds_current->>'overUnder')
    ) AS live_total,
    public.american_implied_probability(
      COALESCE(
        public.safe_to_numeric(base.odds_current->>'homeML'),
        public.safe_to_numeric(base.odds_current->>'home_ml')
      )
    ) AS live_home_implied_prob,
    public.american_implied_probability(
      COALESCE(
        public.safe_to_numeric(base.odds_current->>'awayML'),
        public.safe_to_numeric(base.odds_current->>'away_ml')
      )
    ) AS live_away_implied_prob,
    public.devig_home_probability(
      COALESCE(
        public.safe_to_numeric(base.odds_current->>'homeML'),
        public.safe_to_numeric(base.odds_current->>'home_ml')
      ),
      COALESCE(
        public.safe_to_numeric(base.odds_current->>'awayML'),
        public.safe_to_numeric(base.odds_current->>'away_ml')
      )
    ) AS live_home_devig_prob,
    public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'homeWinPct'))
      - public.devig_home_probability(
          COALESCE(
            public.safe_to_numeric(base.odds_current->>'homeML'),
            public.safe_to_numeric(base.odds_current->>'home_ml')
          ),
          COALESCE(
            public.safe_to_numeric(base.odds_current->>'awayML'),
            public.safe_to_numeric(base.odds_current->>'away_ml')
          )
        ) AS current_bpi_market_gap,
    COALESCE(
      public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'bpiPregameWinPct')),
      public.normalize_probability(public.safe_to_numeric(base.predictor->>'homeTeamChance'))
    ) - public.devig_home_probability(
      COALESCE(
        public.safe_to_numeric(base.odds_current->>'homeML'),
        public.safe_to_numeric(base.odds_current->>'home_ml')
      ),
      COALESCE(
        public.safe_to_numeric(base.odds_current->>'awayML'),
        public.safe_to_numeric(base.odds_current->>'away_ml')
      )
    ) AS pregame_market_gap,
    public.devig_home_probability(
      COALESCE(
        public.safe_to_numeric(base.opening_odds->>'homeWin'),
        public.safe_to_numeric(base.opening_odds->>'home_ml')
      ),
      COALESCE(
        public.safe_to_numeric(base.opening_odds->>'awayWin'),
        public.safe_to_numeric(base.opening_odds->>'away_ml')
      )
    ) AS opening_home_devig_prob,
    COALESCE(
      public.devig_home_probability(
        COALESCE(
          public.safe_to_numeric(base.opening_odds->>'homeWin'),
          public.safe_to_numeric(base.opening_odds->>'home_ml')
        ),
        COALESCE(
          public.safe_to_numeric(base.opening_odds->>'awayWin'),
          public.safe_to_numeric(base.opening_odds->>'away_ml')
        )
      ),
      COALESCE(
        public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'bpiPregameWinPct')),
        public.normalize_probability(public.safe_to_numeric(base.predictor->>'homeTeamChance'))
      )
    ) AS pregame_anchor_home_prob,
    CASE
      WHEN COALESCE(
        public.devig_home_probability(
          COALESCE(
            public.safe_to_numeric(base.opening_odds->>'homeWin'),
            public.safe_to_numeric(base.opening_odds->>'home_ml')
          ),
          COALESCE(
            public.safe_to_numeric(base.opening_odds->>'awayWin'),
            public.safe_to_numeric(base.opening_odds->>'away_ml')
          )
        ),
        COALESCE(
          public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'bpiPregameWinPct')),
          public.normalize_probability(public.safe_to_numeric(base.predictor->>'homeTeamChance'))
        )
      ) IS NULL THEN NULL
      WHEN COALESCE(
        public.devig_home_probability(
          COALESCE(
            public.safe_to_numeric(base.opening_odds->>'homeWin'),
            public.safe_to_numeric(base.opening_odds->>'home_ml')
          ),
          COALESCE(
            public.safe_to_numeric(base.opening_odds->>'awayWin'),
            public.safe_to_numeric(base.opening_odds->>'away_ml')
          )
        ),
        COALESCE(
          public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'bpiPregameWinPct')),
          public.normalize_probability(public.safe_to_numeric(base.predictor->>'homeTeamChance'))
        )
      ) >= 0.5 THEN 'HOME'
      ELSE 'AWAY'
    END AS pregame_favorite_side,
    CASE
      WHEN COALESCE(
        public.devig_home_probability(
          COALESCE(
            public.safe_to_numeric(base.opening_odds->>'homeWin'),
            public.safe_to_numeric(base.opening_odds->>'home_ml')
          ),
          COALESCE(
            public.safe_to_numeric(base.opening_odds->>'awayWin'),
            public.safe_to_numeric(base.opening_odds->>'away_ml')
          )
        ),
        COALESCE(
          public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'bpiPregameWinPct')),
          public.normalize_probability(public.safe_to_numeric(base.predictor->>'homeTeamChance'))
        )
      ) IS NULL THEN NULL
      ELSE GREATEST(
        COALESCE(
          public.devig_home_probability(
            COALESCE(
              public.safe_to_numeric(base.opening_odds->>'homeWin'),
              public.safe_to_numeric(base.opening_odds->>'home_ml')
            ),
            COALESCE(
              public.safe_to_numeric(base.opening_odds->>'awayWin'),
              public.safe_to_numeric(base.opening_odds->>'away_ml')
            )
          ),
          COALESCE(
            public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'bpiPregameWinPct')),
            public.normalize_probability(public.safe_to_numeric(base.predictor->>'homeTeamChance'))
          )
        ),
        1 - COALESCE(
          public.devig_home_probability(
            COALESCE(
              public.safe_to_numeric(base.opening_odds->>'homeWin'),
              public.safe_to_numeric(base.opening_odds->>'home_ml')
            ),
            COALESCE(
              public.safe_to_numeric(base.opening_odds->>'awayWin'),
              public.safe_to_numeric(base.opening_odds->>'away_ml')
            )
          ),
          COALESCE(
            public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'bpiPregameWinPct')),
            public.normalize_probability(public.safe_to_numeric(base.predictor->>'homeTeamChance'))
          )
        )
      )
    END AS pregame_favorite_prob,
    COALESCE(
      public.normalize_probability(public.safe_to_numeric(base.bpi_play_data->>'bpiPregameWinPct')),
      public.normalize_probability(public.safe_to_numeric(base.predictor->>'homeTeamChance'))
    ) - public.devig_home_probability(
      COALESCE(
        public.safe_to_numeric(base.opening_odds->>'homeWin'),
        public.safe_to_numeric(base.opening_odds->>'home_ml')
      ),
      COALESCE(
        public.safe_to_numeric(base.opening_odds->>'awayWin'),
        public.safe_to_numeric(base.opening_odds->>'away_ml')
      )
    ) AS pregame_model_market_delta,
    COALESCE(
      public.safe_to_numeric(base.opening_odds->>'total'),
      public.safe_to_numeric(base.opening_odds->>'overUnder'),
      public.safe_to_numeric(base.t0_odds->>'total'),
      public.safe_to_numeric(base.t0_odds->>'total_value'),
      public.safe_to_numeric(base.t60_odds->>'total'),
      public.safe_to_numeric(base.t60_odds->>'total_value')
    ) AS pregame_total_anchor,
    COALESCE(
      public.parse_spread_magnitude(base.opening_odds->>'spread'),
      ABS(public.safe_to_numeric(base.opening_odds->>'homeSpread')),
      ABS(public.safe_to_numeric(base.opening_odds->>'awaySpread'))
    ) AS opening_spread_abs,
    public.safe_to_numeric(base.situation->>'homeTimeouts')::integer AS home_timeouts_remaining,
    public.safe_to_numeric(base.situation->>'awayTimeouts')::integer AS away_timeouts_remaining,
    public.safe_to_numeric(base.situation->>'homeFouls')::integer AS home_team_fouls,
    public.safe_to_numeric(base.situation->>'awayFouls')::integer AS away_team_fouls,
    public.safe_to_numeric(base.situation->>'homeFoulsToGive')::integer AS home_fouls_to_give,
    public.safe_to_numeric(base.situation->>'awayFoulsToGive')::integer AS away_fouls_to_give,
    NULLIF(base.situation->>'homeBonusState', '') AS home_bonus_state,
    NULLIF(base.situation->>'awayBonusState', '') AS away_bonus_state,
    NULLIF(base.possession_meta->>'side', '') AS derived_possession_side,
    NULLIF(base.possession_meta->>'confidence', '') AS derived_possession_confidence,
    NULLIF(base.possession_meta->>'source', '') AS derived_possession_source,
    CASE
      WHEN COALESCE(base.home_score, 0) > COALESCE(base.away_score, 0) THEN 'AWAY'
      WHEN COALESCE(base.home_score, 0) < COALESCE(base.away_score, 0) THEN 'HOME'
      ELSE NULL
    END AS trailing_side,
    CASE
      WHEN base.period = 4
        AND public.nba_remaining_minutes(base.period, base.clock) <= 2.5
        AND ABS(COALESCE(base.home_score, 0) - COALESCE(base.away_score, 0)) BETWEEN 3 AND 10
        AND (
          (COALESCE(base.home_score, 0) < COALESCE(base.away_score, 0) AND COALESCE(public.safe_to_numeric(base.situation->>'homeFoulsToGive'), 0) = 0)
          OR
          (COALESCE(base.home_score, 0) > COALESCE(base.away_score, 0) AND COALESCE(public.safe_to_numeric(base.situation->>'awayFoulsToGive'), 0) = 0)
        )
      THEN true
      ELSE false
    END AS foul_extension_flag,
    (
      (
        COALESCE(
          public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace'),
          0
        ) +
        COALESCE(
          public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace'),
          0
        )
      ) / NULLIF(
        CASE
          WHEN public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace') IS NOT NULL
           AND public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace') IS NOT NULL
            THEN 2
          WHEN public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace') IS NOT NULL
            OR public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace') IS NOT NULL
            THEN 1
          ELSE 0
        END,
        0
      )
    ) AS pace_live,
    (
      (
        COALESCE(
          public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace'),
          0
        ) +
        COALESCE(
          public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace'),
          0
        )
      ) / NULLIF(
        CASE
          WHEN public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace') IS NOT NULL
           AND public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace') IS NOT NULL
            THEN 2
          WHEN public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace') IS NOT NULL
            OR public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace') IS NOT NULL
            THEN 1
          ELSE 0
        END,
        0
      )
    ) * (public.nba_remaining_minutes(base.period, base.clock) / 48.0) AS remaining_possessions_est,
    public.nba_observed_pace_48(base.stats, base.period, base.clock) AS observed_pace_48,
    public.nba_observed_team_possessions(base.stats, 'HOME') AS home_observed_possessions_est,
    public.nba_observed_team_possessions(base.stats, 'AWAY') AS away_observed_possessions_est,
    public.nba_observed_possessions(base.stats) AS observed_possessions_est,
    public.nba_remaining_possessions_v2(
      base.stats,
      base.period,
      base.clock,
      (
        (
          COALESCE(
            public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace'),
            0
          ) +
          COALESCE(
            public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace'),
            0
          )
        ) / NULLIF(
          CASE
            WHEN public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace') IS NOT NULL
             AND public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace') IS NOT NULL
              THEN 2
            WHEN public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace') IS NOT NULL
              OR public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace') IS NOT NULL
              THEN 1
            ELSE 0
          END,
          0
        )
      ),
      COALESCE(base.home_score, 0) - COALESCE(base.away_score, 0),
      public.safe_to_numeric(base.situation->>'homeFoulsToGive')::integer,
      public.safe_to_numeric(base.situation->>'awayFoulsToGive')::integer,
      public.safe_to_numeric(base.situation->>'homeTimeouts')::integer,
      public.safe_to_numeric(base.situation->>'awayTimeouts')::integer,
      NULLIF(base.situation->>'homeBonusState', ''),
      NULLIF(base.situation->>'awayBonusState', ''),
      NULLIF(base.possession_meta->>'side', '')
    ) AS remaining_possessions_est_v2,
    public.nba_remaining_possessions_v2(
      base.stats,
      base.period,
      base.clock,
      (
        (
          COALESCE(
            public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace'),
            0
          ) +
          COALESCE(
            public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace'),
            0
          )
        ) / NULLIF(
          CASE
            WHEN public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace') IS NOT NULL
             AND public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace') IS NOT NULL
              THEN 2
            WHEN public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace') IS NOT NULL
              OR public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace') IS NOT NULL
              THEN 1
            ELSE 0
          END,
          0
        )
      ),
      COALESCE(base.home_score, 0) - COALESCE(base.away_score, 0),
      public.safe_to_numeric(base.situation->>'homeFoulsToGive')::integer,
      public.safe_to_numeric(base.situation->>'awayFoulsToGive')::integer,
      public.safe_to_numeric(base.situation->>'homeTimeouts')::integer,
      public.safe_to_numeric(base.situation->>'awayTimeouts')::integer,
      NULLIF(base.situation->>'homeBonusState', ''),
      NULLIF(base.situation->>'awayBonusState', ''),
      NULLIF(base.possession_meta->>'side', '')
    ) - (
      (
        (
          COALESCE(
            public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace'),
            0
          ) +
          COALESCE(
            public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace'),
            0
          )
        ) / NULLIF(
          CASE
            WHEN public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace') IS NOT NULL
             AND public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace') IS NOT NULL
              THEN 2
            WHEN public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'home'->>'pace') IS NOT NULL
              OR public.safe_to_numeric(base.advanced_metrics->'core_api_efficiency'->'away'->>'pace') IS NOT NULL
              THEN 1
            ELSE 0
          END,
          0
        )
      ) * (public.nba_remaining_minutes(base.period, base.clock) / 48.0)
    ) AS remaining_possessions_delta,
    public.nba_game_script_class(
      base.period,
      public.nba_remaining_minutes(base.period, base.clock),
      COALESCE(base.home_score, 0) - COALESCE(base.away_score, 0),
      NULLIF(base.possession_meta->>'side', ''),
      NULLIF(base.situation->>'homeBonusState', ''),
      NULLIF(base.situation->>'awayBonusState', ''),
      public.safe_to_numeric(base.situation->>'homeTimeouts')::integer,
      public.safe_to_numeric(base.situation->>'awayTimeouts')::integer,
      public.nba_intentional_foul_likelihood_class(
        base.period,
        public.nba_remaining_minutes(base.period, base.clock),
        COALESCE(base.home_score, 0) - COALESCE(base.away_score, 0),
        public.safe_to_numeric(base.situation->>'homeFoulsToGive')::integer,
        public.safe_to_numeric(base.situation->>'awayFoulsToGive')::integer,
        public.safe_to_numeric(base.situation->>'homeTimeouts')::integer,
        public.safe_to_numeric(base.situation->>'awayTimeouts')::integer
      )
    ) AS game_script_class,
    public.nba_intentional_foul_likelihood_class(
      base.period,
      public.nba_remaining_minutes(base.period, base.clock),
      COALESCE(base.home_score, 0) - COALESCE(base.away_score, 0),
      public.safe_to_numeric(base.situation->>'homeFoulsToGive')::integer,
      public.safe_to_numeric(base.situation->>'awayFoulsToGive')::integer,
      public.safe_to_numeric(base.situation->>'homeTimeouts')::integer,
      public.safe_to_numeric(base.situation->>'awayTimeouts')::integer
    ) AS intentional_foul_likelihood_class,
    public.extract_snapshot_stat_pair_piece(base.stats, 'FG', 'HOME', 2) AS home_fg_attempts,
    public.extract_snapshot_stat_pair_piece(base.stats, 'FG', 'AWAY', 2) AS away_fg_attempts,
    public.extract_snapshot_stat_pair_piece(base.stats, '3PT', 'HOME', 2) AS home_three_attempts,
    public.extract_snapshot_stat_pair_piece(base.stats, '3PT', 'AWAY', 2) AS away_three_attempts,
    public.extract_snapshot_stat_pair_piece(base.stats, 'FT', 'HOME', 2) AS home_ft_attempts,
    public.extract_snapshot_stat_pair_piece(base.stats, 'FT', 'AWAY', 2) AS away_ft_attempts,
    public.extract_snapshot_stat_pair_piece(base.stats, '3PT', 'HOME', 2)
      / NULLIF(public.extract_snapshot_stat_pair_piece(base.stats, 'FG', 'HOME', 2), 0) AS home_three_rate,
    public.extract_snapshot_stat_pair_piece(base.stats, '3PT', 'AWAY', 2)
      / NULLIF(public.extract_snapshot_stat_pair_piece(base.stats, 'FG', 'AWAY', 2), 0) AS away_three_rate,
    public.extract_snapshot_stat_pair_piece(base.stats, 'FT', 'HOME', 2)
      / NULLIF(public.extract_snapshot_stat_pair_piece(base.stats, 'FG', 'HOME', 2), 0) AS home_free_throw_rate,
    public.extract_snapshot_stat_pair_piece(base.stats, 'FT', 'AWAY', 2)
      / NULLIF(public.extract_snapshot_stat_pair_piece(base.stats, 'FG', 'AWAY', 2), 0) AS away_free_throw_rate,
    public.extract_snapshot_stat_numeric(base.stats, 'Points in Paint', 'HOME') AS home_points_in_paint,
    public.extract_snapshot_stat_numeric(base.stats, 'Points in Paint', 'AWAY') AS away_points_in_paint,
    public.extract_snapshot_stat_numeric(base.stats, 'Fast Break Points', 'HOME') AS home_fast_break_points,
    public.extract_snapshot_stat_numeric(base.stats, 'Fast Break Points', 'AWAY') AS away_fast_break_points,
    public.extract_snapshot_stat_numeric(base.stats, 'Points in Paint', 'HOME')
      / NULLIF(base.home_score, 0) AS home_paint_share,
    public.extract_snapshot_stat_numeric(base.stats, 'Points in Paint', 'AWAY')
      / NULLIF(base.away_score, 0) AS away_paint_share,
    base.official_crew_key,
    base.official_count,
    jsonb_strip_nulls(
      jsonb_build_object(
        'snapshot_table', 'live_context_snapshots',
        'pregame_source',
          CASE
            WHEN base.bpi_play_data IS NOT NULL AND base.bpi_play_data ? 'bpiPregameWinPct' THEN 'game_events.bpi_probability'
            WHEN base.predictor IS NOT NULL THEN 'live_context_snapshots.predictor'
            ELSE NULL
          END,
        'possession_source', base.possession_meta->>'source',
        'pace_source', 'advanced_metrics.core_api_efficiency',
        'official_source', CASE WHEN base.official_count > 0 THEN 'game_officials' ELSE NULL END
      )
    ) AS feature_source,
    now() AS updated_at
  FROM base
  ON CONFLICT (source_snapshot_id) DO UPDATE SET
    match_id = EXCLUDED.match_id,
    league_id = EXCLUDED.league_id,
    sport = EXCLUDED.sport,
    captured_at = EXCLUDED.captured_at,
    period = EXCLUDED.period,
    clock = EXCLUDED.clock,
    clock_seconds = EXCLUDED.clock_seconds,
    minute_bucket = EXCLUDED.minute_bucket,
    remaining_minutes = EXCLUDED.remaining_minutes,
    home_score = EXCLUDED.home_score,
    away_score = EXCLUDED.away_score,
    score_diff = EXCLUDED.score_diff,
    total_points = EXCLUDED.total_points,
    home_team = EXCLUDED.home_team,
    away_team = EXCLUDED.away_team,
    home_team_id = EXCLUDED.home_team_id,
    away_team_id = EXCLUDED.away_team_id,
    pregame_home_wp = EXCLUDED.pregame_home_wp,
    pregame_away_wp = EXCLUDED.pregame_away_wp,
    current_bpi_home_wp = EXCLUDED.current_bpi_home_wp,
    current_bpi_away_wp = EXCLUDED.current_bpi_away_wp,
    bpi_predicted_margin = EXCLUDED.bpi_predicted_margin,
    opening_home_ml = EXCLUDED.opening_home_ml,
    opening_away_ml = EXCLUDED.opening_away_ml,
    opening_home_spread = EXCLUDED.opening_home_spread,
    opening_away_spread = EXCLUDED.opening_away_spread,
    opening_total = EXCLUDED.opening_total,
    t60_home_ml = EXCLUDED.t60_home_ml,
    t60_away_ml = EXCLUDED.t60_away_ml,
    t60_home_spread = EXCLUDED.t60_home_spread,
    t60_away_spread = EXCLUDED.t60_away_spread,
    t60_total = EXCLUDED.t60_total,
    t0_home_ml = EXCLUDED.t0_home_ml,
    t0_away_ml = EXCLUDED.t0_away_ml,
    t0_home_spread = EXCLUDED.t0_home_spread,
    t0_away_spread = EXCLUDED.t0_away_spread,
    t0_total = EXCLUDED.t0_total,
    live_home_ml = EXCLUDED.live_home_ml,
    live_away_ml = EXCLUDED.live_away_ml,
    live_home_spread = EXCLUDED.live_home_spread,
    live_away_spread = EXCLUDED.live_away_spread,
    live_total = EXCLUDED.live_total,
    live_home_implied_prob = EXCLUDED.live_home_implied_prob,
    live_away_implied_prob = EXCLUDED.live_away_implied_prob,
    live_home_devig_prob = EXCLUDED.live_home_devig_prob,
    current_bpi_market_gap = EXCLUDED.current_bpi_market_gap,
    pregame_market_gap = EXCLUDED.pregame_market_gap,
    opening_home_devig_prob = EXCLUDED.opening_home_devig_prob,
    pregame_anchor_home_prob = EXCLUDED.pregame_anchor_home_prob,
    pregame_favorite_side = EXCLUDED.pregame_favorite_side,
    pregame_favorite_prob = EXCLUDED.pregame_favorite_prob,
    pregame_model_market_delta = EXCLUDED.pregame_model_market_delta,
    pregame_total_anchor = EXCLUDED.pregame_total_anchor,
    opening_spread_abs = EXCLUDED.opening_spread_abs,
    home_timeouts_remaining = EXCLUDED.home_timeouts_remaining,
    away_timeouts_remaining = EXCLUDED.away_timeouts_remaining,
    home_team_fouls = EXCLUDED.home_team_fouls,
    away_team_fouls = EXCLUDED.away_team_fouls,
    home_fouls_to_give = EXCLUDED.home_fouls_to_give,
    away_fouls_to_give = EXCLUDED.away_fouls_to_give,
    home_bonus_state = EXCLUDED.home_bonus_state,
    away_bonus_state = EXCLUDED.away_bonus_state,
    derived_possession_side = EXCLUDED.derived_possession_side,
    derived_possession_confidence = EXCLUDED.derived_possession_confidence,
    derived_possession_source = EXCLUDED.derived_possession_source,
    trailing_side = EXCLUDED.trailing_side,
    foul_extension_flag = EXCLUDED.foul_extension_flag,
    pace_live = EXCLUDED.pace_live,
    remaining_possessions_est = EXCLUDED.remaining_possessions_est,
    observed_pace_48 = EXCLUDED.observed_pace_48,
    home_observed_possessions_est = EXCLUDED.home_observed_possessions_est,
    away_observed_possessions_est = EXCLUDED.away_observed_possessions_est,
    observed_possessions_est = EXCLUDED.observed_possessions_est,
    remaining_possessions_est_v2 = EXCLUDED.remaining_possessions_est_v2,
    remaining_possessions_delta = EXCLUDED.remaining_possessions_delta,
    game_script_class = EXCLUDED.game_script_class,
    intentional_foul_likelihood_class = EXCLUDED.intentional_foul_likelihood_class,
    home_fg_attempts = EXCLUDED.home_fg_attempts,
    away_fg_attempts = EXCLUDED.away_fg_attempts,
    home_three_attempts = EXCLUDED.home_three_attempts,
    away_three_attempts = EXCLUDED.away_three_attempts,
    home_ft_attempts = EXCLUDED.home_ft_attempts,
    away_ft_attempts = EXCLUDED.away_ft_attempts,
    home_three_rate = EXCLUDED.home_three_rate,
    away_three_rate = EXCLUDED.away_three_rate,
    home_free_throw_rate = EXCLUDED.home_free_throw_rate,
    away_free_throw_rate = EXCLUDED.away_free_throw_rate,
    home_points_in_paint = EXCLUDED.home_points_in_paint,
    away_points_in_paint = EXCLUDED.away_points_in_paint,
    home_fast_break_points = EXCLUDED.home_fast_break_points,
    away_fast_break_points = EXCLUDED.away_fast_break_points,
    home_paint_share = EXCLUDED.home_paint_share,
    away_paint_share = EXCLUDED.away_paint_share,
    official_crew_key = EXCLUDED.official_crew_key,
    official_count = EXCLUDED.official_count,
    feature_source = EXCLUDED.feature_source,
    updated_at = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON TABLE public.live_state_enriched IS 'Phase 1 NBA causal-state table built from snapshot, market, BPI, and officiating data.';
COMMENT ON FUNCTION public.refresh_live_state_enriched_nba(text, timestamptz) IS 'Upserts NBA live_state_enriched rows from the historical live_context_snapshots ledger.';
