
-- 1. Historical Results Table (The Source of Truth)
CREATE TABLE IF NOT EXISTS game_results (
    id TEXT PRIMARY KEY, -- Match ID from ESPN/Provider
    sport TEXT NOT NULL,
    league TEXT,
    season INT NOT NULL,
    game_date TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Home Team Data
    home_team_id TEXT NOT NULL,
    home_score INT,
    
    -- Away Team Data
    away_team_id TEXT NOT NULL,
    away_score INT,
    
    -- Closing Market Data (for ATS/Total logic)
    closing_spread DECIMAL,
    closing_total DECIMAL,
    
    -- Metadata
    is_processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure sport column exists if table was already created
ALTER TABLE game_results ADD COLUMN IF NOT EXISTS sport TEXT NOT NULL DEFAULT 'NFL';

-- 2. Team Trends Table (The Fast Cache)
-- Stores calculated summaries so we don't have to scan history every time
CREATE TABLE IF NOT EXISTS team_trends (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    context TEXT NOT NULL, -- 'OVERALL', 'HOME', 'AWAY'
    
    -- Straight Up (SU) Records
    su_wins INT DEFAULT 0,
    su_losses INT DEFAULT 0,
    su_streak INT DEFAULT 0, -- Positive for win streak, negative for loss streak
    
    -- Against The Spread (ATS) Records
    ats_wins INT DEFAULT 0,
    ats_losses INT DEFAULT 0,
    ats_pushes INT DEFAULT 0,
    ats_streak INT DEFAULT 0,
    
    -- Over/Under (OU) Records
    ou_overs INT DEFAULT 0,
    ou_unders INT DEFAULT 0,
    ou_pushes INT DEFAULT 0,
    
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(team_id, sport, context)
);

-- Ensure all statistical columns exist even if table was already created
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_trends' AND column_name='su_wins') THEN
        ALTER TABLE team_trends ADD COLUMN su_wins INT DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_trends' AND column_name='su_losses') THEN
        ALTER TABLE team_trends ADD COLUMN su_losses INT DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_trends' AND column_name='su_streak') THEN
        ALTER TABLE team_trends ADD COLUMN su_streak INT DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_trends' AND column_name='ats_wins') THEN
        ALTER TABLE team_trends ADD COLUMN ats_wins INT DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_trends' AND column_name='ats_losses') THEN
        ALTER TABLE team_trends ADD COLUMN ats_losses INT DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_trends' AND column_name='ou_overs') THEN
        ALTER TABLE team_trends ADD COLUMN ou_overs INT DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_trends' AND column_name='ou_unders') THEN
        ALTER TABLE team_trends ADD COLUMN ou_unders INT DEFAULT 0;
    END IF;
END $$;

-- Ensure sport column exists if table was already created
ALTER TABLE team_trends ADD COLUMN IF NOT EXISTS sport TEXT NOT NULL DEFAULT 'NFL';

-- Ensure the correct UNIQUE constraint exists for UPSERT operations
-- We use a DO block to handle conditional constraint creation
DO $$ 
BEGIN
    -- Drop old two-part constraint if it exists (ignoring sport)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc 
        JOIN information_schema.key_column_usage as kcu USING (constraint_schema, constraint_name) 
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = 'team_trends' AND kcu.column_name = 'team_id'
        AND tc.constraint_name NOT IN (SELECT tc2.constraint_name FROM information_schema.key_column_usage kcu2 JOIN information_schema.table_constraints tc2 USING (constraint_schema, constraint_name) WHERE tc2.table_name = 'team_trends' AND kcu2.column_name = 'sport')
    ) THEN
        -- We don't drop automatically to avoid data loss risk, but we ensure the NEW one exists below
    END IF;

    -- Add the definitive 3-part unique constraint if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc 
        JOIN information_schema.key_column_usage as kcu USING (constraint_schema, constraint_name) 
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = 'team_trends' AND kcu.column_name IN ('team_id', 'sport', 'context')
        GROUP BY tc.constraint_name, tc.table_name
        HAVING COUNT(*) = 3
    ) THEN
        ALTER TABLE team_trends ADD CONSTRAINT team_trends_team_sport_context_key UNIQUE (team_id, sport, context);
    END IF;
END $$;

-- 3. Situational Insights (The Discovery Layer)
-- Stores the actual strings/pills to show the user
CREATE TABLE IF NOT EXISTS match_insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id TEXT NOT NULL,
    team_id TEXT,
    sport TEXT,
    insight_type TEXT NOT NULL, -- 'SU_STREAK', 'ATS_DOMINANCE', 'TOTAL_TREND'
    category TEXT,              -- 'STADIUM', 'SITUATION', 'HISTORY'
    summary TEXT NOT NULL,      -- "Won 20 straight at home"
    detail TEXT,                -- "Last loss at home was Dec 2021"
    impact_level INT DEFAULT 5, -- 1-10 intensity
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE -- Optional expiration for transient trends
);

-- Ensure all columns required for seeding exist if table was already created
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_insights' AND column_name='match_id') THEN
        ALTER TABLE match_insights ADD COLUMN match_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_insights' AND column_name='team_id') THEN
        ALTER TABLE match_insights ADD COLUMN team_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_insights' AND column_name='sport') THEN
        ALTER TABLE match_insights ADD COLUMN sport TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_insights' AND column_name='insight_type') THEN
        ALTER TABLE match_insights ADD COLUMN insight_type TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_insights' AND column_name='category') THEN
        ALTER TABLE match_insights ADD COLUMN category TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_insights' AND column_name='summary') THEN
        ALTER TABLE match_insights ADD COLUMN summary TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_insights' AND column_name='detail') THEN
        ALTER TABLE match_insights ADD COLUMN detail TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_insights' AND column_name='impact_level') THEN
        ALTER TABLE match_insights ADD COLUMN impact_level INT DEFAULT 5;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='match_insights' AND column_name='is_active') THEN
        ALTER TABLE match_insights ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    END IF;

    -- REMOVE RESTRICTIVE UNIQUE CONSTRAINT ON match_id IF IT EXISTS
    -- The app expects multiple insights per match_id.
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'match_insights_unique_match' AND table_name = 'match_insights'
    ) THEN
        ALTER TABLE match_insights DROP CONSTRAINT match_insights_unique_match;
    END IF;

    -- REMOVE RESTRICTIVE FOREIGN KEY TO 'games' TABLE IF IT EXISTS
    -- This prevents seeding hypothetical/demo data. 
    -- We can add a more appropriate FK to 'matches' later if needed.
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'match_insights_match_id_fkey' AND table_name = 'match_insights'
    ) THEN
        ALTER TABLE match_insights DROP CONSTRAINT match_insights_match_id_fkey;
    END IF;

    -- Add a better unique constraint to prevent duplicate exact insights during seeding
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc 
        JOIN information_schema.key_column_usage as kcu USING (constraint_schema, constraint_name) 
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = 'match_insights' AND kcu.column_name IN ('match_id', 'summary')
        GROUP BY tc.constraint_name, tc.table_name
        HAVING COUNT(*) = 2
    ) THEN
        ALTER TABLE match_insights ADD CONSTRAINT match_insights_match_summary_key UNIQUE (match_id, summary);
    END IF;
END $$;

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_game_results_teams ON game_results (home_team_id, away_team_id);
CREATE INDEX IF NOT EXISTS idx_game_results_date ON game_results (game_date);
CREATE INDEX IF NOT EXISTS idx_match_insights_match_id ON match_insights (match_id);
CREATE INDEX IF NOT EXISTS idx_team_trends_lookup ON team_trends (team_id, sport);
