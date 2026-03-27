
-- Graded ref × player records against Vegas closing lines
-- This replaces the season-average-based ref_player_records with actual prop grading
CREATE TABLE IF NOT EXISTS ref_player_props_graded (
  id TEXT PRIMARY KEY,
  ref_name TEXT NOT NULL,
  player_name TEXT NOT NULL,
  team TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'basketball',
  games INTEGER NOT NULL,
  avg_line NUMERIC(6,1),
  avg_actual NUMERIC(6,1),
  line_diff NUMERIC(5,1),
  overs INTEGER NOT NULL DEFAULT 0,
  unders INTEGER NOT NULL DEFAULT 0,
  pushes INTEGER NOT NULL DEFAULT 0,
  over_pct NUMERIC(5,1),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_player_props_graded_sport ON ref_player_props_graded(sport);
CREATE INDEX IF NOT EXISTS idx_ref_player_props_graded_ref ON ref_player_props_graded(ref_name);
CREATE INDEX IF NOT EXISTS idx_ref_player_props_graded_player ON ref_player_props_graded(player_name);

-- Enable RLS
ALTER TABLE ref_player_props_graded ENABLE ROW LEVEL SECURITY;

-- Allow anon read access
CREATE POLICY "Allow anon read ref_player_props_graded"
  ON ref_player_props_graded FOR SELECT
  TO anon USING (true);
;
