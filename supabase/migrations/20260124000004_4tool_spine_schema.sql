-- 4-Tool Spine: Extend ai_chat_runs with confluence tracking
-- Supports the buildClaimMap → gateDecision → persistRun pipeline

ALTER TABLE public.ai_chat_runs 
ADD COLUMN IF NOT EXISTS confluence_met BOOLEAN,
ADD COLUMN IF NOT EXISTS confluence_score INTEGER,
ADD COLUMN IF NOT EXISTS verdict TEXT,
ADD COLUMN IF NOT EXISTS confidence TEXT,
ADD COLUMN IF NOT EXISTS claims JSONB,
ADD COLUMN IF NOT EXISTS gate_reason TEXT,
ADD COLUMN IF NOT EXISTS match_context JSONB;

-- Add index for analyzing confluence patterns
CREATE INDEX IF NOT EXISTS idx_ai_chat_runs_confluence 
ON public.ai_chat_runs(confluence_met, confluence_score);

COMMENT ON COLUMN public.ai_chat_runs.confluence_met IS 'Whether Triple Confluence gate was passed';
COMMENT ON COLUMN public.ai_chat_runs.confluence_score IS 'How many confluence factors (0-3) were met';
COMMENT ON COLUMN public.ai_chat_runs.claims IS 'Structured claims extracted from AI response with citation IDs';
