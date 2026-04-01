-- FINAL PULSE CHECK
-- Run this after triggering the functions

-- 1. Check for AI Intel population
SELECT count(*), league_id, game_date 
FROM pregame_intel 
GROUP BY league_id, game_date 
ORDER BY game_date DESC;

-- 2. Check for Match Odds Linking
SELECT count(*) as matches_with_odds 
FROM matches 
WHERE odds_api_event_id IS NOT NULL;

-- 3. Check for Player Props
SELECT count(*) as total_props, league 
FROM player_prop_bets 
GROUP BY league;
