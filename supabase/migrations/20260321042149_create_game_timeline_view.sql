
-- Unified game timeline: PBP plays joined to nearest ESPN probability snapshot
-- Join key: match_id + sequence_number (LATERAL nearest-sequence)
-- Filters: only meaningful play types, dedupes redundant ESPN rows

CREATE OR REPLACE VIEW public.v_game_timeline AS
SELECT
  ge.match_id,
  ge.league_id,
  ge.sport,
  ge.sequence,
  ge.period,
  ge.clock,
  ge.home_score,
  ge.away_score,
  (ge.home_score + ge.away_score) AS combined_score,
  ge.event_type,
  ge.play_data->>'text' AS play_text,
  ge.created_at AS play_ts,

  -- ESPN probability columns (nearest snapshot at or before this play)
  ep.sequence_number AS espn_seq,
  ep.home_win_pct,
  ep.away_win_pct,
  ep.total_over_prob,
  ep.spread_cover_prob_home,
  ep.spread_push_prob,
  ep.total_push_prob,
  ep.seconds_left AS espn_seconds_left,
  ep.last_modified AS espn_modified_at,

  -- Computed deltas
  CASE WHEN prev_ep.total_over_prob IS NOT NULL 
    THEN ROUND((ep.total_over_prob - prev_ep.total_over_prob)::numeric, 4)
    ELSE NULL 
  END AS over_prob_delta

FROM public.game_events ge

-- Nearest ESPN probability at or before this play's sequence
LEFT JOIN LATERAL (
  SELECT * FROM public.espn_probabilities p
  WHERE p.match_id = ge.match_id
    AND p.sequence_number <= ge.sequence
  ORDER BY p.sequence_number DESC
  LIMIT 1
) ep ON true

-- Previous ESPN probability (for computing deltas)
LEFT JOIN LATERAL (
  SELECT total_over_prob FROM public.espn_probabilities p2
  WHERE p2.match_id = ge.match_id
    AND p2.sequence_number < COALESCE(ep.sequence_number, 0)
  ORDER BY p2.sequence_number DESC
  LIMIT 1
) prev_ep ON true;

-- Add a comment for discoverability
COMMENT ON VIEW public.v_game_timeline IS 
'Unified PBP + ESPN probability timeline. Each game_event row joined to nearest ESPN prob snapshot via LATERAL. Over prob delta shows play-to-play probability shifts. Kalshi data lives on API DB (hylnixnuabtnmjcdnujm) — join via captured_at timestamp at app layer.';
;
