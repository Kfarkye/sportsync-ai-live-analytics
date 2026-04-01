-- 20260112000010_clean_corrupt_league_ids.sql
-- Fix corrupt data where non-suffixed IDs have wrong league_id

-- 1) Delete non-NBA rows that have league_id='nba' but lack _nba suffix
DELETE FROM public.matches 
WHERE league_id = 'nba' 
  AND id NOT LIKE '%_nba';

-- 2) Delete non-NFL rows that have league_id='nfl' but lack _nfl suffix  
DELETE FROM public.matches 
WHERE league_id = 'nfl' 
  AND id NOT LIKE '%_nfl';

-- 3) Delete non-NHL rows that have league_id='nhl' but lack _nhl suffix
DELETE FROM public.matches 
WHERE league_id = 'nhl' 
  AND id NOT LIKE '%_nhl';

-- 4) Delete non-college-football rows with wrong league_id
DELETE FROM public.matches 
WHERE league_id = 'college-football' 
  AND id NOT LIKE '%_ncaaf';

-- 5) Delete non-mens-college-basketball rows with wrong league_id
DELETE FROM public.matches 
WHERE league_id = 'mens-college-basketball' 
  AND id NOT LIKE '%_ncaab';

-- 6) Same for teams table
DELETE FROM public.teams 
WHERE league_id = 'nba' 
  AND id NOT LIKE '%_nba';

DELETE FROM public.teams 
WHERE league_id = 'nfl' 
  AND id NOT LIKE '%_nfl';

DELETE FROM public.teams 
WHERE league_id = 'nhl' 
  AND id NOT LIKE '%_nhl';

DELETE FROM public.teams 
WHERE league_id = 'college-football' 
  AND id NOT LIKE '%_ncaaf';

DELETE FROM public.teams 
WHERE league_id = 'mens-college-basketball' 
  AND id NOT LIKE '%_ncaab';

SELECT 'Corrupt league_id data cleaned' as status;
