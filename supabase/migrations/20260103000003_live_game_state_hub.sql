-- REALTIME HUB: LIVE GAME STATE SCHEMA (Optimized)
-- v5.1 | January 3, 2026

CREATE TABLE IF NOT EXISTS public.live_game_state (
    id TEXT PRIMARY KEY,
    league_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    
    -- Scoreboard Snapshot
    game_status TEXT NOT NULL DEFAULT 'SCHEDULED',
    period INTEGER,
    clock TEXT,
    home_score INTEGER DEFAULT 0,
    away_score INTEGER DEFAULT 0,
    
    -- High-Resolution Detail (JSONB for flexibility)
    situation JSONB,
    last_play JSONB,
    current_drive JSONB,

    -- Deterministic Signals (Calculated by server-side GameStateEngine)
    deterministic_signals JSONB,
    
    -- AI Forensic Narrative (The "Pulse" from Gemini)
    ai_analysis JSONB,

    -- Metadata
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. PERFORMANCE & SECURITY
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_live_game_state_status ON public.live_game_state(game_status);
CREATE INDEX IF NOT EXISTS idx_live_game_state_sport ON public.live_game_state(sport);

ALTER TABLE public.live_game_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access for live_game_state" ON public.live_game_state;
CREATE POLICY "Public read access for live_game_state" 
ON public.live_game_state FOR SELECT TO public USING (true);

-- Enable Supabase Realtime
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'live_game_state'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.live_game_state;
    END IF;
END $$;

-- ============================================================================
-- 3. INGESTION HUB CRON CONFIGURATION
-- ============================================================================

DROP FUNCTION IF EXISTS invoke_ingest_live_games() CASCADE;

CREATE OR REPLACE FUNCTION invoke_ingest_live_games()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url text;
  service_key text;
BEGIN
  SELECT decrypted_secret INTO service_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'supabase_service_role_key' LIMIT 1;
  
  base_url := current_setting('app.settings.supabase_url', true);
  
  IF base_url IS NULL OR base_url = '' THEN
    SELECT decrypted_secret INTO base_url 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_url' LIMIT 1;
  END IF;
  
  IF base_url IS NOT NULL AND service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := base_url || '/functions/v1/ingest-live-games',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$$;

SELECT cron.schedule(
  'high-frequency-live-ingest',
  '* * * * *', 
  $$SELECT invoke_ingest_live_games()$$
);
