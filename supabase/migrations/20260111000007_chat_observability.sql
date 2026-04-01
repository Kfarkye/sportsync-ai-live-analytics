-- Chat Observability Hardening
-- Description: Adds tracing and error columns to the conversations table for real-time chat diagnostics.

-- 1. Updates for conversations table
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS debug_trace JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS last_error TEXT;

-- 2. Ensure GIN index for debug_trace to support SRE queries
CREATE INDEX IF NOT EXISTS idx_conversations_debug_trace ON public.conversations USING GIN (debug_trace);

-- 3. Verify
SELECT 'Chat Observability Columns Added' as status;
