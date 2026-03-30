
-- ============================================================
-- WC Base Camps: The Fatigue Tracker
-- Source: FIFA Team Base Camp brochure, FOX4 KC, SportsTravel,
--         The World Cup Guide, Yahoo Sports, 2026soccercities.com
-- ============================================================

-- 1. Add elevation to venues (critical for Mexico City / Guadalajara / Monterrey)
ALTER TABLE wc_venues
  ADD COLUMN IF NOT EXISTS elevation_ft INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_turf_conversion BOOLEAN DEFAULT FALSE;

-- Populate elevation data (sourced from USGS / geographic databases)
UPDATE wc_venues SET elevation_ft = CASE stadium_name
  WHEN 'Estadio Azteca'           THEN 7349   -- Mexico City, 2240m
  WHEN 'Estadio BBVA'             THEN 1765   -- Monterrey, 538m
  WHEN 'Estadio Akron'            THEN 5138   -- Guadalajara, 1566m
  WHEN 'Empower Field at Mile High' THEN 5280 -- Denver (not WC host but reference)
  WHEN 'MetLife Stadium'          THEN 30     -- East Rutherford, NJ
  WHEN 'AT&T Stadium'             THEN 600    -- Arlington, TX
  WHEN 'SoFi Stadium'             THEN 118    -- Inglewood, CA
  WHEN 'Hard Rock Stadium'        THEN 10     -- Miami Gardens, FL
  WHEN 'NRG Stadium'              THEN 50     -- Houston, TX
  WHEN 'Gillette Stadium'         THEN 256    -- Foxborough, MA
  WHEN 'Lincoln Financial Field'  THEN 39     -- Philadelphia, PA
  WHEN 'Mercedes-Benz Stadium'    THEN 1050   -- Atlanta, GA
  WHEN 'Lumen Field'              THEN 20     -- Seattle, WA
  WHEN 'Levi''s Stadium'          THEN 43     -- Santa Clara, CA
  WHEN 'Arrowhead Stadium'        THEN 820    -- Kansas City, MO
  WHEN 'BC Place'                 THEN 10     -- Vancouver, BC
  ELSE 0
END;

-- Flag turf conversion stadiums (NFL stadiums converting from artificial to natural grass)
UPDATE wc_venues SET is_turf_conversion = TRUE
WHERE stadium_name IN (
  'MetLife Stadium',         -- Giants/Jets synthetic → temporary grass
  'SoFi Stadium',           -- Rams/Chargers synthetic → temporary grass
  'AT&T Stadium',            -- Cowboys synthetic → temporary grass
  'NRG Stadium',             -- Texans synthetic → temporary grass
  'Mercedes-Benz Stadium',   -- Falcons synthetic → temporary grass
  'Lumen Field',             -- Seahawks FieldTurf → temporary grass
  'BC Place'                 -- Whitecaps synthetic → temporary grass
);

-- 2. Base Camps table
CREATE TABLE wc_base_camps (
  id              SERIAL PRIMARY KEY,
  team_id         INTEGER REFERENCES wc_teams(id) ON DELETE CASCADE,
  base_city       TEXT NOT NULL,
  base_state      TEXT,                           -- state/province code
  base_country    TEXT DEFAULT 'USA' CHECK (base_country IN ('USA', 'Mexico', 'Canada')),
  training_site   TEXT,                           -- facility name
  hotel           TEXT,                           -- accommodation
  latitude        NUMERIC(9,6),
  longitude       NUMERIC(9,6),
  elevation_ft    INTEGER DEFAULT 0,
  confirmation    TEXT DEFAULT 'rumored' CHECK (confirmation IN ('confirmed', 'leaked', 'rumored', 'pending')),
  source_url      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(team_id)
);

COMMENT ON TABLE wc_base_camps IS 'Team base camp locations for 2026 FIFA World Cup. Sources: FIFA, FOX4 KC, SportsTravel Magazine, The World Cup Guide, Yahoo Sports. Updated Feb 2026.';

-- 3. Travel log table — one row per team per match
CREATE TABLE wc_travel_log (
  id              SERIAL PRIMARY KEY,
  team_id         INTEGER REFERENCES wc_teams(id) ON DELETE CASCADE,
  match_id        INTEGER REFERENCES wc_matches(id) ON DELETE CASCADE,
  origin_city     TEXT,                           -- base camp or previous match city
  destination_city TEXT,                          -- match city
  distance_miles  INTEGER,                        -- great-circle distance
  elevation_delta INTEGER DEFAULT 0,              -- ft difference (destination - origin)
  rest_days       INTEGER,                        -- days since last match
  is_altitude_match BOOLEAN DEFAULT FALSE,        -- venue > 4000ft
  travel_fatigue_score NUMERIC(4,2) DEFAULT 0,    -- composite score
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(team_id, match_id)
);

COMMENT ON TABLE wc_travel_log IS 'Per-match travel burden for fatigue modeling. Distance in statute miles (great-circle). Elevation delta in feet. Fatigue score = f(distance, elevation, rest_days).';

-- 4. Third-place leaderboard view
CREATE OR REPLACE VIEW wc_third_place_race AS
WITH ranked AS (
  SELECT
    gs.group_letter,
    gs.team_id,
    t.team_name,
    t.fifa_code,
    gs.played,
    gs.won,
    gs.drawn,
    gs.lost,
    gs.goals_for,
    gs.goals_against,
    gs.goal_difference,
    gs.points,
    ROW_NUMBER() OVER (
      PARTITION BY gs.group_letter
      ORDER BY gs.points DESC, gs.goal_difference DESC, gs.goals_for DESC
    ) AS group_rank
  FROM wc_group_standings gs
  JOIN wc_teams t ON t.id = gs.team_id
)
SELECT
  group_letter,
  team_id,
  team_name,
  fifa_code,
  played, won, drawn, lost,
  goals_for, goals_against, goal_difference, points,
  RANK() OVER (
    ORDER BY points DESC, goal_difference DESC, goals_for DESC
  ) AS third_place_rank
FROM ranked
WHERE group_rank = 3;

COMMENT ON VIEW wc_third_place_race IS 'Live leaderboard of all 12 third-place teams. Top 8 advance to Round of 32. FIFA tiebreaker: points → GD → GF → fair play (not modeled).';

-- 5. Indexes for performance
CREATE INDEX idx_base_camps_team ON wc_base_camps(team_id);
CREATE INDEX idx_travel_log_team ON wc_travel_log(team_id);
CREATE INDEX idx_travel_log_match ON wc_travel_log(match_id);
CREATE INDEX idx_travel_fatigue ON wc_travel_log(travel_fatigue_score DESC);
;
