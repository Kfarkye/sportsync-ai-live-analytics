-- Migration: Create injury_snapshots table
-- Purpose: Store player injury data from scan-injuries cron, used by scan-team-context

CREATE TABLE IF NOT EXISTS injury_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport TEXT NOT NULL,
    team TEXT NOT NULL,
    player_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Questionable',  -- OUT, DOUBTFUL, QUESTIONABLE, PROBABLE, DAY-TO-DAY
    report TEXT,
    source_url TEXT,
    report_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(player_name, team, sport, report_date)
);

-- Index for fast lookups by sport and date
CREATE INDEX IF NOT EXISTS idx_injury_snapshots_sport_date 
ON injury_snapshots(sport, report_date);

-- Index for team lookups
CREATE INDEX IF NOT EXISTS idx_injury_snapshots_team 
ON injury_snapshots(team);
