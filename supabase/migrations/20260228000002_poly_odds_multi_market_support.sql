-- Add market_type and line columns
ALTER TABLE poly_odds 
  ADD COLUMN market_type text DEFAULT 'moneyline',
  ADD COLUMN spread_line numeric,
  ADD COLUMN total_line numeric;

-- Drop old event-level unique constraint
ALTER TABLE poly_odds DROP CONSTRAINT poly_odds_poly_event_id_key;

-- Add market-level unique constraint (one row per market per event)
ALTER TABLE poly_odds ADD CONSTRAINT poly_odds_condition_uq UNIQUE (poly_condition_id);

-- Backfill: classify existing rows by outcome names
UPDATE poly_odds 
SET market_type = CASE
  WHEN home_team_name IN ('Over', 'Under') THEN 'total'
  WHEN home_team_name ~ '^\d' OR away_team_name ~ '^\d' THEN 'spread'
  ELSE 'moneyline'
END;

-- Index for fast market_type queries
CREATE INDEX idx_poly_odds_market_type ON poly_odds (market_type);

-- Recreate view: all market types, date-filtered
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
  market_type,
  spread_line,
  total_line,
  game_start_time,
  poly_event_slug,
  poly_condition_id,
  updated_at AS poly_updated_at
FROM poly_odds
WHERE market_active = true 
  AND market_closed = false
  AND game_date IS NOT NULL
  AND game_date >= CURRENT_DATE - 1
  AND game_date <= CURRENT_DATE + 2
ORDER BY game_date, game_start_time;

-- Convenience view: moneyline only (what the frontend currently uses)
CREATE VIEW v_poly_moneyline AS
SELECT * FROM v_poly_live
WHERE market_type = 'moneyline';
