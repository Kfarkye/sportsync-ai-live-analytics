
-- 1. Official Profiles (Central Registry for Officials)
CREATE TABLE IF NOT EXISTS official_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    sport TEXT NOT NULL,
    
    -- Lifetime Stats (Calculated & Updated by Trend Engine)
    lifetime_games INT DEFAULT 0,
    home_win_pct DECIMAL(5,2) DEFAULT 0,
    over_pct DECIMAL(5,2) DEFAULT 0,
    avg_total_points DECIMAL(6,2) DEFAULT 0,
    avg_foul_rate DECIMAL(5,2) DEFAULT 0,
    
    unique_slug TEXT UNIQUE, -- e.g. 'scott-foster-nba'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(name, sport)
);

-- 2. Official Game History (The Join Table)
-- Links officials to the matches they have worked
CREATE TABLE IF NOT EXISTS official_game_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    official_id UUID REFERENCES official_profiles(id),
    match_id TEXT NOT NULL, -- ESPN Match ID
    sport TEXT NOT NULL,
    position TEXT,          -- Crew Chief, Umpire, Referee, etc.
    
    -- Result Snapshot (for rapid calculation without joining game_results)
    is_home_win BOOLEAN,
    is_over BOOLEAN,
    total_points INT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_official_history_lookup ON official_game_history (match_id);
CREATE INDEX IF NOT EXISTS idx_official_history_official_id ON official_game_history (official_id);
CREATE INDEX IF NOT EXISTS idx_official_profiles_name ON official_profiles (name);

-- 3. Auto-Slug Trigger for Official Profiles
CREATE OR REPLACE FUNCTION generate_official_slug()
RETURNS TRIGGER AS $$
BEGIN
    NEW.unique_slug := LOWER(REPLACE(NEW.name, ' ', '-')) || '-' || LOWER(NEW.sport);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_official_slug ON official_profiles;
CREATE TRIGGER trg_official_slug
    BEFORE INSERT ON official_profiles
    FOR EACH ROW
    EXECUTE FUNCTION generate_official_slug();
