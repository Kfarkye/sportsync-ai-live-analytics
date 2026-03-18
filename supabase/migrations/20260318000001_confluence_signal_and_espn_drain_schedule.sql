BEGIN;

CREATE OR REPLACE FUNCTION public.record_confluence_signal(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match record;
  v_event_id text;
  v_league_id text;
  v_dk_open_total numeric;
  v_dk_mid_total numeric;
  v_pin_open_total numeric;
  v_pin_mid_total numeric;
  v_pin_first_at timestamptz;
  v_espn_latest record;
  v_espn_first record;
  v_final_total numeric;
  v_dk_result text;
  v_espn_direction text;
  v_pin_direction text;
  v_confluence_tier text;
  v_signal_direction text;
  v_signal_correct boolean;
  v_pregame_gap numeric;
  v_pin_pregame_divergence boolean;
  v_espn_prob_bucket text;
  v_pin_gap_bucket text;
  v_lead_source text;
  v_lead_lag_seconds integer;
  v_snapshot_time timestamptz := now();
BEGIN
  IF p_match_id IS NULL OR btrim(p_match_id) = '' THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'match_id_required');
  END IF;

  SELECT
    m.id,
    m.sport,
    m.league_id,
    m.home_team,
    m.away_team,
    m.status,
    m.home_score,
    m.away_score,
    m.opening_odds,
    m.current_odds
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

  IF v_match.home_score IS NULL OR v_match.away_score IS NULL THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'missing_final_score', 'match_id', p_match_id);
  END IF;

  v_event_id := split_part(p_match_id, '_', 1);
  v_league_id := COALESCE(v_match.league_id, '');
  v_final_total := (v_match.home_score + v_match.away_score)::numeric;

  IF COALESCE(v_match.opening_odds->>'total', '') ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN
    v_dk_open_total := (v_match.opening_odds->>'total')::numeric;
  END IF;
  IF COALESCE(v_match.current_odds->>'total', '') ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN
    v_dk_mid_total := (v_match.current_odds->>'total')::numeric;
  END IF;
  v_dk_mid_total := COALESCE(v_dk_mid_total, v_dk_open_total);

  SELECT p.total::numeric, p.captured_at
  INTO v_pin_open_total, v_pin_first_at
  FROM public.live_odds_snapshots p
  WHERE p.match_id = p_match_id
    AND p.provider = 'Pinnacle'
    AND p.total IS NOT NULL
  ORDER BY p.captured_at ASC
  LIMIT 1;

  SELECT p.total::numeric
  INTO v_pin_mid_total
  FROM public.live_odds_snapshots p
  WHERE p.match_id = p_match_id
    AND p.provider = 'Pinnacle'
    AND p.total IS NOT NULL
  ORDER BY p.captured_at DESC
  LIMIT 1;

  IF v_dk_open_total IS NULL OR v_pin_open_total IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'missing_opening_totals',
      'match_id', p_match_id,
      'has_dk_open', (v_dk_open_total IS NOT NULL),
      'has_pin_open', (v_pin_open_total IS NOT NULL)
    );
  END IF;

  SELECT
    ep.sequence_number,
    ep.total_over_prob,
    ep.created_at,
    ep.last_modified
  INTO v_espn_latest
  FROM public.espn_probabilities ep
  WHERE ep.espn_event_id = v_event_id
    AND ep.league_id = v_league_id
  ORDER BY ep.sequence_number DESC
  LIMIT 1;

  SELECT
    ep.sequence_number,
    ep.total_over_prob,
    ep.created_at,
    ep.last_modified
  INTO v_espn_first
  FROM public.espn_probabilities ep
  WHERE ep.espn_event_id = v_event_id
    AND ep.league_id = v_league_id
    AND ep.total_over_prob IS NOT NULL
    AND (ep.total_over_prob >= 0.55 OR ep.total_over_prob <= 0.45)
  ORDER BY ep.sequence_number ASC
  LIMIT 1;

  IF v_espn_latest.sequence_number IS NULL OR v_espn_latest.total_over_prob IS NULL THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'missing_espn_probabilities', 'match_id', p_match_id);
  END IF;

  v_pregame_gap := v_pin_open_total - v_dk_open_total;
  v_pin_pregame_divergence := ABS(v_pregame_gap) >= 0.5;
  v_dk_result := CASE WHEN v_final_total > v_dk_open_total THEN 'OVER' ELSE 'UNDER' END;

  v_espn_direction := CASE
    WHEN v_espn_latest.total_over_prob >= 0.55 THEN 'OVER'
    WHEN v_espn_latest.total_over_prob <= 0.45 THEN 'UNDER'
    ELSE 'NEUTRAL'
  END;

  v_pin_direction := CASE
    WHEN v_pin_mid_total IS NOT NULL AND v_dk_mid_total IS NOT NULL AND v_pin_mid_total > (v_dk_mid_total + 2) THEN 'OVER'
    WHEN v_pin_mid_total IS NOT NULL AND v_dk_mid_total IS NOT NULL AND v_pin_mid_total < (v_dk_mid_total - 2) THEN 'UNDER'
    ELSE 'NEUTRAL'
  END;

  IF v_espn_direction IN ('OVER', 'UNDER') AND v_espn_direction = v_pin_direction AND v_pin_pregame_divergence THEN
    v_confluence_tier := CASE
      WHEN v_espn_latest.total_over_prob >= 0.65 OR v_espn_latest.total_over_prob <= 0.35 THEN 'CONFLUENCE_STRONG'
      ELSE 'CONFLUENCE_LEAN'
    END;
    v_signal_direction := v_espn_direction;
  ELSIF v_espn_direction IN ('OVER', 'UNDER') AND v_pin_direction IN ('OVER', 'UNDER') AND v_espn_direction <> v_pin_direction THEN
    v_confluence_tier := 'CONFLICT';
    v_signal_direction := NULL;
  ELSE
    v_confluence_tier := 'NO_CONFLUENCE';
    v_signal_direction := NULL;
  END IF;

  v_signal_correct := CASE
    WHEN v_signal_direction = 'OVER' THEN v_final_total > v_dk_open_total
    WHEN v_signal_direction = 'UNDER' THEN v_final_total < v_dk_open_total
    ELSE NULL
  END;

  v_espn_prob_bucket := CASE
    WHEN v_espn_latest.total_over_prob >= 0.65 THEN '0.65+'
    WHEN v_espn_latest.total_over_prob <= 0.35 THEN '<=0.35'
    ELSE '0.35-0.65'
  END;

  v_pin_gap_bucket := CASE
    WHEN v_pin_mid_total IS NULL OR v_dk_mid_total IS NULL THEN 'N/A'
    WHEN ABS(v_pin_mid_total - v_dk_mid_total) >= 5 THEN '5+'
    WHEN ABS(v_pin_mid_total - v_dk_mid_total) >= 3 THEN '3-4.99'
    WHEN ABS(v_pin_mid_total - v_dk_mid_total) >= 2 THEN '2-2.99'
    WHEN ABS(v_pin_mid_total - v_dk_mid_total) >= 1 THEN '1-1.99'
    ELSE '<1'
  END;

  IF v_espn_first.created_at IS NOT NULL AND v_pin_first_at IS NOT NULL THEN
    IF v_espn_first.created_at <= v_pin_first_at THEN
      v_lead_source := 'ESPN_FIRST';
    ELSE
      v_lead_source := 'PINNACLE_FIRST';
    END IF;
    v_lead_lag_seconds := EXTRACT(EPOCH FROM (v_pin_first_at - v_espn_first.created_at))::integer;
  ELSE
    v_lead_source := NULL;
    v_lead_lag_seconds := NULL;
  END IF;

  DELETE FROM public.confluence_signals WHERE match_id = p_match_id;

  INSERT INTO public.confluence_signals (
    match_id,
    sport,
    league_id,
    home_team,
    away_team,
    dk_opening_total,
    pinnacle_opening_total,
    pregame_gap,
    snapshot_sequence,
    snapshot_timestamp,
    espn_total_over_prob,
    pinnacle_mid_total,
    dk_mid_total,
    espn_direction,
    pinnacle_direction,
    confluence_grade,
    signal_direction,
    espn_prob_bucket,
    pinnacle_gap_bucket,
    espn_first_signal_at,
    pinnacle_first_signal_at,
    lead_source,
    lead_lag_seconds,
    final_total,
    dk_result,
    signal_correct,
    dk_miss,
    pinnacle_miss,
    margin_vs_close,
    max_adverse_move,
    graded_at,
    espn_discovery_sequence,
    pinnacle_pregame_divergence,
    confluence_tier
  )
  VALUES (
    p_match_id,
    v_match.sport,
    v_league_id,
    v_match.home_team,
    v_match.away_team,
    v_dk_open_total,
    v_pin_open_total,
    v_pregame_gap,
    v_espn_latest.sequence_number,
    v_snapshot_time,
    v_espn_latest.total_over_prob,
    v_pin_mid_total,
    v_dk_mid_total,
    v_espn_direction,
    v_pin_direction,
    'CONFLUENCE_EXPERIMENTAL',
    v_signal_direction,
    v_espn_prob_bucket,
    v_pin_gap_bucket,
    COALESCE(v_espn_first.created_at, v_espn_first.last_modified),
    v_pin_first_at,
    v_lead_source,
    v_lead_lag_seconds,
    v_final_total,
    v_dk_result,
    v_signal_correct,
    ABS(v_final_total - v_dk_open_total),
    ABS(v_final_total - v_pin_open_total),
    NULL,
    NULL,
    now(),
    v_espn_first.sequence_number,
    v_pin_pregame_divergence,
    v_confluence_tier
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'match_id', p_match_id,
    'confluence_tier', v_confluence_tier,
    'signal_direction', v_signal_direction,
    'signal_correct', v_signal_correct
  );
END;
$$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'drain-espn-probs'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'drain-espn-probs',
    '*/2 * * * *',
    $job$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/drain-espn-probabilities',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
    $job$
  );
END;
$$;

COMMIT;
