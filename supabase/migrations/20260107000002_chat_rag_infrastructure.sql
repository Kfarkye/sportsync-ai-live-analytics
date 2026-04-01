-- =================================================================
-- Google-Grade RAG Infrastructure
-- Enabled Semantic Search & Vector Embeddings
-- =================================================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Chat Knowledge Base
-- Stores analytical fragments, coaching notes, and historical intelligence
CREATE TABLE IF NOT EXISTS public.chat_knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    category TEXT, -- 'COACHING', 'INJURY', 'HISTORY', 'INSTITUTIONAL'
    embedding vector(768), -- Gemini / Vertex Dimension
    source_id TEXT, -- e.g., intel_id or card_id
    source_type TEXT, -- e.g., 'INTEL_CARD', 'LOGIC_AUDIT'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(source_id, source_type)
);

-- 3. Match Knowledge Base RPC
-- Professional multi-stage similarity search
CREATE OR REPLACE FUNCTION public.match_chat_knowledge (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ckb.id,
    ckb.content,
    ckb.metadata,
    1 - (ckb.embedding <=> query_embedding) AS similarity
  FROM public.chat_knowledge_base ckb
  WHERE 1 - (ckb.embedding <=> query_embedding) > match_threshold
  ORDER BY ckb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 4. Indices
CREATE INDEX IF NOT EXISTS idx_ckb_category ON public.chat_knowledge_base(category);

-- 5. RLS
ALTER TABLE public.chat_knowledge_base ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ckb_public_read" ON public.chat_knowledge_base;
CREATE POLICY "ckb_public_read" ON public.chat_knowledge_base FOR SELECT USING (true);
DROP POLICY IF EXISTS "ckb_service_write" ON public.chat_knowledge_base;
CREATE POLICY "ckb_service_write" ON public.chat_knowledge_base FOR ALL TO service_role USING (true);

-- 6. Initial Seed: RAG-ify the Institutional Profiles
-- (Embeddings will be populated by a future service call or manual script)
INSERT INTO public.chat_knowledge_base (content, metadata, category)
VALUES 
(
    'MIA (Miami Heat) Institutional Exhaustion Profile: MIA slows down rhythm AND loses efficiency in 4th. Defense remains elite/stable. Prime UNDER candidate in late-game lulls.',
    '{"team_id": "MIA", "league": "nba"}',
    'INSTITUTIONAL'
),
(
    'NOP (New Orleans Pelicans) Institutional Grinder Profile: NOP slows down significantly (-1.05 pace) but stays sharp. Efficiency holds and defense actually improves. Tactical decelerators, not fatigue-driven.',
    '{"team_id": "NOP", "league": "nba"}',
    'INSTITUTIONAL'
)
ON CONFLICT DO NOTHING;

SELECT 'RAG Infrastructure Deployed' AS status;
