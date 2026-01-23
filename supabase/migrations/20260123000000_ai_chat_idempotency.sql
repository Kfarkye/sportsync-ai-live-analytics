-- Sr Engineer Grade Idempotency Infrastructure
-- Purpose: Atomic state tracking for AI runs with auditability and strict constraints.

-- 1. Extend picks with run_id and model_id for auditability
ALTER TABLE public.ai_chat_picks 
ADD COLUMN IF NOT EXISTS run_id UUID;

ALTER TABLE public.ai_chat_picks 
ADD COLUMN IF NOT EXISTS model_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_chat_picks_run_id 
ON public.ai_chat_picks(run_id);

-- 2. Create ai_chat_runs with strict enforcement
CREATE TABLE IF NOT EXISTS public.ai_chat_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    run_id UUID NOT NULL,
    
    -- Machine-enforced status state machine
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'streaming', 'completed', 'failed', 'aborted')),
    
    attempt_number INTEGER NOT NULL DEFAULT 1,
    
    -- Metrics & Tracking
    metadata JSONB DEFAULT '{}'::jsonb,
    error_payload JSONB DEFAULT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Hard Idempotency Gate
    UNIQUE(conversation_id, run_id)
);

-- 3. Optimized Indexing for SRE & Logic
CREATE INDEX IF NOT EXISTS idx_ai_chat_runs_lookup 
ON public.ai_chat_runs(conversation_id, status);

CREATE INDEX IF NOT EXISTS idx_ai_chat_runs_timestamp 
ON public.ai_chat_runs(created_at DESC);

-- 4. Automatic timestamp management
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS tr_ai_chat_runs_updated_at ON public.ai_chat_runs;
CREATE TRIGGER tr_ai_chat_runs_updated_at
    BEFORE UPDATE ON public.ai_chat_runs
    FOR EACH ROW
    EXECUTE PROCEDURE public.set_updated_at();
