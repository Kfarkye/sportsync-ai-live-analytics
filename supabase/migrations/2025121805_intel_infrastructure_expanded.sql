
-- ============================================================================
-- INTEL INFRASTRUCTURE - EXPANDED
-- Ensures all intelligence tables for News, Thesis, Narratives, and Stats comparison exist.
-- ============================================================================

-- 1. STADIUMS (Canonical Venue Database)
CREATE TABLE IF NOT EXISTS stadiums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espn_id INT UNIQUE,              -- ESPN Venue ID
    name TEXT NOT NULL,              -- e.g. "GEHA Field at Arrowhead Stadium"
    city TEXT,
    state TEXT,
    capacity INT,
    indoor BOOLEAN DEFAULT FALSE,
    surface_type TEXT,               -- e.g. "Grass", "Turf"
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns and constraints exist even if table was created previously
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stadiums' AND column_name='espn_id') THEN
        ALTER TABLE stadiums ADD COLUMN espn_id INT UNIQUE;
    END IF;
    
    -- Ensure UNIQUE constraint on espn_id exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc 
        JOIN information_schema.constraint_column_usage as ccu USING (constraint_schema, constraint_name) 
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = 'stadiums' AND ccu.column_name = 'espn_id'
    ) THEN
        ALTER TABLE stadiums ADD CONSTRAINT stadiums_espn_id_key UNIQUE (espn_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stadiums' AND column_name='capacity') THEN
        ALTER TABLE stadiums ADD COLUMN capacity INT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stadiums' AND column_name='indoor') THEN
        ALTER TABLE stadiums ADD COLUMN indoor BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stadiums' AND column_name='surface_type') THEN
        ALTER TABLE stadiums ADD COLUMN surface_type TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stadiums' AND column_name='image_url') THEN
        ALTER TABLE stadiums ADD COLUMN image_url TEXT;
    END IF;
END $$;

-- 2. VENUE INTEL (Match-specific venue cache)
CREATE TABLE IF NOT EXISTS venue_intel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL UNIQUE,
    content JSONB NOT NULL,          -- Flexible venue notes / weather
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. MATCH NEWS (Deep AI reports)
-- Stores the JSON structure used by NewsIntelCard.tsx
CREATE TABLE IF NOT EXISTS match_news (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL UNIQUE,
    report TEXT NOT NULL,            -- The main analysis body (Markdown/JSON)
    key_injuries JSONB DEFAULT '[]', -- List of {player, status, description}
    betting_factors JSONB DEFAULT '[]', -- List of {title, description, trend}
    line_movement JSONB,
    weather_forecast JSONB,
    fatigue JSONB,                   -- Days rest for home/away
    officials JSONB,
    sources JSONB DEFAULT '[]',
    status TEXT DEFAULT 'ACTIVE',
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(match_id)
);

-- 4. MATCH THESIS (Gemini's analytical model)
CREATE TABLE IF NOT EXISTS match_thesis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL UNIQUE,
    content JSONB NOT NULL,          -- Structured MatchThesis type
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. NARRATIVE INTEL
CREATE TABLE IF NOT EXISTS narrative_intel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL UNIQUE,
    content JSONB NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. EDGE ANALYSIS
CREATE TABLE IF NOT EXISTS edge_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL UNIQUE,
    content JSONB NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. BOX SCORES (Live stats cache)
CREATE TABLE IF NOT EXISTS box_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL UNIQUE,
    content JSONB NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. PLAYER PROP BETS
CREATE TABLE IF NOT EXISTS player_prop_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    player_id TEXT,
    player_name TEXT NOT NULL,
    bet_type TEXT NOT NULL,          -- 'points', 'rebounds', 'assists', etc.
    market_label TEXT,               -- e.g. 'Over/Under 24.5 Pts'
    line_value DECIMAL(6,2) NOT NULL,
    odds_american INT NOT NULL,      -- e.g. -110
    side TEXT NOT NULL,              -- 'over' | 'under' | 'yes' | 'no'
    provider TEXT,                   -- e.g. 'DraftKings'
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(match_id, player_name, bet_type, side, provider)
);

-- Ensure all columns and constraints exist for player_prop_bets
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='provider') THEN
        ALTER TABLE player_prop_bets ADD COLUMN provider TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='sportsbook') THEN
        ALTER TABLE player_prop_bets ADD COLUMN sportsbook TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='event_date') THEN
        ALTER TABLE player_prop_bets ADD COLUMN event_date DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='league') THEN
        ALTER TABLE player_prop_bets ADD COLUMN league TEXT;
    END IF;

    -- Handle potential ENUM migration for 'interceptions'
    -- If bet_type is an enum, we need to add the value
    IF EXISTS (
        SELECT 1 FROM pg_type t 
        JOIN pg_enum e ON t.oid = e.enumtypid 
        WHERE t.typname = 'prop_bet_type' AND e.enumlabel = 'interceptions'
    ) THEN
        -- Already exists
    ELSIF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'prop_bet_type') THEN
        ALTER TYPE prop_bet_type ADD VALUE 'interceptions';
    END IF;

    -- REMOVE RESTRICTIVE FOREIGN KEY TO 'matches' TABLE IF IT EXISTS
    -- This prevents seeding hypothetical/demo data.
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'player_prop_bets_match_id_fkey' AND table_name = 'player_prop_bets'
    ) THEN
        ALTER TABLE player_prop_bets DROP CONSTRAINT player_prop_bets_match_id_fkey;
    END IF;

    -- Ensure the unique constraint on (match_id, player_name, bet_type, side, provider) exists
    -- We also add sportsbook to the constraint if possible
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc 
        JOIN information_schema.key_column_usage as kcu USING (constraint_schema, constraint_name) 
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = 'player_prop_bets' AND kcu.column_name IN ('match_id', 'player_name', 'bet_type', 'side', 'provider')
        GROUP BY tc.constraint_name, tc.table_name
        HAVING COUNT(*) = 5
    ) THEN
        -- Drop potentially restrictive older constraints first
        ALTER TABLE player_prop_bets DROP CONSTRAINT IF EXISTS player_prop_bets_match_id_player_name_bet_type_side_key;
        ALTER TABLE player_prop_bets DROP CONSTRAINT IF EXISTS player_prop_bets_match_player_type_side_provider_key;
        -- Add definitive constraint
        ALTER TABLE player_prop_bets ADD CONSTRAINT player_prop_bets_match_player_type_side_provider_key UNIQUE (match_id, player_name, bet_type, side, provider);
    END IF;
