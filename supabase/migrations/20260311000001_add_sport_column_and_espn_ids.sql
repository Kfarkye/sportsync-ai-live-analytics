-- Migration: add_sport_column_and_espn_ids

ALTER TABLE league_config
ADD COLUMN IF NOT EXISTS sport text;

UPDATE league_config
SET sport = CASE
  WHEN id IN ('nba', 'mens-college-basketball') THEN 'basketball'
  WHEN id IN ('nfl', 'college-football') THEN 'football'
  WHEN id IN ('nhl') THEN 'hockey'
  WHEN id IN ('mlb') THEN 'baseball'
  WHEN id IN ('atp', 'wta') THEN 'tennis'
  WHEN id IN ('ufc') THEN 'mma'
  WHEN id IN ('pga') THEN 'golf'
  ELSE 'soccer'
END
WHERE sport IS NULL;

UPDATE league_config
SET espn_league_id = CASE id
  WHEN 'nba' THEN 'nba'
  WHEN 'mens-college-basketball' THEN 'mens-college-basketball'
  WHEN 'nfl' THEN 'nfl'
  WHEN 'college-football' THEN 'college-football'
  WHEN 'nhl' THEN 'nhl'
  WHEN 'mlb' THEN 'mlb'
  WHEN 'epl' THEN 'eng.1'
  WHEN 'eng.1' THEN 'eng.1'
  WHEN 'laliga' THEN 'esp.1'
  WHEN 'esp.1' THEN 'esp.1'
  WHEN 'seriea' THEN 'ita.1'
  WHEN 'ita.1' THEN 'ita.1'
  WHEN 'bundesliga' THEN 'ger.1'
  WHEN 'ligue1' THEN 'fra.1'
  WHEN 'mls' THEN 'usa.1'
  WHEN 'ucl' THEN 'uefa.champions'
  WHEN 'uefa.champions' THEN 'uefa.champions'
  WHEN 'uel' THEN 'uefa.europa'
  WHEN 'uefa.europa' THEN 'uefa.europa'
  WHEN 'mex.1' THEN 'mex.1'
  WHEN 'fifawc' THEN 'fifa.world'
  WHEN 'atp' THEN 'atp'
  WHEN 'wta' THEN 'wta'
  ELSE espn_league_id
END
WHERE espn_league_id IS NULL;

INSERT INTO league_config (id, odds_api_key, espn_league_id, display_name, is_active, odds_provider, sport)
VALUES ('uefa.europa', 'soccer_uefa_europa_league', 'uefa.europa', 'UEFA Europa League', true, 'THE_ODDS_API', 'soccer')
ON CONFLICT (id) DO UPDATE
SET espn_league_id = 'uefa.europa', sport = 'soccer', is_active = true;

INSERT INTO league_config (id, odds_api_key, espn_league_id, display_name, is_active, odds_provider, sport)
VALUES ('mex.1', 'soccer_mexico_ligamx', 'mex.1', 'Liga MX', true, 'THE_ODDS_API', 'soccer')
ON CONFLICT (id) DO UPDATE
SET espn_league_id = 'mex.1', sport = 'soccer', is_active = true;
