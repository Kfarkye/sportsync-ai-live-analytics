-- Add game_date column to poly_odds
ALTER TABLE poly_odds ADD COLUMN game_date date;

-- Backfill from slug (format: league-away-home-YYYY-MM-DD)
UPDATE poly_odds 
SET game_date = (regexp_match(poly_event_slug, '(\d{4}-\d{2}-\d{2})$'))[1]::date
WHERE poly_event_slug ~ '\d{4}-\d{2}-\d{2}$';

-- Index for fast date filtering
CREATE INDEX idx_poly_odds_game_date ON poly_odds (game_date);

-- Recreate v_poly_live to only serve today's and tomorrow's games
DROP VIEW IF EXISTS v_poly_live;

CREATE VIEW v_poly_live AS
SELECT 
  game_id,
  home_team_name,
  away_team_name,
  home_prob,
  away_prob,
  draw_prob,
  volume,
  volume_24h,
  local_league_id,
  game_date,
  game_start_time,
  poly_event_slug,
  updated_at AS poly_updated_at
FROM poly_odds
WHERE market_active = true 
  AND market_closed = false
  AND game_date IS NOT NULL
  AND game_date >= CURRENT_DATE - 1
  AND game_date <= CURRENT_DATE + 2
  AND home_team_name NOT IN ('Over', 'Under', 'Yes', 'No')
ORDER BY game_date, game_start_time;
