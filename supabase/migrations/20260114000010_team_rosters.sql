-- Migration: Create team_rosters table
-- Purpose: Store NBA team rosters with player info and injury status

CREATE TABLE IF NOT EXISTS team_rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Team Info
    team TEXT NOT NULL,
    sport TEXT NOT NULL DEFAULT 'NBA',
    
    -- Player Info
    player_name TEXT NOT NULL,
    position TEXT,
    jersey_number INTEGER,
    headshot_url TEXT,
    
    -- Status & Injury
    status TEXT NOT NULL DEFAULT 'Active',  -- Active, OUT, DOUBTFUL, QUESTIONABLE, PROBABLE, DAY-TO-DAY
    injury_report TEXT,
    injury_date DATE,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(player_name, team, sport)
);

-- Index for fast team lookups
CREATE INDEX IF NOT EXISTS idx_team_rosters_team 
ON team_rosters(team);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_team_rosters_status 
ON team_rosters(status);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_roster_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_roster_timestamp ON team_rosters;
CREATE TRIGGER trigger_update_roster_timestamp
    BEFORE UPDATE ON team_rosters
    FOR EACH ROW
    EXECUTE FUNCTION update_roster_timestamp();
