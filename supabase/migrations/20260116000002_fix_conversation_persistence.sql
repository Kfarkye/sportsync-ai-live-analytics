-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: Conversation Persistence + AI Pick Tracking
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add match_id column if it doesn't exist (for compatibility)
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS match_id TEXT;

-- 2. Fix the RPC to use both column names for compatibility
DROP FUNCTION IF EXISTS get_or_create_conversation(text, text) CASCADE;

CREATE OR REPLACE FUNCTION get_or_create_conversation(p_session_id text, p_match_id text DEFAULT NULL)
RETURNS uuid AS $$
DECLARE v_conv_id uuid;
BEGIN
  -- Look for existing conversation for this session + match
  SELECT id INTO v_conv_id 
  FROM conversations 
  WHERE session_id = p_session_id 
    AND (
      (p_match_id IS NOT NULL AND (match_id = p_match_id OR current_match_id = p_match_id))
      OR (p_match_id IS NULL AND match_id IS NULL AND current_match_id IS NULL)
    )
    AND expires_at > now()
  ORDER BY last_message_at DESC
  LIMIT 1;
  
  -- Create new conversation if none found
  IF v_conv_id IS NULL THEN
    INSERT INTO conversations (session_id, match_id, current_match_id, messages)
    VALUES (p_session_id, p_match_id, p_match_id, '[]'::jsonb)
    RETURNING id INTO v_conv_id;
  END IF;
  
  RETURN v_conv_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. AI CHAT PICKS TABLE - Track all AI recommendations for performance analysis
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ai_chat_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Conversation context
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL,
  
  -- Match context
  match_id TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  league TEXT NOT NULL,
  
  -- Pick details
  pick_type TEXT NOT NULL, -- 'spread', 'total', 'moneyline', 'puckline', 'runline', 'player_prop'
  pick_side TEXT NOT NULL, -- Team name or 'OVER'/'UNDER'
  pick_line DECIMAL(5,1), -- e.g., -3.5, 220.5
  pick_odds INTEGER, -- American odds: -110, +150
  
  -- AI reasoning
  user_query TEXT NOT NULL,
  ai_response_snippet TEXT, -- First 500 chars of response
  ai_confidence TEXT, -- 'high', 'medium', 'low' extracted from response
  reasoning_summary TEXT, -- Extracted key reasoning
  
  -- Grading (filled in later by closing line check)
  result TEXT DEFAULT 'pending', -- 'win', 'loss', 'push', 'pending', 'no_action'
  closing_line DECIMAL(5,1), -- Line at game start
  clv DECIMAL(4,1), -- Closing Line Value (positive = beat market)
  graded_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  game_start_time TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_picks_session ON public.ai_chat_picks(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_picks_match ON public.ai_chat_picks(match_id);
CREATE INDEX IF NOT EXISTS idx_ai_picks_result ON public.ai_chat_picks(result);
CREATE INDEX IF NOT EXISTS idx_ai_picks_created ON public.ai_chat_picks(created_at DESC);

-- RLS
ALTER TABLE public.ai_chat_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.ai_chat_picks
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Anon can insert picks" ON public.ai_chat_picks
  FOR INSERT WITH CHECK (true);

COMMENT ON TABLE public.ai_chat_picks IS
'Tracks all AI chat pick recommendations for performance analysis. Links to conversations for context.';
