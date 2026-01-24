-- Fix timezone mismatch: Worker uses UTC-7 (PST), view was using EST
-- Align view to America/Los_Angeles (PST/PDT) to match worker

DROP VIEW IF EXISTS pick_today_detail;

CREATE OR REPLACE VIEW pick_today_detail AS
WITH daily_picks AS (
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
    WHERE game_date = (NOW() AT TIME ZONE 'America/Los_Angeles')::date
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
    CASE pick_result 
        WHEN 'WIN' THEN 1 
        WHEN 'PENDING' THEN 2
        WHEN 'PUSH' THEN 3
        WHEN 'LOSS' THEN 4
        ELSE 5 
    END ASC;

GRANT SELECT ON pick_today_detail TO anon, authenticated;
