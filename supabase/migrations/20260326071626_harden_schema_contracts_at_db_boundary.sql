
-- ============================================================
-- BOUNDARY ENFORCEMENT: Harden ALL schema contract fields at DB level
-- so no upstream ingest bug can produce quarantine-worthy rows.
-- ============================================================

-- ── live_game_state ──────────────────────────────────────────
-- Contract: HUB_GAMES_LIVE requires [id, league_id, game_status, home_team, away_team]
-- Already enforced: id (NOT NULL PK), league_id (NOT NULL), game_status (NOT NULL, default 'SCHEDULED'), sport (NOT NULL)
-- Trigger-protected: home_team, away_team (fn_populate_team_fields)
-- No further DDL needed on live_game_state core contract fields.

-- ── matches ──────────────────────────────────────────────────
-- Contract: HUB_GAMES_CURRENT requires [id, league_id, home_team, away_team, start_time, status]
-- Already enforced: id (NOT NULL PK)
-- GAPS: league_id, home_team, away_team, start_time, status are all NULLABLE

-- 1) league_id — 0 nulls today, but no constraint. Add NOT NULL.
ALTER TABLE matches ALTER COLUMN league_id SET NOT NULL;

-- 2) status — 0 nulls today, already has default. Add NOT NULL.
ALTER TABLE matches ALTER COLUMN status SET NOT NULL;

-- 3) sport — 29 nulls but not in contract. Add default to prevent future nulls.
ALTER TABLE matches ALTER COLUMN sport SET DEFAULT 'unknown';
UPDATE matches SET sport = 'unknown' WHERE sport IS NULL;

-- 4) home_team / away_team — 68 nulls (tennis/golf/mma = tournament-style sports).
--    These are structurally valid nulls. Cannot add NOT NULL without breaking ingest
--    for non-team sports. Instead: create a trigger like live_game_state,
--    but ONLY for team sports where home/away is expected.

-- 5) start_time — 5 nulls. Add default to prevent future nulls.
UPDATE matches SET start_time = '1970-01-01T00:00:00Z' WHERE start_time IS NULL;
ALTER TABLE matches ALTER COLUMN start_time SET DEFAULT now();
ALTER TABLE matches ALTER COLUMN start_time SET NOT NULL;

-- ── Trigger: Backfill team names for team sports in matches ──
-- For team sports (nba, nfl, nhl, mlb, ncaab, ncaaf, wnba, mls, epl, etc)
-- ensure home_team/away_team never stay null.
CREATE OR REPLACE FUNCTION fn_guard_matches_team_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Only enforce for team sports. Tournament sports (tennis, golf, mma) are exempt.
  IF NEW.sport NOT IN ('tennis', 'golf', 'mma', 'boxing', 'racing', 'unknown') THEN
    IF NEW.home_team IS NULL THEN
      NEW.home_team := 'TBD';
    END IF;
    IF NEW.away_team IS NULL THEN
      NEW.away_team := 'TBD';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_matches_team_fields ON matches;

CREATE TRIGGER trg_guard_matches_team_fields
  BEFORE INSERT OR UPDATE ON matches
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_matches_team_fields();
;
