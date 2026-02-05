-- ===============================================================
-- VALIDATION: Pregame Intel Pipeline
-- Run this to verify if the AI Cron is populating the cache
-- ===============================================================

-- 1. Check for ANY intel generated in the last 2 hours
-- This confirms the cron is running and writing to DB
SELECT 
    match_id,
    home_team || ' vs ' || away_team as matchup,
    headline, 
    jsonb_array_length(cards) as card_count,
    generated_at,
    ROUND(EXTRACT(EPOCH FROM (NOW() - generated_at))/60) as "minutes_ago"
FROM pregame_intel
WHERE generated_at > (NOW() - INTERVAL '2 hours')
ORDER BY generated_at DESC;

-- 2. Coverage Check for TODAY's Games
-- Shows which upcoming games have intel ready
SELECT 
    m.start_time,
    m.home_team, 
    m.away_team, 
    CASE 
        WHEN p.match_id IS NOT NULL THEN '✅ READY' 
        ELSE '⚠️ WAITING' 
    END as cache_status
FROM matches m
LEFT JOIN pregame_intel p ON m.id = p.match_id
WHERE m.start_time BETWEEN NOW() AND (NOW() + INTERVAL '24 hours')
ORDER BY m.start_time ASC;
