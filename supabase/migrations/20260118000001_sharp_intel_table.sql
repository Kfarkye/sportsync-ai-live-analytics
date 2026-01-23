-- Create sharp_intel table for the parallel Sharp Engine
-- Completely separate from pregame_intel (the fade engine)

CREATE TABLE IF NOT EXISTS sharp_intel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID, -- For linking to ai-chat sessions
    match_id TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    league TEXT, -- Added for filtering
    pick_type TEXT NOT NULL, -- 'spread', 'total', 'moneyline'
    pick_side TEXT NOT NULL, -- team name or 'OVER'/'UNDER'
    pick_line NUMERIC,
    pick_odds INTEGER DEFAULT -110,
    ai_confidence TEXT DEFAULT 'medium', -- 'high', 'medium', 'low'
    reasoning_summary TEXT,
    
    -- Chat metadata (for audit/context)
    user_query TEXT,
    ai_response_snippet TEXT,
    
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    game_start_time TIMESTAMPTZ, -- For grading logic
    
    -- Grading & Result Tracking
    pick_result TEXT, -- 'WIN', 'LOSS', 'PUSH', 'PENDING'
    graded_at TIMESTAMPTZ,
    actual_home_score INTEGER,
    actual_away_score INTEGER,
    closing_line NUMERIC, -- For CLV analysis
    clv NUMERIC -- Closing Line Value
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_sharp_intel_match ON sharp_intel(match_id);
CREATE INDEX IF NOT EXISTS idx_sharp_intel_conv ON sharp_intel(conversation_id);
CREATE INDEX IF NOT EXISTS idx_sharp_intel_result ON sharp_intel(pick_result);
CREATE INDEX IF NOT EXISTS idx_sharp_intel_generated ON sharp_intel(generated_at);

-- View for sharp intel performance tracking
CREATE OR REPLACE VIEW sharp_intel_record AS
SELECT 
    COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
    COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes,
    ROUND(100.0 * COUNT(*) FILTER (WHERE pick_result = 'WIN') / 
        NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0), 1) as win_pct
FROM sharp_intel
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH');
