-- AI Trusted Match Packet + Tool Logging
-- Purpose: provide a single grounded packet per match for AI responses.

CREATE TABLE IF NOT EXISTS public.ai_tool_logs (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  tool_name text NOT NULL,
  match_id text,
  question_type text,
  latency_ms integer,
  packet_freshness_seconds integer,
  missing_fields text[] DEFAULT '{}'::text[],
  success boolean NOT NULL DEFAULT true,
  error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_logs_created_at
  ON public.ai_tool_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_tool_logs_match_created
  ON public.ai_tool_logs (match_id, created_at DESC);

ALTER TABLE public.ai_tool_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access ai_tool_logs" ON public.ai_tool_logs;
CREATE POLICY "Service role full access ai_tool_logs"
ON public.ai_tool_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read ai_tool_logs" ON public.ai_tool_logs;
CREATE POLICY "Authenticated read ai_tool_logs"
ON public.ai_tool_logs
FOR SELECT
TO authenticated
USING (false);

CREATE OR REPLACE FUNCTION public.jsonb_first_numeric(p_payload jsonb, p_keys text[])
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_key text;
  v_raw text;
BEGIN
  IF p_payload IS NULL OR p_keys IS NULL OR array_length(p_keys, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH v_key IN ARRAY p_keys LOOP
    v_raw := p_payload ->> v_key;
    IF v_raw IS NOT NULL AND v_raw ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN
      RETURN v_raw::numeric;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_match_packet(
  p_match_id text,
  p_max_events integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match jsonb;
  v_state jsonb;
  v_context jsonb := '{}'::jsonb;
  v_pregame jsonb;
  v_events jsonb := '[]'::jsonb;
  v_leaders jsonb := '{}'::jsonb;
  v_trends jsonb := '[]'::jsonb;
  v_provenance jsonb := '[]'::jsonb;
  v_answerability jsonb := '{}'::jsonb;
  v_as_of timestamptz;
  v_score_as_of timestamptz;
  v_market_as_of timestamptz;
  v_trend_as_of timestamptz;
  v_freshness_seconds integer;
  v_home_score integer;
  v_away_score integer;
  v_period integer;
  v_clock text;
  v_status text;
  v_live_total numeric;
  v_open_total numeric;
  v_total_move numeric;
  v_live_spread numeric;
  v_open_spread numeric;
  v_live_home_ml numeric;
  v_live_away_ml numeric;
  v_open_home_ml numeric;
  v_open_away_ml numeric;
  v_clob jsonb := '{}'::jsonb;
  v_middle_window jsonb := '{}'::jsonb;
  v_trigger_window jsonb := '{}'::jsonb;
  v_signals jsonb := '{}'::jsonb;
  v_market_structure_as_of timestamptz;
  v_limit integer := LEAST(GREATEST(COALESCE(p_max_events, 10), 1), 25);
  v_leader_text text;
BEGIN
  IF p_match_id IS NULL OR btrim(p_match_id) = '' THEN
    RETURN jsonb_build_object(
      'error', 'missing_match_id',
      'message', 'match_id is required'
    );
  END IF;

  SELECT to_jsonb(m)
  INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
  LIMIT 1;

  IF v_match IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'match_not_found',
      'match_id', p_match_id,
      'answerability', jsonb_build_object(
        'can_answer_scoreboard', false,
        'can_answer_top_scorer', false,
        'can_answer_recent_events', false,
        'can_answer_market_movement', false
      )
    );
  END IF;

  SELECT to_jsonb(lgs)
  INTO v_state
  FROM public.live_game_state lgs
  WHERE lgs.id = p_match_id
  LIMIT 1;

  IF to_regclass('public.live_context_snapshots') IS NOT NULL THEN
    EXECUTE $q$
      SELECT to_jsonb(x)
      FROM (
        SELECT
          lcs.captured_at,
          lcs.period,
          lcs.clock,
          lcs.home_score,
          lcs.away_score,
          lcs.recent_plays,
          lcs.leaders,
          lcs.odds_current,
          lcs.situation
        FROM public.live_context_snapshots lcs
        WHERE lcs.match_id = $1
        ORDER BY lcs.captured_at DESC
        LIMIT 1
      ) x
    $q$
    INTO v_context
    USING p_match_id;

    IF v_context IS NULL THEN
      v_context := '{}'::jsonb;
    END IF;
  END IF;

  SELECT to_jsonb(pi)
  INTO v_pregame
  FROM public.pregame_intel pi
  WHERE pi.match_id = p_match_id
     OR pi.match_id = split_part(p_match_id, '_', 1)
  ORDER BY pi.generated_at DESC
  LIMIT 1;

  v_home_score := COALESCE(
    public.safe_to_numeric(v_context->>'home_score')::integer,
    public.safe_to_numeric(v_state->>'home_score')::integer,
    public.safe_to_numeric(v_match->>'home_score')::integer,
    0
  );

  v_away_score := COALESCE(
    public.safe_to_numeric(v_context->>'away_score')::integer,
    public.safe_to_numeric(v_state->>'away_score')::integer,
    public.safe_to_numeric(v_match->>'away_score')::integer,
    0
  );

  v_period := COALESCE(
    public.safe_to_numeric(v_context->>'period')::integer,
    public.safe_to_numeric(v_state->>'period')::integer,
    public.safe_to_numeric(v_match->>'period')::integer,
    0
  );

  v_clock := COALESCE(
    NULLIF(v_context->>'clock', ''),
    NULLIF(v_state->>'clock', ''),
    NULLIF(v_match->>'display_clock', ''),
    'N/A'
  );

  v_status := COALESCE(
    NULLIF(v_state->>'game_status', ''),
    NULLIF(v_match->>'status', ''),
    'UNKNOWN'
  );

  v_score_as_of := COALESCE(
    (v_context->>'captured_at')::timestamptz,
    (v_state->>'updated_at')::timestamptz,
    (v_match->>'last_updated')::timestamptz,
    (v_match->>'updated_at')::timestamptz
  );

  v_market_as_of := COALESCE(
    (v_match->>'last_odds_update')::timestamptz,
    (v_state->>'updated_at')::timestamptz,
    v_score_as_of
  );

  v_live_total := COALESCE(
    public.jsonb_first_numeric(v_context->'odds_current', ARRAY['total','overUnder','total_value']),
    public.jsonb_first_numeric(v_state->'odds', ARRAY['total','overUnder','total_value']),
    public.jsonb_first_numeric(v_match->'current_odds', ARRAY['total','overUnder','total_value'])
  );

  v_open_total := COALESCE(
    public.jsonb_first_numeric(v_match->'opening_odds', ARRAY['total','overUnder','total_value'])
  );

  IF v_live_total IS NOT NULL AND v_open_total IS NOT NULL THEN
    v_total_move := round(v_live_total - v_open_total, 2);
  ELSE
    v_total_move := NULL;
  END IF;

  v_live_spread := COALESCE(
    public.jsonb_first_numeric(v_context->'odds_current', ARRAY['homeSpread','spread','spread_home_value']),
    public.jsonb_first_numeric(v_state->'odds', ARRAY['homeSpread','spread','spread_home_value']),
    public.jsonb_first_numeric(v_match->'current_odds', ARRAY['homeSpread','spread','spread_home_value'])
  );

  v_open_spread := COALESCE(
    public.jsonb_first_numeric(v_match->'opening_odds', ARRAY['homeSpread','spread','spread_home_value'])
  );

  v_live_home_ml := COALESCE(
    public.jsonb_first_numeric(v_context->'odds_current', ARRAY['homeML','home_ml','moneylineHome','homeWin']),
    public.jsonb_first_numeric(v_state->'odds', ARRAY['homeML','home_ml','moneylineHome','homeWin']),
    public.jsonb_first_numeric(v_match->'current_odds', ARRAY['homeML','home_ml','moneylineHome','homeWin'])
  );

  v_live_away_ml := COALESCE(
    public.jsonb_first_numeric(v_context->'odds_current', ARRAY['awayML','away_ml','moneylineAway','awayWin']),
    public.jsonb_first_numeric(v_state->'odds', ARRAY['awayML','away_ml','moneylineAway','awayWin']),
    public.jsonb_first_numeric(v_match->'current_odds', ARRAY['awayML','away_ml','moneylineAway','awayWin'])
  );

  v_open_home_ml := COALESCE(
    public.jsonb_first_numeric(v_match->'opening_odds', ARRAY['homeML','home_ml','moneylineHome','homeWin'])
  );

  v_open_away_ml := COALESCE(
    public.jsonb_first_numeric(v_match->'opening_odds', ARRAY['awayML','away_ml','moneylineAway','awayWin'])
  );

  v_leaders := COALESCE(
    v_context->'leaders',
    v_state->'leaders',
    v_state->'player_stats'->'leaders',
    '{}'::jsonb
  );

  WITH base_plays AS (
    SELECT COALESCE(v_context->'recent_plays', v_state->'recent_plays', '[]'::jsonb) AS plays
  ), expanded AS (
    SELECT value, ordinality
    FROM base_plays, jsonb_array_elements(COALESCE(base_plays.plays, '[]'::jsonb)) WITH ORDINALITY
  ), recent AS (
    SELECT value, ordinality
    FROM expanded
    ORDER BY ordinality DESC
    LIMIT v_limit
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        't', COALESCE(value->>'clock', value->>'time', value->>'game_clock', 'N/A'),
        'text', COALESCE(value->>'text', value->>'detail', value->>'description', value::text),
        'type', COALESCE(value->>'type', value->>'event_type', 'play'),
        'team', COALESCE(value->>'team', value->>'team_abbr', value->>'abbreviation', 'N/A')
      )
      ORDER BY ordinality ASC
    ),
    '[]'::jsonb
  )
  INTO v_events
  FROM recent;

  v_trends := '[]'::jsonb;

  IF jsonb_typeof(v_match->'ai_signals') = 'array' THEN
    SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO v_trends
    FROM (
      SELECT jsonb_build_object(
        'label', COALESCE(value->>'label', value->>'headline', value->>'title', value->>'signal', 'Signal'),
        'value', COALESCE(value->>'value', value->>'summary', value->>'description', value->>'reason', 'Active'),
        'source', 'matches.ai_signals'
      ) AS row_data
      FROM jsonb_array_elements(v_match->'ai_signals')
      LIMIT 3
    ) src;
  END IF;

  IF v_pregame IS NOT NULL AND jsonb_typeof(v_pregame->'cards') = 'array' THEN
    SELECT COALESCE(v_trends, '[]'::jsonb) || COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO v_trends
    FROM (
      SELECT jsonb_build_object(
        'label', COALESCE(value->>'title', value->>'type', 'Pregame Intel'),
        'value', COALESCE(value->>'description', value->>'summary', value->>'angle', 'Context signal'),
        'source', 'pregame_intel.cards'
      ) AS row_data
      FROM jsonb_array_elements(v_pregame->'cards')
      LIMIT 3
    ) src;

    v_trend_as_of := COALESCE((v_pregame->>'generated_at')::timestamptz, v_score_as_of);
  ELSE
    v_trend_as_of := v_score_as_of;
  END IF;

  v_signals := COALESCE(v_state->'deterministic_signals', '{}'::jsonb);

  IF to_regclass('public.v_clob_repricing_delta') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'market_ticker', c.market_ticker,
      'line_value', c.line_value,
      'open_book_implied_prob', c.open_book_implied_prob,
      'first_clob_prob', c.first_clob_prob,
      'latest_clob_prob', c.latest_clob_prob,
      'delta_open_to_latest', c.delta_open_to_latest,
      'coverage_grade', c.coverage_grade,
      'snapshot_count', c.snapshot_count,
      'as_of', c.latest_snapshot_ts
    )
    INTO v_clob
    FROM public.v_clob_repricing_delta c
    WHERE c.match_id = p_match_id
    ORDER BY
      CASE WHEN COALESCE(c.is_dk_anchor_line, false) THEN 0 ELSE 1 END,
      c.snapshot_count DESC NULLS LAST,
      c.latest_snapshot_ts DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF to_regclass('public.mv_middle_windows') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'pregame_anchor_total', mw.pregame_anchor_total,
      'min_live_total', mw.min_live_total,
      'max_live_total', mw.max_live_total,
      'max_live_deviation', mw.max_live_deviation,
      'has_6pt_middle_window', mw.has_6pt_middle_window,
      'has_10pt_middle_window', mw.has_10pt_middle_window,
      'final_inside_implied_window', mw.final_inside_implied_window,
      'as_of', mw.last_live_ts
    )
    INTO v_middle_window
    FROM public.mv_middle_windows mw
    WHERE mw.match_id = p_match_id
    LIMIT 1;
  END IF;

  IF to_regclass('public.v_trigger_hedge_windows') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'trigger_type', th.trigger_type,
      'trigger_ts', th.trigger_ts,
      'trigger_prob', th.total_over_prob,
      'hedge_live_total', th.hedge_live_total,
      'corridor_width_points', th.corridor_width_points,
      'nearest_live_quote_found', th.nearest_live_quote_found,
      'corridor_observed', th.corridor_observed,
      'final_inside_corridor', th.final_inside_corridor,
      'as_of', th.live_snapshot_ts
    )
    INTO v_trigger_window
    FROM public.v_trigger_hedge_windows th
    WHERE th.match_id = p_match_id
    ORDER BY th.trigger_ts DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_clob <> '{}'::jsonb THEN
    v_market_structure_as_of := GREATEST(
      COALESCE(v_market_structure_as_of, '-infinity'::timestamptz),
      COALESCE((v_clob->>'as_of')::timestamptz, '-infinity'::timestamptz)
    );

    v_trends := COALESCE(v_trends, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'label', 'Market Repricing',
        'value', format(
          'Kalshi moved %s from open probability (%s coverage).',
          CASE
            WHEN public.safe_to_numeric(v_clob->>'delta_open_to_latest') >= 0
              THEN '+' || COALESCE(v_clob->>'delta_open_to_latest', '0')
            ELSE COALESCE(v_clob->>'delta_open_to_latest', '0')
          END,
          COALESCE(v_clob->>'coverage_grade', 'unknown')
        ),
        'source', 'v_clob_repricing_delta'
      )
    );
  END IF;

  IF v_trigger_window <> '{}'::jsonb THEN
    v_market_structure_as_of := GREATEST(
      COALESCE(v_market_structure_as_of, '-infinity'::timestamptz),
      COALESCE((v_trigger_window->>'as_of')::timestamptz, '-infinity'::timestamptz)
    );

    v_trends := COALESCE(v_trends, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'label', 'Live Corridor',
        'value', format(
          'Trigger %s with corridor width %s points.',
          COALESCE(v_trigger_window->>'trigger_type', 'none'),
          COALESCE(v_trigger_window->>'corridor_width_points', '0')
        ),
        'source', 'v_trigger_hedge_windows'
      )
    );
  END IF;

  IF v_middle_window <> '{}'::jsonb THEN
    v_market_structure_as_of := GREATEST(
      COALESCE(v_market_structure_as_of, '-infinity'::timestamptz),
      COALESCE((v_middle_window->>'as_of')::timestamptz, '-infinity'::timestamptz)
    );

    v_trends := COALESCE(v_trends, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'label', 'Middle Window',
        'value', format(
          'Max live deviation %s points (6pt window: %s).',
          COALESCE(v_middle_window->>'max_live_deviation', '0'),
          COALESCE(v_middle_window->>'has_6pt_middle_window', 'false')
        ),
        'source', 'mv_middle_windows'
      )
    );
  END IF;

  v_leader_text := lower(COALESCE(v_leaders::text, ''));

  v_answerability := jsonb_build_object(
    'can_answer_scoreboard', (v_home_score IS NOT NULL AND v_away_score IS NOT NULL),
    'can_answer_top_scorer',
      (
        v_leaders <> '{}'::jsonb
        AND (
          CASE WHEN jsonb_typeof(v_leaders->'home') = 'array' THEN jsonb_array_length(v_leaders->'home') ELSE 0 END > 0
          OR CASE WHEN jsonb_typeof(v_leaders->'away') = 'array' THEN jsonb_array_length(v_leaders->'away') ELSE 0 END > 0
          OR CASE WHEN jsonb_typeof(v_leaders->'home_leaders') = 'array' THEN jsonb_array_length(v_leaders->'home_leaders') ELSE 0 END > 0
          OR CASE WHEN jsonb_typeof(v_leaders->'away_leaders') = 'array' THEN jsonb_array_length(v_leaders->'away_leaders') ELSE 0 END > 0
        )
      ),
    'can_answer_rebounds_leader',
      (
        v_leaders <> '{}'::jsonb
        AND (
          v_leader_text LIKE '%rebound%'
          OR v_leader_text LIKE '%reb%'
          OR v_leader_text LIKE '%boards%'
        )
      ),
    'can_answer_assists_leader',
      (
        v_leaders <> '{}'::jsonb
        AND (
          v_leader_text LIKE '%assist%'
          OR v_leader_text LIKE '%ast%'
        )
      ),
    'can_answer_recent_events', (jsonb_array_length(COALESCE(v_events, '[]'::jsonb)) > 0),
    'can_answer_market_movement', (v_live_total IS NOT NULL OR v_live_spread IS NOT NULL)
  );

  v_as_of := GREATEST(
    COALESCE(v_score_as_of, '-infinity'::timestamptz),
    COALESCE(v_market_as_of, '-infinity'::timestamptz),
    COALESCE(v_market_structure_as_of, '-infinity'::timestamptz),
    COALESCE(v_trend_as_of, '-infinity'::timestamptz)
  );

  IF v_as_of = '-infinity'::timestamptz THEN
    v_as_of := NULL;
  END IF;

  v_freshness_seconds := CASE
    WHEN v_as_of IS NULL THEN NULL
    ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - v_as_of)))::integer)
  END;

  v_provenance := jsonb_build_array(
    jsonb_build_object('block', 'scoreboard', 'source', CASE WHEN v_context <> '{}'::jsonb THEN 'live_context_snapshots' WHEN v_state IS NOT NULL THEN 'live_game_state' ELSE 'matches' END, 'as_of', v_score_as_of),
    jsonb_build_object('block', 'leaders', 'source', CASE WHEN v_context->'leaders' IS NOT NULL THEN 'live_context_snapshots.leaders' WHEN v_state->'leaders' IS NOT NULL THEN 'live_game_state.leaders' ELSE 'live_game_state.player_stats' END, 'as_of', v_score_as_of),
    jsonb_build_object('block', 'events', 'source', CASE WHEN v_context->'recent_plays' IS NOT NULL THEN 'live_context_snapshots.recent_plays' ELSE 'live_game_state.recent_plays' END, 'as_of', v_score_as_of),
    jsonb_build_object('block', 'market', 'source', 'matches.current_odds/opening_odds', 'as_of', v_market_as_of),
    jsonb_build_object('block', 'market_structure', 'source', 'v_clob_repricing_delta + mv_middle_windows + v_trigger_hedge_windows', 'as_of', v_market_structure_as_of),
    jsonb_build_object('block', 'trends', 'source', CASE WHEN v_pregame IS NOT NULL THEN 'matches.ai_signals + pregame_intel.cards' ELSE 'matches.ai_signals' END, 'as_of', v_trend_as_of)
  );

  RETURN jsonb_build_object(
    'match', jsonb_build_object(
      'id', p_match_id,
      'league', COALESCE(v_match->>'league_id', v_match->>'leagueId'),
      'sport', v_match->>'sport',
      'status', v_status,
      'home_team', COALESCE(v_match->>'home_team', v_match->'homeTeam'->>'name'),
      'away_team', COALESCE(v_match->>'away_team', v_match->'awayTeam'->>'name')
    ),
    'scoreboard', jsonb_build_object(
      'home', v_home_score,
      'away', v_away_score,
      'period', v_period,
      'clock', v_clock,
      'status', v_status,
      'as_of', v_score_as_of,
      'freshness_seconds', CASE WHEN v_score_as_of IS NULL THEN NULL ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - v_score_as_of)))::integer) END,
      'source', CASE WHEN v_context <> '{}'::jsonb THEN 'live_context_snapshots' WHEN v_state IS NOT NULL THEN 'live_game_state' ELSE 'matches' END
    ),
    'leaders', jsonb_build_object(
      'home', COALESCE(v_leaders->'home', v_leaders->'home_leaders', '[]'::jsonb),
      'away', COALESCE(v_leaders->'away', v_leaders->'away_leaders', '[]'::jsonb),
      'raw', v_leaders,
      'as_of', v_score_as_of,
      'can_answer_top_scorer', (v_answerability->>'can_answer_top_scorer')::boolean,
      'can_answer_rebounds_leader', (v_answerability->>'can_answer_rebounds_leader')::boolean,
      'can_answer_assists_leader', (v_answerability->>'can_answer_assists_leader')::boolean,
      'source', CASE WHEN v_context->'leaders' IS NOT NULL THEN 'live_context_snapshots' ELSE 'live_game_state' END
    ),
    'market', jsonb_build_object(
      'live_total', v_live_total,
      'open_total', v_open_total,
      'movement_total', v_total_move,
      'live_spread_home', v_live_spread,
      'open_spread_home', v_open_spread,
      'live_home_ml', v_live_home_ml,
      'live_away_ml', v_live_away_ml,
      'open_home_ml', v_open_home_ml,
      'open_away_ml', v_open_away_ml,
      'as_of', v_market_as_of,
      'freshness_seconds', CASE WHEN v_market_as_of IS NULL THEN NULL ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - v_market_as_of)))::integer) END,
      'source', 'matches.current_odds/opening_odds'
    ),
    'market_structure', jsonb_build_object(
      'clob_repricing', NULLIF(v_clob, '{}'::jsonb),
      'middle_window', NULLIF(v_middle_window, '{}'::jsonb),
      'trigger_window', NULLIF(v_trigger_window, '{}'::jsonb),
      'as_of', v_market_structure_as_of
    ),
    'events', COALESCE(v_events, '[]'::jsonb),
    'trends', COALESCE(v_trends, '[]'::jsonb),
    'edge_signals', jsonb_build_object(
      'deterministic', COALESCE(v_signals, '{}'::jsonb),
      'pregame_headline', COALESCE(v_pregame->>'headline', NULL),
      'pregame_briefing', COALESCE(v_pregame->>'briefing', NULL)
    ),
    'answerability', v_answerability,
    'packet_meta', jsonb_build_object(
      'as_of', v_as_of,
      'freshness_seconds', v_freshness_seconds,
      'requested_events', v_limit
    ),
    'provenance', v_provenance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_match_packet(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_match_packet(text, integer) TO service_role;

CREATE OR REPLACE VIEW public.v_ai_tool_alerts AS
SELECT
  tool_name,
  match_id,
  question_type,
  created_at,
  packet_freshness_seconds,
  missing_fields,
  latency_ms,
  success,
  error,
  CASE
    WHEN packet_freshness_seconds IS NOT NULL AND packet_freshness_seconds > 60 THEN 'STALE_PACKET'
    WHEN COALESCE(array_length(missing_fields, 1), 0) > 0 THEN 'MISSING_CORE_FIELDS'
    WHEN success = false THEN 'TOOL_FAILURE'
    ELSE 'OK'
  END AS alert_reason
FROM public.ai_tool_logs
WHERE created_at >= now() - interval '24 hours';

GRANT SELECT ON public.v_ai_tool_alerts TO service_role;
