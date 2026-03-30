-- 20260113000001_harden_intel_rls.sql
-- Force bypass for mission critical analytical engines
-- Objective: Ensure service_role always has UNDISPUTED access to intel and mapping tables.

-- 1. Pregame Intel (The Computer Group Standard)
ALTER TABLE public.pregame_intel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_unrestricted" ON public.pregame_intel;
CREATE POLICY "service_role_unrestricted" ON public.pregame_intel
    FOR ALL TO service_role USING (true) WITH CHECK (true);
-- 2. Entity Mappings (The Missing Link)
ALTER TABLE public.entity_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_unrestricted" ON public.entity_mappings;
CREATE POLICY "service_role_unrestricted" ON public.entity_mappings
    FOR ALL TO service_role USING (true) WITH CHECK (true);
-- 3. Originator Locks (Atomic Concurrency)
ALTER TABLE public.originator_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_unrestricted" ON public.originator_locks;
CREATE POLICY "service_role_unrestricted" ON public.originator_locks
    FOR ALL TO service_role USING (true) WITH CHECK (true);
SELECT 'RLS HARDENING COMPLETE: Service Role Undisputed Access Active.' as status;
