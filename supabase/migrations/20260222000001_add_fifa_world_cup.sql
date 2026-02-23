-- Add FIFA World Cup to league_config
-- The Odds API sport key: soccer_fifa_world_cup
-- ESPN league slug: fifa.world
-- Match ID suffix: _worldcup

INSERT INTO league_config (id, odds_api_key, display_name, is_active)
VALUES ('fifa.world', 'soccer_fifa_world_cup', 'FIFA World Cup', true)
ON CONFLICT (id) DO UPDATE SET
  odds_api_key = EXCLUDED.odds_api_key,
  display_name = EXCLUDED.display_name,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
