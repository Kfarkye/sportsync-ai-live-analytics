
-- Forensic Fix for Match Data Integrity
-- 1. Remove non-canonical matches that lack suffixes for soccer
DELETE FROM matches 
WHERE league_id IN ('seriea', 'serie-a', 'soccer_italy_serie_a')
AND id NOT LIKE '%\_%';

-- 2. Strip accidental literal quotes from team names (JSONB aware)
-- We handle both the case where the column is text or jsonb
UPDATE matches
SET 
  home_team = CASE 
    WHEN jsonb_typeof(home_team) = 'string' THEN 
      to_jsonb(REPLACE(REPLACE(home_team#>>'{}', '"', ''), '\"', ''))
    WHEN jsonb_typeof(home_team) = 'object' THEN
      home_team || jsonb_build_object('name', REPLACE(REPLACE(home_team->>'name', '"', ''), '\"', ''))
    ELSE home_team
  END,
  away_team = CASE 
    WHEN jsonb_typeof(away_team) = 'string' THEN 
      to_jsonb(REPLACE(REPLACE(away_team#>>'{}', '"', ''), '\"', ''))
    WHEN jsonb_typeof(away_team) = 'object' THEN
      away_team || jsonb_build_object('name', REPLACE(REPLACE(away_team->>'name', '"', ''), '\"', ''))
    ELSE away_team
  END
WHERE 
  (home_team::text LIKE '%"%' AND home_team::text NOT LIKE '{%') OR
  (home_team->>'name' LIKE '%"%');

-- 3. Canonicalize league IDs to their proper _suffix counterparts
UPDATE matches 
SET league_id = 'eng.1' 
WHERE league_id IN ('epl', 'premier-league', 'soccer_epl');

UPDATE matches 
SET league_id = 'ita.1' 
WHERE league_id IN ('seriea', 'serie-a', 'soccer_italy_serie_a');

UPDATE matches 
SET league_id = 'esp.1' 
WHERE league_id IN ('laliga', 'la-liga', 'soccer_spain_la_liga');

-- 4. Force a sync update
UPDATE matches 
SET updated_at = NOW() 
WHERE league_id IN ('eng.1', 'ita.1', 'esp.1', 'ger.1');
