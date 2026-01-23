-- Check for any recent errors in the net extension
SELECT 
    r.id,
    r.status,
    q.url,
    r.error_msg,
    q.created_at
FROM net.http_request_queue q
JOIN net.http_responses r ON q.id = r.id
ORDER BY q.created_at DESC
LIMIT 20;

-- Check if any pregame_intel exists at all
SELECT count(*) FROM pregame_intel;

-- Check if any player_prop_bets exist at all
SELECT count(*) FROM player_prop_bets;

-- Check for the specific matches that are linked
SELECT id, home_team, away_team, odds_api_event_id, league_id 
FROM matches 
WHERE odds_api_event_id IS NOT NULL 
LIMIT 5;
