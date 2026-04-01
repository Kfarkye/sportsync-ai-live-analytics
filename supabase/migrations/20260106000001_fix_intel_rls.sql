-- Add RLS policy for pregame_intel to allow authenticated users to trigger updates
-- This resolves the "new row violates row-level security policy" error on-demand
-- This resolves the "new row violates row-level security policy" error on-demand
DROP POLICY IF EXISTS "pregame_intel_authenticated_upsert" ON public.pregame_intel;
CREATE POLICY "pregame_intel_authenticated_upsert" ON public.pregame_intel 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
