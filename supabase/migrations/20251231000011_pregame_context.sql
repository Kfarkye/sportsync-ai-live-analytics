-- NBA PREGAME CONTEXT TABLE
-- Stores validated, stance-free pregame intelligence from Gemini

CREATE TABLE IF NOT EXISTS nba_pregame_context (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    match_id TEXT NOT NULL,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'gemini_cron',
    
    -- Structured context payload (validated JSON)
    context_jsonb JSONB NOT NULL,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
    
    -- Unique constraint per match per day
    -- CONSTRAINT unique_match_context UNIQUE (match_id, (generated_at::date))
);

-- Enable RLS
ALTER TABLE nba_pregame_context ENABLE ROW LEVEL SECURITY;

-- Public read access (no sensitive data)
CREATE POLICY "Public read access" ON nba_pregame_context
    FOR SELECT USING (true);

-- Service role insert/update
CREATE POLICY "Service role write access" ON nba_pregame_context
    FOR ALL USING (auth.role() = 'service_role');

-- Index for fast lookups
CREATE INDEX idx_pregame_context_match_id ON nba_pregame_context(match_id);
CREATE INDEX idx_pregame_context_generated_at ON nba_pregame_context(generated_at DESC);

-- Debug table for raw LLM output (internal only, never served)
CREATE TABLE IF NOT EXISTS nba_pregame_context_debug (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    match_id TEXT NOT NULL,
    raw_llm_text TEXT,
    validation_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- No public access to debug table
ALTER TABLE nba_pregame_context_debug ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON nba_pregame_context_debug
    FOR ALL USING (auth.role() = 'service_role');
