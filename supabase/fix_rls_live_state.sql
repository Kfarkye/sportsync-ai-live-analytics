-- FIX: RLS FOR LIVE GAME STATE (Kernel Hardening)
-- Ensure both anon and authenticated users can read the state hub

-- 1. Enable RLS
ALTER TABLE public.live_game_state ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies to prevent conflicts
DROP POLICY IF EXISTS "Public read access for live_game_state" ON public.live_game_state;
DROP POLICY IF EXISTS "Allow anon select on live_game_state" ON public.live_game_state;

-- 3. Create explicit policy for unauthenticated users (Anon)
CREATE POLICY "Enable read access for all users" 
ON public.live_game_state 
FOR SELECT 
USING (true);

-- 4. Ensure roles have schema permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.live_game_state TO anon, authenticated;

-- 5. Force Schema Cache Reload (Manual suggestion if running via psql)
-- NOTIFY pgrst, 'reload schema';
