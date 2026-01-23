-- Add observability columns to matches and live_game_state
-- Description: Enables high-resolution tracing of data ingest decisions and logic engine reasoning.

ALTER TABLE matches 
ADD COLUMN IF NOT EXISTS ingest_trace JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS last_ingest_error TEXT;

ALTER TABLE live_game_state 
ADD COLUMN IF NOT EXISTS logic_trace JSONB DEFAULT '[]'::jsonb;

-- Ensure indexes for performance on JSONB columns (GIN index) if we ever query them, 
-- but for now, they are primarily for SRE retrieval by ID.
CREATE INDEX IF NOT EXISTS idx_matches_ingest_trace ON matches USING GIN (ingest_trace);
