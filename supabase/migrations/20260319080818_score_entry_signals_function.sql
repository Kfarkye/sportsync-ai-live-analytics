
CREATE OR REPLACE FUNCTION score_entry_signals(p_date date DEFAULT CURRENT_DATE - 1)
RETURNS TABLE (
  game text,
  entry_signal text,
  entry_direction text,
  confidence text,
  dk_total numeric,
  dk_shade numeric,
  final_total numeric,
  vs_dk numeric,
  signal_correct boolean,
  reasoning text
) LANGUAGE sql STABLE AS $$
  SELECT 
    esl.home_team || ' vs ' || esl.away_team,
    esl.entry_signal,
    esl.entry_direction,
    esl.confidence,
    esl.dk_total,
    esl.dk_shade,
    (m.home_score + m.away_score)::numeric,
    ((m.home_score + m.away_score) - esl.dk_total)::numeric,
    CASE 
      WHEN esl.entry_direction = 'UNDER' AND (m.home_score + m.away_score) < esl.dk_total THEN true
      WHEN esl.entry_direction = 'OVER' AND (m.home_score + m.away_score) > esl.dk_total THEN true
      WHEN esl.entry_direction IS NULL THEN null
      ELSE false
    END,
    esl.reasoning
  FROM entry_signals_log esl
  JOIN matches m ON m.id = esl.match_id
  WHERE esl.game_date = p_date
  AND m.status = 'STATUS_FINAL'
  ORDER BY esl.dk_shade DESC;
$$;
;
