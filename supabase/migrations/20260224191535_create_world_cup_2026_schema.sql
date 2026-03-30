
-- ============================================
-- 2026 FIFA World Cup Schema
-- Source: FIFA.com, draw Dec 5 2025
-- ============================================

-- 1. Venues (16 stadiums)
CREATE TABLE wc_venues (
  id SERIAL PRIMARY KEY,
  stadium_name TEXT NOT NULL,
  city TEXT NOT NULL,
  state_province TEXT,
  country TEXT NOT NULL CHECK (country IN ('USA', 'Mexico', 'Canada')),
  capacity INTEGER,
  surface_type TEXT,
  grass_conversion BOOLEAN DEFAULT false,
  roof_type TEXT CHECK (roof_type IN ('open', 'retractable', 'fixed')),
  timezone TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  total_matches INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Teams (48)
CREATE TABLE wc_teams (
  id SERIAL PRIMARY KEY,
  team_name TEXT NOT NULL,
  fifa_code TEXT UNIQUE,
  confederation TEXT CHECK (confederation IN ('UEFA','CONMEBOL','CONCACAF','CAF','AFC','OFC')),
  fifa_ranking INTEGER,
  group_letter CHAR(1) CHECK (group_letter BETWEEN 'A' AND 'L'),
  pot INTEGER CHECK (pot BETWEEN 1 AND 4),
  qualified BOOLEAN DEFAULT true,
  qualification_method TEXT,
  placeholder_label TEXT, -- e.g. 'UEFA Playoff A winner'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Groups (12)
CREATE TABLE wc_groups (
  group_letter CHAR(1) PRIMARY KEY CHECK (group_letter BETWEEN 'A' AND 'L'),
  host_team_id INTEGER REFERENCES wc_teams(id),
  venue_primary TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Group Standings (live during tournament)
CREATE TABLE wc_group_standings (
  id SERIAL PRIMARY KEY,
  group_letter CHAR(1) REFERENCES wc_groups(group_letter),
  team_id INTEGER REFERENCES wc_teams(id),
  played INTEGER DEFAULT 0,
  won INTEGER DEFAULT 0,
  drawn INTEGER DEFAULT 0,
  lost INTEGER DEFAULT 0,
  goals_for INTEGER DEFAULT 0,
  goals_against INTEGER DEFAULT 0,
  goal_difference INTEGER GENERATED ALWAYS AS (goals_for - goals_against) STORED,
  points INTEGER GENERATED ALWAYS AS (won * 3 + drawn) STORED,
  group_rank INTEGER,
  UNIQUE (group_letter, team_id)
);

-- 5. Matches (104 total)
CREATE TABLE wc_matches (
  id SERIAL PRIMARY KEY,
  match_number INTEGER UNIQUE,
  round TEXT NOT NULL CHECK (round IN ('group','round_of_32','round_of_16','quarterfinal','semifinal','third_place','final')),
  group_letter CHAR(1),
  home_team_id INTEGER REFERENCES wc_teams(id),
  away_team_id INTEGER REFERENCES wc_teams(id),
  venue_id INTEGER REFERENCES wc_venues(id),
  match_date DATE,
  kickoff_time TIMESTAMPTZ,
  home_score INTEGER,
  away_score INTEGER,
  home_score_penalties INTEGER,
  away_score_penalties INTEGER,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','completed','postponed')),
  attendance INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Knockout Bracket
CREATE TABLE wc_knockout_bracket (
  id SERIAL PRIMARY KEY,
  round TEXT NOT NULL,
  match_position INTEGER, -- e.g. QF1, QF2...
  match_id INTEGER REFERENCES wc_matches(id),
  team_1_source TEXT, -- e.g. 'Winner Group A' or 'Winner R32-1'
  team_2_source TEXT,
  winner_advances_to TEXT, -- e.g. 'QF1'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_wc_teams_group ON wc_teams (group_letter);
CREATE INDEX idx_wc_matches_round ON wc_matches (round);
CREATE INDEX idx_wc_matches_date ON wc_matches (match_date);
CREATE INDEX idx_wc_standings_group ON wc_group_standings (group_letter);
CREATE INDEX idx_wc_matches_venue ON wc_matches (venue_id);

COMMENT ON TABLE wc_venues IS '16 host stadiums for 2026 FIFA World Cup. Source: FIFA.com';
COMMENT ON TABLE wc_teams IS '48 participating nations. Draw: Dec 5, 2025. 6 playoff spots TBD March 2026.';
COMMENT ON TABLE wc_matches IS '104 total matches. June 11 - July 19, 2026.';
;
