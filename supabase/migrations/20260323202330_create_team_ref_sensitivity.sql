CREATE TABLE IF NOT EXISTS team_ref_sensitivity (
  team TEXT PRIMARY KEY,
  style TEXT,
  avg_3pa NUMERIC,
  avg_paint_pts NUMERIC,
  avg_fastbreak NUMERIC,
  total_w_over_ref NUMERIC,
  total_w_under_ref NUMERIC,
  ref_sensitivity NUMERIC,
  games INT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE team_ref_sensitivity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read team_ref_sensitivity" ON team_ref_sensitivity FOR SELECT TO anon USING (true);;
