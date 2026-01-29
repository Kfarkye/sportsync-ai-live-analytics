UPDATE pregame_intel 
SET pick_result = 'PENDING' 
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH') 
  AND (
    -- 1. Fake Underdogs (+0 / PK / Draw No Bet)
    (recommended_pick ~ '\+0(\.0)?([^0-9]|$)' OR recommended_pick ILIKE '%PK%' OR recommended_pick ILIKE '%Draw No Bet%')
    OR
    -- 2. Misclassified Moneyline
    ((grading_metadata->>'type' = 'SPREAD' OR grading_metadata->>'type' IS NULL) 
     AND (recommended_pick ILIKE '%moneyline%' OR recommended_pick ILIKE '%ml%' OR recommended_pick ILIKE '%ml %'))
    OR
    -- 3. Odds in Spread
    ((grading_metadata->>'type' = 'SPREAD' OR grading_metadata->>'type' IS NULL) 
     AND recommended_pick ~ ' [+-][1-9][0-9][0-9]'
     AND recommended_pick NOT LIKE '%+1.5%' 
     AND recommended_pick NOT LIKE '%-1.5%'
     AND recommended_pick NOT LIKE '%+2.5%'
     AND recommended_pick NOT LIKE '%-2.5%')
  );
