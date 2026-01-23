-- Migration: 20260121000001_llm_model_picks.sql
-- Description: Table for tracking AI picks per specific LLM model for performance analysis and failover audits.

CREATE TABLE IF NOT EXISTS llm_model_picks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id TEXT NOT NULL,           -- e.g., 'gemini-3-flash-preview', 'claude-3-5-sonnet', 'gpt-4o'
    session_id TEXT,                  -- Client session ID
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    match_id TEXT,                    -- Canonical match ID
    home_team TEXT,
    away_team TEXT,
    league TEXT,                      -- normalized league/sport
    
    -- Pick Details
    pick_type TEXT,                  -- 'spread', 'total', 'moneyline'
    pick_side TEXT,                  -- 'HOME', 'AWAY', 'OVER', 'UNDER', or Team Name
    pick_line FLOAT,                 -- e.g., -7.5 or 215.5
    pick_odds INT,                   -- e.g., -110 or +150
    
    -- Meta
    ai_confidence TEXT,              -- 'high', 'medium', 'low'
    reasoning_summary TEXT,          -- Snippet of why the model liked this
    game_start_time TIMESTAMPTZ,     -- For grouping by game day
    
    -- Grading
    pick_result TEXT DEFAULT 'PENDING',  -- 'WIN', 'LOSS', 'PUSH', 'PENDING'
    graded_at TIMESTAMPTZ,
    
    -- Telemetry
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'      -- For any extra model-specific info (latency, tokens, etc.)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_llm_model_picks_model ON llm_model_picks(model_id);
CREATE INDEX IF NOT EXISTS idx_llm_model_picks_match_id ON llm_model_picks(match_id);
CREATE INDEX IF NOT EXISTS idx_llm_model_picks_result ON llm_model_picks(pick_result);
CREATE INDEX IF NOT EXISTS idx_llm_model_picks_created_at ON llm_model_picks(created_at);

-- RLS (Row Level Security) - Enable service role access
ALTER TABLE llm_model_picks ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on llm_model_picks" 
ON llm_model_picks 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- Allow authenticated users to view picks (optional, for dashboard)
CREATE POLICY "Authenticated users can view llm_model_picks" 
ON llm_model_picks 
FOR SELECT 
TO authenticated 
USING (true);

COMMENT ON TABLE llm_model_picks IS 'Stores betting recommendations from different LLM models for multi-model performance tracking and auto-failover verification.';
