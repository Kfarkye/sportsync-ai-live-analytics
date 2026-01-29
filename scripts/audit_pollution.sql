-- 🚨 DATA POLLUTION AUDIT QUERY 🚨
SELECT 
    CASE 
        -- 1. Fake Underdogs: +0, PK, Draw No Bet (should be Pick'em, not Dog)
        WHEN recommended_pick ~ '\+0(\.0)?([^0-9]|$)' OR recommended_pick ILIKE '%PK%' OR recommended_pick ILIKE '%Draw No Bet%' THEN 'FAKE_DOG_PK'
        
        -- 2. Misclassified Moneyline: Text says "Moneyline" but Type says "SPREAD"
        WHEN (grading_metadata->>'type' = 'SPREAD' OR grading_metadata->>'type' IS NULL) 
             AND (recommended_pick ILIKE '%moneyline%' OR recommended_pick ILIKE '%ml%' OR recommended_pick ILIKE '%ml %') THEN 'MISCLASSIFIED_ML'
        
        -- 3. Odds in Spread: Text looks like "-115" (odds) but treated as spread
        WHEN (grading_metadata->>'type' = 'SPREAD' OR grading_metadata->>'type' IS NULL) 
             AND recommended_pick ~ ' [+-][1-9][0-9][0-9]' -- Matches " -115", " +200"
             AND recommended_pick NOT LIKE '%+1.5%' -- Exclude valid pucklines like +1.5
             AND recommended_pick NOT LIKE '%-1.5%'
             AND recommended_pick NOT LIKE '%+2.5%' 
             AND recommended_pick NOT LIKE '%-2.5%' THEN 'ODDS_IN_SPREAD'

        ELSE 'CLEAN'
    END as pollution_type,
    COUNT(*) as count,
    MIN(game_date) as first_occurrence,
    MAX(game_date) as last_occurrence,
    -- Sample pick to verify
    (ARRAY_AGG(recommended_pick))[1] as sample_pick,
    (ARRAY_AGG(match_id))[1] as sample_match_id
FROM pregame_intel
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
GROUP BY pollution_type
ORDER BY count DESC;
