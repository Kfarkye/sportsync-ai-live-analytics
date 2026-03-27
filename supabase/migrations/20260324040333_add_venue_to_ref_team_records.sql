
ALTER TABLE ref_team_records ADD COLUMN IF NOT EXISTS venue text DEFAULT 'all';
-- Update existing records
UPDATE ref_team_records SET venue = 'all' WHERE venue IS NULL;
-- Drop the old unique constraint and add new one
ALTER TABLE ref_team_records DROP CONSTRAINT IF EXISTS ref_team_records_pkey;
ALTER TABLE ref_team_records ADD PRIMARY KEY (id);
;
