-- DATA QUALITY NORMALIZATION SCRIPT
-- Run this in Supabase SQL Editor to fix sport fragmentation

-- Step 1: Normalize the sport column based on league_id (highest fidelity)
UPDATE pregame_intel 
SET sport = CASE
    -- Soccer (including mislabeled ones)
    WHEN league_id IN ('ita.1', 'ger.1', 'fra.1', 'eng.1', 'esp.1', 'bundesliga', 'laliga', 'ligue1', 'uefa.champions', 'uel', 'caf.nations') THEN 'soccer'
    WHEN LOWER(sport) = 'soccer' THEN 'soccer'
    
    -- Basketball
    WHEN league_id IN ('nba', 'wnba') THEN 'nba'
    WHEN league_id = 'mens-college-basketball' THEN 'college_basketball'
    WHEN LOWER(sport) = 'nba' THEN 'nba'
    WHEN LOWER(sport) IN ('basketball', 'college_basketball') AND league_id = 'nba' THEN 'nba'
    WHEN LOWER(sport) IN ('basketball', 'college_basketball') THEN 'college_basketball'
    
    -- Hockey
    WHEN league_id = 'nhl' THEN 'hockey'
    WHEN LOWER(sport) IN ('hockey', 'nhl') THEN 'hockey'
    
    -- Football
    WHEN league_id IN ('nfl') THEN 'nfl'
    WHEN league_id = 'college-football' THEN 'college_football'
    WHEN LOWER(sport) IN ('nfl', 'football') AND league_id = 'nfl' THEN 'nfl'
    WHEN LOWER(sport) IN ('football', 'college_football') THEN 'college_football'

    -- Cleanup
    WHEN sport = 'SYSTEM' THEN 'unknown'
    ELSE LOWER(COALESCE(sport, 'unknown'))
END;

-- Step 2: Update the reporting view with clean display names
CREATE OR REPLACE VIEW pick_record_by_sport AS
SELECT 
    CASE 
        WHEN sport = 'nba' THEN 'NBA'
        WHEN sport = 'college_basketball' THEN 'College Basketball'
        WHEN sport = 'hockey' THEN 'NHL'
        WHEN sport = 'nfl' THEN 'NFL'
        WHEN sport = 'college_football' THEN 'College Football'
        WHEN sport = 'soccer' THEN 'Soccer'
        ELSE INITCAP(sport)
    END as sport,
    COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
    COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes,
    ROUND(100.0 * COUNT(*) FILTER (WHERE pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0), 1) as win_pct
FROM pregame_intel
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
GROUP BY 1
ORDER BY (COUNT(*) FILTER (WHERE pick_result = 'WIN') + COUNT(*) FILTER (WHERE pick_result = 'LOSS')) DESC;

-- Step 3: Verify the fix
SELECT * FROM pick_record_by_sport;
