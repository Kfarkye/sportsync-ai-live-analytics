-- ENSURE PREGAME INTEL LOG TABLE EXISTS
-- This table is critical for the cron execution guard and stabilizing the bootstrap cycle.

CREATE TABLE IF NOT EXISTS public.pregame_intel_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id TEXT NOT NULL,
    
    -- Stats
    matches_processed INT DEFAULT 0,
    matches_succeeded INT DEFAULT 0,
    matches_failed INT DEFAULT 0,
    total_cards_generated INT DEFAULT 0,
    total_sources_cited INT DEFAULT 0,
    
    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INT,
    
    -- Details
    errors JSONB DEFAULT '[]',
    sports_covered TEXT[],
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.pregame_intel_log ENABLE ROW LEVEL SECURITY;

-- Service role policy
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'pregame_intel_log' AND policyname = 'pregame_intel_log_service_all'
    ) THEN
        CREATE POLICY "pregame_intel_log_service_all" ON public.pregame_intel_log
            FOR ALL TO service_role USING (true);
    END IF;
END $$;

-- Public read policy (optional for transparency)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'pregame_intel_log' AND policyname = 'pregame_intel_log_public_read'
    ) THEN
        CREATE POLICY "pregame_intel_log_public_read" ON public.pregame_intel_log
            FOR SELECT TO anon, authenticated USING (true);
    END IF;
END $$;

-- Notify PostgREST to refresh its cache
NOTIFY pgrst, 'reload schema';
