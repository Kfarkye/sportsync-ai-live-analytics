BEGIN;

CREATE TABLE IF NOT EXISTS public.pinnacle_divergence_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id text NOT NULL REFERENCES public.matches(id),
  sport text NOT NULL,
  league_id text NOT NULL,
  dk_opening_total numeric,
  pinnacle_opening_total numeric,
  pregame_gap numeric GENERATED ALWAYS AS (pinnacle_opening_total - dk_opening_total) STORED,
  gap_direction text GENERATED ALWAYS AS (
    CASE
      WHEN pinnacle_opening_total > dk_opening_total THEN 'OVER'
      WHEN pinnacle_opening_total < dk_opening_total THEN 'UNDER'
      ELSE 'ALIGNED'
    END
  ) STORED,
  final_total numeric,
  dk_result text,
  pinnacle_was_right boolean,
  dk_miss numeric,
  pin_miss numeric,
  graded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pinnacle_divergence_signals_match_id_key UNIQUE (match_id),
  CONSTRAINT pinnacle_divergence_signals_dk_result_check CHECK (dk_result IN ('OVER', 'UNDER'))
);

CREATE INDEX IF NOT EXISTS idx_pin_div_sport
  ON public.pinnacle_divergence_signals (sport, gap_direction);

CREATE INDEX IF NOT EXISTS idx_pin_div_graded
  ON public.pinnacle_divergence_signals (pinnacle_was_right, sport);

CREATE OR REPLACE FUNCTION public.get_pinnacle_divergence_accuracy(
  p_sport text,
  p_gap_direction text DEFAULT NULL,
  p_min_abs_gap numeric DEFAULT 0.5
)
RETURNS TABLE (
  total bigint,
  right_count bigint,
  accuracy numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE pinnacle_was_right) AS right_count,
    CASE
      WHEN COUNT(*) = 0 THEN NULL
      ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE pinnacle_was_right) / COUNT(*), 1)
    END AS accuracy
  FROM public.pinnacle_divergence_signals
  WHERE sport = p_sport
    AND (p_gap_direction IS NULL OR gap_direction = p_gap_direction)
    AND ABS(COALESCE(pregame_gap, 0)) >= COALESCE(p_min_abs_gap, 0);
$$;

