
-- Auto-score function: run after games finish to update the log
CREATE OR REPLACE FUNCTION auto_score_entry_signals(p_date date DEFAULT CURRENT_DATE - 1)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE entry_signals_log esl
  SET 
    final_total = m.home_score + m.away_score,
    vs_dk_total = (m.home_score + m.away_score) - esl.dk_total,
    signal_correct = CASE 
      WHEN esl.entry_direction = 'UNDER' AND (m.home_score + m.away_score) < esl.dk_total THEN true
      WHEN esl.entry_direction = 'OVER' AND (m.home_score + m.away_score) > esl.dk_total THEN true
      WHEN esl.entry_direction IS NULL THEN null
      ELSE false
    END,
    scored_at = now()
  FROM matches m
  WHERE m.id = esl.match_id
  AND esl.game_date = p_date
  AND m.status = 'STATUS_FINAL'
  AND esl.scored_at IS NULL;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
;
