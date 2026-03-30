
-- Add BallDontLie provider configuration to league_config
ALTER TABLE league_config 
  ADD COLUMN IF NOT EXISTS bdl_sport_path text,
  ADD COLUMN IF NOT EXISTS odds_provider text DEFAULT 'THE_ODDS_API',
  ADD COLUMN IF NOT EXISTS bdl_game_key text DEFAULT 'game_id';

-- Map supported leagues to BallDontLie API paths
-- US Sports: full odds (spreads, moneylines, totals)
UPDATE league_config SET bdl_sport_path = 'nba/v1',       odds_provider = 'BALLDONTLIE', bdl_game_key = 'game_id'  WHERE id = 'nba';
UPDATE league_config SET bdl_sport_path = 'nfl/v1',       odds_provider = 'BALLDONTLIE', bdl_game_key = 'game_id'  WHERE id = 'nfl';
UPDATE league_config SET bdl_sport_path = 'mlb/v1',       odds_provider = 'BALLDONTLIE', bdl_game_key = 'game_id'  WHERE id = 'mlb';
UPDATE league_config SET bdl_sport_path = 'nhl/v1',       odds_provider = 'BALLDONTLIE', bdl_game_key = 'game_id'  WHERE id = 'nhl';
UPDATE league_config SET bdl_sport_path = 'ncaaf/v1',     odds_provider = 'BALLDONTLIE', bdl_game_key = 'game_id'  WHERE id = 'college-football';
UPDATE league_config SET bdl_sport_path = 'ncaab/v1',     odds_provider = 'BALLDONTLIE', bdl_game_key = 'game_id'  WHERE id = 'mens-college-basketball';

-- Soccer leagues: moneyline-only odds
UPDATE league_config SET bdl_sport_path = 'epl/v1',       odds_provider = 'BALLDONTLIE', bdl_game_key = 'match_id' WHERE id = 'eng.1';
UPDATE league_config SET bdl_sport_path = 'la_liga/v1',   odds_provider = 'BALLDONTLIE', bdl_game_key = 'match_id' WHERE id = 'esp.1';
UPDATE league_config SET bdl_sport_path = 'serie_a/v1',   odds_provider = 'BALLDONTLIE', bdl_game_key = 'match_id' WHERE id = 'ita.1';
UPDATE league_config SET bdl_sport_path = 'bundesliga/v1',odds_provider = 'BALLDONTLIE', bdl_game_key = 'match_id' WHERE id IN ('ger.1');
UPDATE league_config SET bdl_sport_path = 'ucl/v1',       odds_provider = 'BALLDONTLIE', bdl_game_key = 'match_id' WHERE id IN ('ucl', 'uefa.champions');
UPDATE league_config SET bdl_sport_path = 'ligue_1/v1',   odds_provider = 'BALLDONTLIE', bdl_game_key = 'match_id' WHERE id = 'fra.1';

-- FIFA World Cup 2026
UPDATE league_config 
  SET bdl_sport_path = 'fifa/worldcup/v1', odds_provider = 'BALLDONTLIE', bdl_game_key = 'match_id' 
  WHERE id IN ('fifa.world', 'worldcup');

-- Unsupported by BDL: keep on THE_ODDS_API (arg.1, bel.1, bra.1, ned.1, por.1, sco.1, tur.1)
-- These consume ~7 leagues * 1440 req/day = ~10,080 req/day = ~302K/month  
-- Still within Odds API quota if we reduce polling frequency for these

-- Add comment for documentation
COMMENT ON COLUMN league_config.bdl_sport_path IS 'BallDontLie API path segment (e.g. nba/v1, epl/v1). NULL = not supported by BDL.';
COMMENT ON COLUMN league_config.odds_provider IS 'Primary odds provider: BALLDONTLIE or THE_ODDS_API';
COMMENT ON COLUMN league_config.bdl_game_key IS 'BDL response key for game reference: game_id (US sports) or match_id (soccer)';
;