CREATE OR REPLACE FUNCTION public.record_pinnacle_divergence_signal(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match record;
  v_dk_total numeric;
  v_pin_total numeric;
  v_final_total numeric;
  v_dk_result text;
  v_pin_right boolean;
  v_row public.pinnacle_divergence_signals%ROWTYPE;
BEGIN
  IF p_match_id IS NULL OR btrim(p_match_id) = '' THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'match_id_required');
  END IF;

  SELECT
    m.id,
    m.sport,
    m.league_id,
    m.opening_odds,
    m.home_score,
    m.away_score,
    m.status
  INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'match_not_found', 'match_id', p_match_id);
  END IF;

  IF COALESCE(v_match.status, '') NOT IN ('FINAL', 'STATUS_FINAL', 'STATUS_FULL_TIME', 'post') THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'match_not_final', 'match_id', p_match_id);
  END IF;

  IF COALESCE(v_match.opening_odds->>'total', '') ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN
    v_dk_total := (v_match.opening_odds->>'total')::numeric;
  END IF;

  SELECT p.total::numeric
  INTO v_pin_total
  FROM public.live_odds_snapshots p
  WHERE p.match_id = p_match_id
    AND p.provider = 'Pinnacle'
    AND p.total IS NOT NULL
  ORDER BY p.captured_at ASC
  LIMIT 1;

  IF v_match.home_score IS NULL OR v_match.away_score IS NULL OR v_dk_total IS NULL OR v_pin_total IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'missing_inputs',
      'match_id', p_match_id,
      'has_final_score', (v_match.home_score IS NOT NULL AND v_match.away_score IS NOT NULL),
      'has_dk_opening_total', (v_dk_total IS NOT NULL),
      'has_pinnacle_opening_total', (v_pin_total IS NOT NULL)
    );
  END IF;

  v_final_total := (v_match.home_score + v_match.away_score)::numeric;
  v_dk_result := CASE WHEN v_final_total > v_dk_total THEN 'OVER' ELSE 'UNDER' END;
  v_pin_right := CASE
    WHEN v_pin_total > v_dk_total AND v_final_total > v_dk_total THEN TRUE
    WHEN v_pin_total < v_dk_total AND v_final_total < v_dk_total THEN TRUE
    ELSE FALSE
  END;

  INSERT INTO public.pinnacle_divergence_signals (
    match_id,
    sport,
    league_id,
    dk_opening_total,
    pinnacle_opening_total,
    final_total,
    dk_result,
    pinnacle_was_right,
    dk_miss,
    pin_miss,
    graded_at
  )
  VALUES (
    p_match_id,
    v_match.sport,
    v_match.league_id,
    v_dk_total,
    v_pin_total,
    v_final_total,
    v_dk_result,
    v_pin_right,
    ABS(v_final_total - v_dk_total),
    ABS(v_final_total - v_pin_total),
    now()
  )
  ON CONFLICT (match_id) DO UPDATE
  SET
    sport = EXCLUDED.sport,
    league_id = EXCLUDED.league_id,
    dk_opening_total = EXCLUDED.dk_opening_total,
    pinnacle_opening_total = EXCLUDED.pinnacle_opening_total,
    final_total = EXCLUDED.final_total,
    dk_result = EXCLUDED.dk_result,
    pinnacle_was_right = EXCLUDED.pinnacle_was_right,
    dk_miss = EXCLUDED.dk_miss,
    pin_miss = EXCLUDED.pin_miss,
    graded_at = EXCLUDED.graded_at
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'status', 'ok',
    'match_id', v_row.match_id,
    'sport', v_row.sport,
    'league_id', v_row.league_id,
    'pregame_gap', v_row.pregame_gap,
    'gap_direction', v_row.gap_direction,
    'pinnacle_was_right', v_row.pinnacle_was_right
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pinnacle_divergence_context(
  p_match_id text,
  p_sport text DEFAULT NULL,
  p_league_id text DEFAULT NULL,
  p_dk_total numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match record;
  v_sport text;
  v_league_id text;
  v_dk_total numeric;
  v_pin_total numeric;
  v_threshold numeric;
  v_gap numeric;
  v_abs_gap numeric;
  v_direction text;
  v_total bigint := 0;
  v_right bigint := 0;
  v_accuracy numeric := NULL;
BEGIN
  IF p_match_id IS NULL OR btrim(p_match_id) = '' THEN
    RETURN jsonb_build_object('available', FALSE, 'reason', 'match_id_required');
  END IF;

  SELECT
    m.id,
    m.sport,
    m.league_id,
    CASE
      WHEN COALESCE(m.opening_odds->>'total', '') ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN (m.opening_odds->>'total')::numeric
      ELSE NULL
    END AS opening_total
  INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', FALSE, 'reason', 'match_not_found', 'match_id', p_match_id);
  END IF;

  v_sport := COALESCE(NULLIF(p_sport, ''), v_match.sport);
  v_league_id := COALESCE(NULLIF(p_league_id, ''), v_match.league_id);
  v_dk_total := COALESCE(p_dk_total, v_match.opening_total);

  SELECT p.total::numeric
  INTO v_pin_total
  FROM public.live_odds_snapshots p
  WHERE p.match_id = p_match_id
    AND p.provider = 'Pinnacle'
    AND p.total IS NOT NULL
  ORDER BY p.captured_at ASC
  LIMIT 1;

  IF v_sport = 'basketball' OR v_league_id IN ('basketball_nba', 'nba') THEN
    v_threshold := 1.5;
  ELSIF v_sport IN ('soccer', 'hockey', 'icehockey') THEN
    v_threshold := 0.5;
  ELSE
    v_threshold := 0.5;
  END IF;

  IF v_dk_total IS NULL OR v_pin_total IS NULL THEN
    RETURN jsonb_build_object(
      'available', FALSE,
      'reason', 'missing_totals',
      'match_id', p_match_id,
      'sport', v_sport,
      'league_id', v_league_id,
      'threshold', v_threshold
    );
  END IF;

  v_gap := v_pin_total - v_dk_total;
  v_abs_gap := ABS(v_gap);
  v_direction := CASE
    WHEN v_gap > 0 THEN 'OVER'
    WHEN v_gap < 0 THEN 'UNDER'
    ELSE 'ALIGNED'
  END;

  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE pinnacle_was_right)::bigint
  INTO v_total, v_right
  FROM public.pinnacle_divergence_signals s
  WHERE s.sport = v_sport
    AND s.gap_direction = v_direction
    AND ABS(COALESCE(s.pregame_gap, 0)) >= v_threshold
    AND s.pinnacle_was_right IS NOT NULL;

  IF v_total > 0 THEN
    v_accuracy := ROUND((100.0 * v_right::numeric / v_total::numeric), 1);
  END IF;

  RETURN jsonb_build_object(
    'available', TRUE,
    'match_id', p_match_id,
    'sport', v_sport,
    'league_id', v_league_id,
    'dk_opening_total', v_dk_total,
    'pinnacle_opening_total', v_pin_total,
    'gap', v_gap,
    'abs_gap', v_abs_gap,
    'direction', v_direction,
    'threshold', v_threshold,
    'qualifies', (v_direction <> 'ALIGNED' AND v_abs_gap >= v_threshold),
    'historical_total', v_total,
    'historical_right', v_right,
    'historical_accuracy_pct', v_accuracy
  );
