-- 📊 COMPREHENSIVE PICK PERFORMANCE ANALYSIS 📊

-- 📊 1. SUMMARY BY SPORT 📊
WITH graded_picks AS (
    SELECT 
        match_id,
        pick_result,
        game_date,
        CASE 
            WHEN match_id LIKE '%_ncaab%' THEN 'CBB'
            WHEN match_id LIKE '%_nba%' THEN 'NBA'
            WHEN match_id LIKE '%_nhl%' THEN 'NHL'
            WHEN match_id LIKE '%_tennis%' THEN 'Tennis'
            WHEN match_id LIKE '%_epl%' OR match_id LIKE '%_seriea%' OR match_id LIKE '%_bundesliga%' OR match_id LIKE '%_ligue1%' OR match_id LIKE '%_afcon%' THEN 'Soccer'
            ELSE 'Other'
        END as sport
    FROM pregame_intel
    WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
)
SELECT 
    sport,
    COUNT(*) as total_picks,
    SUM(CASE WHEN pick_result = 'WIN' THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN pick_result = 'LOSS' THEN 1 ELSE 0 END) as losses,
    SUM(CASE WHEN pick_result = 'PUSH' THEN 1 ELSE 0 END) as pushes,
    ROUND((SUM(CASE WHEN pick_result = 'WIN' THEN 1.0 ELSE 0 END) / NULLIF(COUNT(*) - SUM(CASE WHEN pick_result = 'PUSH' THEN 1 ELSE 0 END), 0)) * 100, 2) || '%' as win_rate
FROM graded_picks
GROUP BY sport
ORDER BY total_picks DESC;


-- 📊 2. RECENT TRENDS (LAST 7 DAYS) 📊
WITH graded_picks AS (
    SELECT pick_result, game_date
    FROM pregame_intel
    WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
)
SELECT 
    game_date as pick_date,
    COUNT(*) as daily_volume,
    SUM(CASE WHEN pick_result = 'WIN' THEN 1 ELSE 0 END) as wins,
    ROUND((SUM(CASE WHEN pick_result = 'WIN' THEN 1.0 ELSE 0 END) / NULLIF(COUNT(*) - SUM(CASE WHEN pick_result = 'PUSH' THEN 1 ELSE 0 END), 0)) * 100, 2) || '%' as daily_win_rate
FROM graded_picks
GROUP BY game_date
ORDER BY pick_date DESC
LIMIT 7;


-- 📊 3. HOME vs AWAY PERFORMANCE 📊
WITH graded_picks AS (
    SELECT 
        pick_result,
        COALESCE(grading_metadata->>'side', 
            CASE 
                WHEN recommended_pick ILIKE '%over%' THEN 'OVER'
                WHEN recommended_pick ILIKE '%under%' THEN 'UNDER'
                ELSE 'SPREAD/ML'
            END
        ) as side
    FROM pregame_intel
    WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
)
SELECT 
    side,
    COUNT(*) as count,
    ROUND((SUM(CASE WHEN pick_result = 'WIN' THEN 1.0 ELSE 0 END) / NULLIF(COUNT(*) - SUM(CASE WHEN pick_result = 'PUSH' THEN 1 ELSE 0 END), 0)) * 100, 2) || '%' as win_rate
FROM graded_picks
WHERE side IN ('HOME', 'AWAY')
GROUP BY side;
