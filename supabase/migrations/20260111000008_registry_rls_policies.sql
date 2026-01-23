-- 20260111000008_registry_rls_policies.sql
-- Hardening RLS for match registry tables to prevent 406/403 errors on the frontend.

-- Enable RLS
ALTER TABLE public.entity_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_games ENABLE ROW LEVEL SECURITY;

-- Add PUBLIC read access (Read-only for all clients)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Read Access' AND tablename = 'entity_mappings') THEN
        CREATE POLICY "Public Read Access" ON public.entity_mappings FOR SELECT USING (true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Read Access' AND tablename = 'canonical_teams') THEN
        CREATE POLICY "Public Read Access" ON public.canonical_teams FOR SELECT USING (true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Read Access' AND tablename = 'canonical_games') THEN
        CREATE POLICY "Public Read Access" ON public.canonical_games FOR SELECT USING (true);
    END IF;
END
$$;
