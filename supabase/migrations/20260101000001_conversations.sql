-- ═══════════════════════════════════════════════════════════════════════════
-- CONVERSATIONS TABLE - Context-Aware AI Chat
-- Google-Grade Architecture: JSONB payload for conversation history
-- ═══════════════════════════════════════════════════════════════════════════

-- Conversations table with full history as JSONB
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Optional: Link to authenticated user (if you add auth later)
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Session identifier for anonymous users (device fingerprint or localStorage ID)
    session_id TEXT,
    
    -- JSONB array of messages: [{ role, content, timestamp, match_context?, sources? }]
    messages JSONB DEFAULT '[]'::jsonb NOT NULL,
    
    -- Active context the AI "remembers" from conversation
    -- Extracted entities, preferences, discussed topics
    active_context JSONB DEFAULT '{}'::jsonb NOT NULL,
    
    -- Current match the user is viewing (NULL if on home/list page)
    current_match_id TEXT,
    
    -- Behavioral tracking: What matches has this user engaged with?
    viewed_matches JSONB DEFAULT '[]'::jsonb NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    last_message_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    
    -- Soft TTL: Conversations older than 24h can be cleaned up
    expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours') NOT NULL
);

-- Indexes for fast lookup
-- CREATE INDEX IF NOT EXISTS idx_conversations_session ON public.conversations(session_id);
-- -- CREATE INDEX IF NOT EXISTS idx_conversations_user ON public.conversations(user_id);
-- CREATE INDEX IF NOT EXISTS idx_conversations_current_match ON public.conversations(current_match_id);
-- CREATE INDEX IF NOT EXISTS idx_conversations_expires ON public.conversations(expires_at);
--
-- -- GIN index for JSONB queries (e.g., "find all convos that mentioned Lakers")
-- CREATE INDEX IF NOT EXISTS idx_conversations_context_gin ON public.conversations USING GIN (active_context);

-- ═══════════════════════════════════════════════════════════════════════════
-- MATCH ENGAGEMENT TRACKING
-- Track which matches users spend time on for smarter context inference
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.match_engagement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    
    -- Engagement metrics
    view_count INT DEFAULT 1 NOT NULL,
    total_time_seconds INT DEFAULT 0 NOT NULL,
    last_viewed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    first_viewed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    
    -- Did they interact with specific features?
    viewed_odds BOOLEAN DEFAULT false,
    viewed_props BOOLEAN DEFAULT false,
    viewed_intel BOOLEAN DEFAULT false,
    asked_ai_about BOOLEAN DEFAULT false,
    
    UNIQUE(session_id, match_id)
);

-- CREATE INDEX IF NOT EXISTS idx_engagement_session ON public.match_engagement(session_id);
-- CREATE INDEX IF NOT EXISTS idx_engagement_match ON public.match_engagement(match_id);
-- CREATE INDEX IF NOT EXISTS idx_engagement_last_viewed ON public.match_engagement(last_viewed_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS POLICIES
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_engagement ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON public.conversations
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON public.match_engagement
    FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTION: Get or create conversation for session
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_or_create_conversation(
    p_session_id TEXT,
    p_match_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_conversation_id UUID;
BEGIN
    -- Try to find existing active conversation for this specific match (if provided)
    -- This ensures "clicking in and out" of a game keeps the memory persistent
    IF p_match_id IS NOT NULL THEN
        SELECT id INTO v_conversation_id
        FROM public.conversations
        WHERE session_id = p_session_id
          AND current_match_id = p_match_id
          AND expires_at > now()
        ORDER BY updated_at DESC
        LIMIT 1;
    ELSE
        -- Global session lookup (non-match specific)
        SELECT id INTO v_conversation_id
        FROM public.conversations
        WHERE session_id = p_session_id
          AND current_match_id IS NULL
          AND expires_at > now()
        ORDER BY updated_at DESC
        LIMIT 1;
    END IF;
    
    -- Create new if none exists
    IF v_conversation_id IS NULL THEN
        INSERT INTO public.conversations (session_id, current_match_id)
        VALUES (p_session_id, p_match_id)
        RETURNING id INTO v_conversation_id;
    END IF;
    
    RETURN v_conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTION: Track match engagement
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION track_match_view(
    p_session_id TEXT,
    p_match_id TEXT,
    p_time_seconds INT DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.match_engagement (session_id, match_id, total_time_seconds)
    VALUES (p_session_id, p_match_id, p_time_seconds)
    ON CONFLICT (session_id, match_id) DO UPDATE SET
        view_count = match_engagement.view_count + 1,
        total_time_seconds = match_engagement.total_time_seconds + EXCLUDED.total_time_seconds,
        last_viewed_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════
-- CLEANUP: Auto-expire old conversations (run via pg_cron if available)
-- ═══════════════════════════════════════════════════════════════════════════

-- SELECT cron.schedule('cleanup-expired-conversations', '0 */6 * * *', $$
--     DELETE FROM public.conversations WHERE expires_at < now();
-- $$);

COMMENT ON TABLE public.conversations IS 
'Stores AI chat conversation history with JSONB messages array. 
Each session maintains context across the current browsing session.
Current match context is injected automatically based on which page the user is viewing.';

COMMENT ON TABLE public.match_engagement IS
'Tracks which matches users engage with to infer context for AI responses.
If a user asks "any props for this game?" we can infer which game based on recent engagement.';
