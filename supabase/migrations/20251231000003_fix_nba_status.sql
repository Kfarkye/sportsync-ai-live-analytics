-- Check if status column exists in nba_games
DO $$ 
BEGIN 
--    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nba_games' AND column_name = 'status') THEN
--        ALTER TABLE nba_games ADD COLUMN status TEXT;
--    END IF;
END $$;