END;
$$;

INSERT INTO public.pinnacle_divergence_signals (
  match_id,
  sport,
  league_id,
  dk_opening_total,
  pinnacle_opening_total,
  final_total,
  dk_result,
  pinnacle_was_right,
  dk_miss,
  pin_miss,
  graded_at
)
SELECT
  m.id,
  m.sport,
  m.league_id,
  (m.opening_odds->>'total')::numeric AS dk_opening_total,
  pin.total AS pinnacle_opening_total,
  (m.home_score + m.away_score)::numeric AS final_total,
  CASE
    WHEN (m.home_score + m.away_score)::numeric > (m.opening_odds->>'total')::numeric THEN 'OVER'
    ELSE 'UNDER'
  END AS dk_result,
  CASE
    WHEN pin.total > (m.opening_odds->>'total')::numeric
      AND (m.home_score + m.away_score)::numeric > (m.opening_odds->>'total')::numeric THEN TRUE
    WHEN pin.total < (m.opening_odds->>'total')::numeric
      AND (m.home_score + m.away_score)::numeric < (m.opening_odds->>'total')::numeric THEN TRUE
    ELSE FALSE
  END AS pinnacle_was_right,
  ABS((m.home_score + m.away_score)::numeric - (m.opening_odds->>'total')::numeric) AS dk_miss,
  ABS((m.home_score + m.away_score)::numeric - pin.total) AS pin_miss,
  now() AS graded_at
FROM public.matches m
JOIN LATERAL (
  SELECT p.total::numeric AS total
  FROM public.live_odds_snapshots p
  WHERE p.match_id = m.id
    AND p.provider = 'Pinnacle'
    AND p.total IS NOT NULL
  ORDER BY p.captured_at ASC
  LIMIT 1
) pin ON TRUE
WHERE m.status IN ('FINAL', 'STATUS_FINAL', 'STATUS_FULL_TIME', 'post')
  AND m.home_score IS NOT NULL
  AND m.away_score IS NOT NULL
  AND COALESCE(m.opening_odds->>'total', '') ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
ON CONFLICT (match_id) DO UPDATE
SET
  sport = EXCLUDED.sport,
  league_id = EXCLUDED.league_id,
  dk_opening_total = EXCLUDED.dk_opening_total,
  pinnacle_opening_total = EXCLUDED.pinnacle_opening_total,
  final_total = EXCLUDED.final_total,
  dk_result = EXCLUDED.dk_result,
  pinnacle_was_right = EXCLUDED.pinnacle_was_right,
  dk_miss = EXCLUDED.dk_miss,
  pin_miss = EXCLUDED.pin_miss,
  graded_at = EXCLUDED.graded_at;

COMMIT;