END $$;

-- 10. OFFICIALS PROTECTION
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='official_profiles') THEN
        CREATE TABLE official_profiles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            sport TEXT NOT NULL,
            lifetime_games INT DEFAULT 0,
            home_win_pct DECIMAL(5,2) DEFAULT 0,
            over_pct DECIMAL(5,2) DEFAULT 0,
            avg_total_points DECIMAL(6,2) DEFAULT 0,
            avg_foul_rate DECIMAL(5,2) DEFAULT 0,
            unique_slug TEXT UNIQUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(name, sport)
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='official_profiles' AND column_name='avg_foul_rate') THEN
        ALTER TABLE official_profiles ADD COLUMN avg_foul_rate DECIMAL(5,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='official_profiles' AND column_name='lifetime_games') THEN
        ALTER TABLE official_profiles ADD COLUMN lifetime_games INT DEFAULT 0;
    END IF;

    -- Ensure UNIQUE constraint on (name, sport) exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc 
        JOIN information_schema.key_column_usage as kcu USING (constraint_schema, constraint_name) 
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = 'official_profiles' AND kcu.column_name IN ('name', 'sport')
        GROUP BY tc.constraint_name, tc.table_name
        HAVING COUNT(*) = 2
    ) THEN
        ALTER TABLE official_profiles ADD CONSTRAINT official_profiles_name_sport_key UNIQUE (name, sport);
    END IF;
END $$;

-- 11. INDICES
CREATE INDEX IF NOT EXISTS idx_stadiums_espn_id ON stadiums(espn_id);
CREATE INDEX IF NOT EXISTS idx_match_news_match_id ON match_news(match_id);
CREATE INDEX IF NOT EXISTS idx_player_props_match_id ON player_prop_bets(match_id);
CREATE INDEX IF NOT EXISTS idx_player_props_player_name ON player_prop_bets(player_name);
