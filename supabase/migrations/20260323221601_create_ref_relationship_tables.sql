-- Ref × Team relationship
CREATE TABLE IF NOT EXISTS ref_team_records (
  id TEXT PRIMARY KEY,  -- ref_name::team::sport
  ref_name TEXT NOT NULL,
  team TEXT NOT NULL,
  sport TEXT NOT NULL,
  games INT DEFAULT 0,
  -- O/U
  overs INT DEFAULT 0,
  unders INT DEFAULT 0,
  ou_pushes INT DEFAULT 0,
  over_pct NUMERIC,
  avg_total NUMERIC,
  -- ATS
  ats_covers INT DEFAULT 0,
  ats_fails INT DEFAULT 0,
  ats_pushes INT DEFAULT 0,
  ats_cover_pct NUMERIC,
  avg_margin NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ref × Coach relationship
CREATE TABLE IF NOT EXISTS ref_coach_records (
  id TEXT PRIMARY KEY,  -- ref_name::coach::sport
  ref_name TEXT NOT NULL,
  coach TEXT NOT NULL,
  team TEXT NOT NULL,
  sport TEXT NOT NULL,
  games INT DEFAULT 0,
  overs INT DEFAULT 0,
  unders INT DEFAULT 0,
  ou_pushes INT DEFAULT 0,
  over_pct NUMERIC,
  avg_total NUMERIC,
  ats_covers INT DEFAULT 0,
  ats_fails INT DEFAULT 0,
  ats_pushes INT DEFAULT 0,
  ats_cover_pct NUMERIC,
  avg_margin NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ref × Player relationship
CREATE TABLE IF NOT EXISTS ref_player_records (
  id TEXT PRIMARY KEY,  -- ref_name::player::sport
  ref_name TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team TEXT NOT NULL,
  sport TEXT NOT NULL,
  games INT DEFAULT 0,
  -- Player performance with this ref
  avg_points NUMERIC,
  avg_points_career NUMERIC,  -- overall career avg for comparison
  pts_delta NUMERIC,  -- avg_points - avg_points_career
  -- Team O/U when this player plays with this ref
  overs INT DEFAULT 0,
  unders INT DEFAULT 0,
  over_pct NUMERIC,
  avg_total NUMERIC,
  -- Team ATS
  ats_covers INT DEFAULT 0,
  ats_fails INT DEFAULT 0,
  ats_cover_pct NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE ref_team_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_coach_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_player_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read ref_team" ON ref_team_records FOR SELECT TO anon USING (true);
CREATE POLICY "anon read ref_coach" ON ref_coach_records FOR SELECT TO anon USING (true);
CREATE POLICY "anon read ref_player" ON ref_player_records FOR SELECT TO anon USING (true);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_ref_team_ref ON ref_team_records (ref_name, sport);
CREATE INDEX IF NOT EXISTS idx_ref_team_team ON ref_team_records (team, sport);
CREATE INDEX IF NOT EXISTS idx_ref_coach_ref ON ref_coach_records (ref_name, sport);
CREATE INDEX IF NOT EXISTS idx_ref_coach_coach ON ref_coach_records (coach, sport);
CREATE INDEX IF NOT EXISTS idx_ref_player_ref ON ref_player_records (ref_name, sport);
CREATE INDEX IF NOT EXISTS idx_ref_player_player ON ref_player_records (player_name, sport);;
