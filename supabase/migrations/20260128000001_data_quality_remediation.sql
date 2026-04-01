-- ============================================
-- DATA QUALITY REMEDIATION MIGRATION
-- Run this in Supabase SQL Editor
-- ============================================

-- STEP 1: Add data_quality_status column
ALTER TABLE pregame_intel 
ADD COLUMN IF NOT EXISTS data_quality_status VARCHAR(20) DEFAULT 'VALID';

-- STEP 2: Quarantine polluted picks
UPDATE pregame_intel 
SET data_quality_status = 'QUARANTINED'
WHERE data_quality_status != 'QUARANTINED' AND (
    -- Fake Dogs (+0 / -0)
    recommended_pick LIKE '%+0%' 
    OR recommended_pick LIKE '%-0%'
    -- Pick'ems / Draw No Bet
    OR recommended_pick ILIKE '%PK%' 
    OR recommended_pick ILIKE '%Draw No Bet%'
    OR recommended_pick ILIKE '%DNB%'
    -- Misclassified Moneylines (text says ML but type is SPREAD)
    OR (recommended_pick ILIKE '%Moneyline%' AND grading_metadata->>'type' = 'SPREAD')
    OR (recommended_pick ILIKE '%ML%' AND grading_metadata->>'type' = 'SPREAD')
    -- Odds in text (e.g. (+125), (-110))
    OR recommended_pick ~ '\([+-][1-9][0-9][0-9]\)'
);

-- STEP 3: Create clean_picks view for analytics
CREATE OR REPLACE VIEW clean_picks AS
SELECT * FROM pregame_intel
WHERE data_quality_status = 'VALID'
  AND pick_result IN ('WIN', 'LOSS', 'PUSH');

-- STEP 4: Verify results
SELECT 
    data_quality_status, 
    count(*) as count 
FROM pregame_intel 
GROUP BY data_quality_status
ORDER BY count DESC;
