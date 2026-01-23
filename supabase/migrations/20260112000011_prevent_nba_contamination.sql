-- 20260112000011_prevent_nba_contamination.sql
-- Prevent re-contamination of NBA matches with non-NBA data

-- 1) Check current state
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM public.matches
  WHERE league_id = 'nba' AND id NOT LIKE '%_nba';
  
  IF bad_count > 0 THEN
    DELETE FROM public.matches WHERE league_id = 'nba' AND id NOT LIKE '%_nba';
    RAISE NOTICE 'Deleted % unsuffixed NBA rows', bad_count;
  END IF;
END $$;

-- 2) Add constraints to prevent re-contamination for ALL leagues
-- NBA must have _nba suffix
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_nba_requires_suffix') THEN
    ALTER TABLE public.matches
    ADD CONSTRAINT matches_nba_requires_suffix
    CHECK (league_id <> 'nba' OR id LIKE '%_nba');
  END IF;
END $$;

-- NFL must have _nfl suffix
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_nfl_requires_suffix') THEN
    ALTER TABLE public.matches
    ADD CONSTRAINT matches_nfl_requires_suffix
    CHECK (league_id <> 'nfl' OR id LIKE '%_nfl');
  END IF;
END $$;

-- NHL must have _nhl suffix
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_nhl_requires_suffix') THEN
    ALTER TABLE public.matches
    ADD CONSTRAINT matches_nhl_requires_suffix
    CHECK (league_id <> 'nhl' OR id LIKE '%_nhl');
  END IF;
END $$;

-- MLB must have _mlb suffix
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_mlb_requires_suffix') THEN
    ALTER TABLE public.matches
    ADD CONSTRAINT matches_mlb_requires_suffix
    CHECK (league_id <> 'mlb' OR id LIKE '%_mlb');
  END IF;
END $$;

SELECT 'Suffix constraints added for NBA, NFL, NHL, MLB' as status;
