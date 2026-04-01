-- Add kernel_trace column to pregame_intel
-- This stores the LLM's internal reasoning chain for transparency

ALTER TABLE pregame_intel ADD COLUMN IF NOT EXISTS kernel_trace TEXT;

COMMENT ON COLUMN pregame_intel.kernel_trace IS 'Internal reasoning chain from the LLM thinking process';
