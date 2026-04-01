-- Add missing columns to nba_team_priors if they were omitted due to migration conflicts
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='nba_team_priors' AND column_name='o_rating') THEN
        ALTER TABLE nba_team_priors ADD COLUMN o_rating NUMERIC DEFAULT 110;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='nba_team_priors' AND column_name='d_rating') THEN
        ALTER TABLE nba_team_priors ADD COLUMN d_rating NUMERIC DEFAULT 110;
    END IF;
END $$;
