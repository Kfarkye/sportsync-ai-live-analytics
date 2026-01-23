-- SRE Hardening: Ensure service_role can always write to pregame_intel
-- This bypasses RLS for the automated workers.

DO $$ 
BEGIN
    -- 1. Ensure service_role has ALL permissions
    GRANT ALL ON public.pregame_intel TO service_role;
    GRANT ALL ON public.pregame_intel_log TO service_role;
    
    -- 2. Explicitly create a policy for service_role if RLS is enabled and forced
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'pregame_intel' AND policyname = 'service_role_all'
    ) THEN
        CREATE POLICY "service_role_all" ON public.pregame_intel
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;

    -- 3. Fix nba_games status column if missing (from logs)
    -- This was previously commented out in 20251231000003_fix_nba_status.sql
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nba_games' AND column_name = 'status') THEN
        ALTER TABLE nba_games ADD COLUMN status TEXT;
    END IF;
END $$;

-- 4. Replace hardcoded placeholders in critical cron functions
-- This fixes the user's "placeholder" complaint in 20260111000001_harden_cron_secrets.sql
CREATE OR REPLACE FUNCTION invoke_ingest_nba_live()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  FOR i IN 0..5 LOOP
      IF i > 0 THEN PERFORM pg_sleep(10); END IF;
      PERFORM net.http_post(
        url := v_url || '/functions/v1/ingest-odds',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := '{"sport_key": "basketball_nba"}'::jsonb
      );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION invoke_ingest_odds_staggered()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  v_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  v_secret text := 'XVAVO7RWXpT0fsTdXBr5OmHlR8MrEKeJ';
BEGIN
  PERFORM net.http_post(
    url := v_url || '/functions/v1/ingest-odds',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
END;
$$;

-- Notify PostgREST
NOTIFY pgrst, 'reload schema';
