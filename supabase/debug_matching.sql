-- Check a few matches without Odds IDs
SELECT home_team, away_team, start_time, league_id 
FROM matches 
WHERE odds_api_event_id IS NULL 
LIMIT 5;

-- Check a few odds feeds
SELECT home_team, away_team, commence_time, sport_key 
FROM market_feeds 
LIMIT 5;
