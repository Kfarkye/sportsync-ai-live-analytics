-- NBA Team Tempo & Analytics Table
-- Stores real-time team performance metrics for AI context injection

CREATE TABLE IF NOT EXISTS public.team_tempo (
    id SERIAL PRIMARY KEY,
    team TEXT NOT NULL,
    league_id TEXT NOT NULL DEFAULT 'nba',
    
    -- Core Tempo Metrics
    pace NUMERIC(5,2),
    ortg NUMERIC(5,2),  -- Offensive Rating
    drtg NUMERIC(5,2),  -- Defensive Rating
    net_rtg NUMERIC(5,2),  -- Net Rating
    ppm NUMERIC(5,2),   -- Points Per Minute (efficiency)
    
    -- ATS (Against The Spread) Records
    ats_record TEXT,    -- e.g., "65-38-2"
    ats_l10 TEXT,       -- Last 10 games ATS
    ats_l5 TEXT,        -- Last 5 games ATS
    
    -- Over/Under Records
    over_record INT,
    under_record INT,
    over_l10 INT,
    over_l5 INT,
    under_l10 INT,
    under_l5 INT,
    push_record INT,
    
    -- Trending Metrics (L10/L5)
    ortg_l10 NUMERIC(5,2),
    ortg_l5 NUMERIC(5,2),
    pace_l10 NUMERIC(5,2),
    pace_l5 NUMERIC(5,2),
    ppm_l10 NUMERIC(5,2),
    ppm_l5 NUMERIC(5,2),
    
    -- Meta
    rank INT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(team, league_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_team_tempo_team ON team_tempo(team);
CREATE INDEX IF NOT EXISTS idx_team_tempo_league ON team_tempo(league_id);

-- Grant access
GRANT SELECT ON public.team_tempo TO authenticated;
GRANT SELECT ON public.team_tempo TO anon;

SELECT 'team_tempo_table_created' as result;
