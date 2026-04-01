-- Comprehensive Performance Analysis Query
WITH metrics AS (
    SELECT 
        match_id,
        pick_result,
        -- Extract Sport
        CASE 
            WHEN match_id LIKE '%_ncaab%' THEN 'CBB'
            WHEN match_id LIKE '%_nba%' THEN 'NBA'
            WHEN match_id LIKE '%_epl%' OR match_id LIKE '%_seriea%' OR match_id LIKE '%_bundesliga%' OR match_id LIKE '%_ligue1%' OR match_id LIKE '%_afcon%' THEN 'Soccer'
            ELSE 'Other'
        END as sport,
        -- Extract Side (Home/Away) from metadata or recommendation text
        CASE 
            WHEN grading_metadata->>'side' IS NOT NULL THEN grading_metadata->>'side'
            WHEN recommended_pick ILIKE '%over%' THEN 'OVER'
            WHEN recommended_pick ILIKE '%under%' THEN 'UNDER'
            ELSE 'UNKNOWN'
        END as side,
        -- Extract Bet Type (Spread vs Moneyline inferred)
        CASE 
            WHEN recommended_pick ~ '[+-][0-9]+\.?[0-9]*' THEN 'Spread'
            ELSE 'Moneyline'
        END as bet_type,
        -- Date for trend analysis
        DATE(created_at) as pick_date
    FROM pregame_intel
    WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
)
SELECT 
    sport,
    COUNT(*) as total_picks,
    SUM(CASE WHEN pick_result = 'WIN' THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN pick_result = 'LOSS' THEN 1 ELSE 0 END) as losses,
    SUM(CASE WHEN pick_result = 'PUSH' THEN 1 ELSE 0 END) as pushes,
    ROUND((SUM(CASE WHEN pick_result = 'WIN' THEN 1.0 ELSE 0 END) / NULLIF(COUNT(*) - SUM(CASE WHEN pick_result = 'PUSH' THEN 1 ELSE 0 END), 0)) * 100, 2) as win_rate_pct,
    -- Side Analysis
    SUM(CASE WHEN side = 'HOME' AND pick_result = 'WIN' THEN 1 ELSE 0 END) as home_wins,
    SUM(CASE WHEN side = 'AWAY' AND pick_result = 'WIN' THEN 1 ELSE 0 END) as away_wins
FROM metrics
GROUP BY sport
ORDER BY total_picks DESC;
