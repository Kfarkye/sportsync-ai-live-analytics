
-- Check what's actually in the matches table
SELECT 
    id, 
    league_id, 
    home_team, 
    away_team, 
    start_time, 
    status,
    odds_api_event_id
FROM matches
ORDER BY start_time ASC;

-- Check if any market_feeds records matched to a match_id
SELECT count(*) FROM matches WHERE odds_api_event_id IS NOT NULL;
