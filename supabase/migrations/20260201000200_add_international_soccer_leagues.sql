-- 20260201000200_add_international_soccer_leagues.sql
-- Add high-quality international soccer leagues to league_config

INSERT INTO league_config (id, odds_api_key, display_name, is_active)
VALUES
  -- South America
  ('bra.1', 'soccer_brazil_serie_a', 'Brasileirão Série A', true),
  ('arg.1', 'soccer_argentina_primera', 'Argentina Primera División', true),
  
  -- Europe
  ('por.1', 'soccer_portugal_primeira', 'Primeira Liga', true),
  ('ned.1', 'soccer_netherlands_eredivisie', 'Eredivisie', true),
  ('bel.1', 'soccer_belgium_first_div', 'Belgian Pro League', true),
  ('tur.1', 'soccer_turkey_super_league', 'Turkish Süper Lig', true),
  ('sco.1', 'soccer_scotland_premiership', 'Scottish Premiership', true)

ON CONFLICT (id) DO UPDATE SET
  odds_api_key = EXCLUDED.odds_api_key,
  display_name = EXCLUDED.display_name,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
