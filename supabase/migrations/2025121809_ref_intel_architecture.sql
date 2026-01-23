
-- Referee / Official Intelligence Table
CREATE TABLE IF NOT EXISTS ref_intel (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id TEXT NOT NULL UNIQUE, -- Link to specific match
    sport TEXT NOT NULL,
    
    -- Aggregate Tendencies (Calculated from historical accuracy/bias)
    tendency TEXT NOT NULL,           -- e.g., 'Home Heavy', 'Strict Crew', 'High Volume'
    tendency_description TEXT,        -- Contextual explanation
    
    home_win_pct DECIMAL(5,2),        -- Historical Home Win rate with this crew
    over_pct DECIMAL(5,2),            -- Historical Over rate
    foul_rate TEXT,                   -- 'High' | 'Average' | 'Low'
    impact_score INT DEFAULT 1,       -- 1-10 intensity/volatility
    
    content JSONB,                    -- Flexible storage for raw stats or deep reports
    
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure sport column exists if table was already created
ALTER TABLE ref_intel ADD COLUMN IF NOT EXISTS sport TEXT NOT NULL DEFAULT 'NFL';

-- Indices for rapid lookup during pre-game render
CREATE INDEX IF NOT EXISTS idx_ref_intel_match_id ON ref_intel (match_id);
CREATE INDEX IF NOT EXISTS idx_ref_intel_sport ON ref_intel (sport);
