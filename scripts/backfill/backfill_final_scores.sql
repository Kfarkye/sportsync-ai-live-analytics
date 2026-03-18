-- ============================================================================
-- BACKFILL FINAL SCORES FROM MATCHES TABLE
-- ============================================================================
-- PURPOSE: Populate final_home_score and final_away_score for historical picks
--          that were graded before the migration added these columns.
-- 
-- RUN THIS IN: Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================================

-- Step 1: Preview what will be updated (DRY RUN)
SELECT 
    pi.intel_id,
    pi.match_id,
    pi.home_team,
    pi.away_team,
    pi.pick_result,
    pi.final_home_score AS current_home,
    pi.final_away_score AS current_away,
    m.home_score AS match_home,
    m.away_score AS match_away
FROM pregame_intel pi
JOIN matches m ON m.id = pi.match_id
WHERE pi.pick_result IN ('WIN', 'LOSS', 'PUSH')
  AND pi.final_home_score IS NULL
  AND m.home_score IS NOT NULL
  AND m.away_score IS NOT NULL
  AND m.status IN ('FINAL', 'STATUS_FINAL', 'STATUS_FULL_TIME', 'post')
LIMIT 50;

-- ============================================================================
-- Step 2: Run the actual update (UNCOMMENT TO EXECUTE)
-- ============================================================================

/*
UPDATE pregame_intel pi
SET 
    final_home_score = m.home_score,
    final_away_score = m.away_score
FROM matches m
WHERE m.id = pi.match_id
  AND pi.pick_result IN ('WIN', 'LOSS', 'PUSH')
  AND pi.final_home_score IS NULL
  AND m.home_score IS NOT NULL
  AND m.away_score IS NOT NULL
  AND m.status IN ('FINAL', 'STATUS_FINAL', 'STATUS_FULL_TIME', 'post');
*/

-- After running, check results with:
-- SELECT COUNT(*) FROM pregame_intel WHERE final_home_score IS NOT NULL;
