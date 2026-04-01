-- supabase/migrations/20260114000008_team_season_fatigue.sql
-- Purpose: Pre-calculated fatigue and rest days for every team/date in the season.

CREATE TABLE IF NOT EXISTS team_season_fatigue (
    team TEXT NOT NULL,
    league_id TEXT NOT NULL,
    game_date DATE NOT NULL,
    situation TEXT NOT NULL DEFAULT 'Normal', -- 'B2B', '3in4', '4in5', etc.
    rest_days INTEGER NOT NULL DEFAULT 2,
    is_home BOOLEAN NOT NULL,
    opponent TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (team, league_id, game_date)
);

-- Index for fast lookup by worker
CREATE INDEX IF NOT EXISTS idx_fatigue_lookup ON team_season_fatigue(team, game_date);
