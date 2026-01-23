-- Manchester City 2025-26 Institutional Profile
-- Forensic grounding for AI analysis of tactical deceleration.

-- Self-Healing: Ensure table exists if previous migrations were skipped
CREATE TABLE IF NOT EXISTS public.institutional_team_profiles (
    team_id TEXT PRIMARY KEY,
    league_id TEXT NOT NULL,
    q4_pace_delta NUMERIC DEFAULT 0,
    q4_efficiency_delta NUMERIC DEFAULT 0,
    q4_defensive_delta NUMERIC DEFAULT 0,
    meta_notes TEXT,
    last_audited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS and Policies if they don't exist
ALTER TABLE public.institutional_team_profiles ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read access' AND tablename = 'institutional_team_profiles') THEN
        CREATE POLICY "Allow public read access" ON public.institutional_team_profiles FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow service role full access' AND tablename = 'institutional_team_profiles') THEN
        CREATE POLICY "Allow service role full access" ON public.institutional_team_profiles USING (true) WITH CHECK (true);
    END IF;
END $$;

INSERT INTO public.institutional_team_profiles 
(team_id, league_id, q4_pace_delta, q4_efficiency_delta, q4_defensive_delta, meta_notes)
VALUES 
(
    'MCI', 
    'soccer_epl', 
    -0.45, 
    0.15, 
    -0.20, 
    'Institutional Control Profile: MCI dominates possession to limit total game variance. 75% Under 3.5 hit rate in 2025-26. Prime candidate for total unders when leading by 2.'
)
ON CONFLICT (team_id) DO UPDATE SET
    q4_pace_delta = EXCLUDED.q4_pace_delta,
    q4_efficiency_delta = EXCLUDED.q4_efficiency_delta,
    q4_defensive_delta = EXCLUDED.q4_defensive_delta,
    meta_notes = EXCLUDED.meta_notes,
    updated_at = NOW();
