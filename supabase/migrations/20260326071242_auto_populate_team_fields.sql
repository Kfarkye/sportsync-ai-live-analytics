
-- TRIGGER: Auto-populate home_team/away_team from matches table
-- when ingest-live-games writes to live_game_state without them.
-- This is the structural fix — the DB enforces the contract.

CREATE OR REPLACE FUNCTION fn_populate_team_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when team fields are missing
  IF NEW.home_team IS NULL OR NEW.away_team IS NULL THEN
    SELECT 
      COALESCE(NEW.home_team, m.home_team),
      COALESCE(NEW.away_team, m.away_team),
      COALESCE(NEW.start_time, m.start_time)
    INTO NEW.home_team, NEW.away_team, NEW.start_time
    FROM matches m
    WHERE m.id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_populate_team_fields ON live_game_state;

CREATE TRIGGER trg_populate_team_fields
  BEFORE INSERT OR UPDATE ON live_game_state
  FOR EACH ROW
  EXECUTE FUNCTION fn_populate_team_fields();
;
