-- OPTIMIZED pick_today_detail view
-- 1. Index-friendly date filter
-- 2. Null-safe string concatenation
-- 3. Explicit sort order for UI priority

DROP VIEW IF EXISTS pick_today_detail;

CREATE OR REPLACE VIEW pick_today_detail AS
WITH daily_picks AS (
    -- Use CTE to filter early, allowing Postgres to use idx_pregame_intel_performance
    SELECT 
        match_id,
        sport,
        home_team,
        away_team,
        recommended_pick,
        analyzed_spread,
        actual_home_score,
        actual_away_score,
        pick_result
    FROM pregame_intel
    WHERE game_date = (NOW() AT TIME ZONE 'America/New_York')::date
      AND pick_result IS NOT NULL
)
SELECT 
    match_id,
    sport,
    CONCAT(COALESCE(away_team, 'TBD'), ' @ ', COALESCE(home_team, 'TBD')) as matchup,
    recommended_pick,
    analyzed_spread,
    CONCAT(COALESCE(actual_away_score::text, '?'), '-', COALESCE(actual_home_score::text, '?')) as score,
    pick_result
FROM daily_picks
ORDER BY 
    -- Custom sort: Graded winners first, then pendings, then others
    CASE pick_result 
        WHEN 'WIN' THEN 1 
        WHEN 'PENDING' THEN 2
        WHEN 'PUSH' THEN 3
        WHEN 'LOSS' THEN 4
        ELSE 5 
    END ASC;

GRANT SELECT ON pick_today_detail TO anon, authenticated;
