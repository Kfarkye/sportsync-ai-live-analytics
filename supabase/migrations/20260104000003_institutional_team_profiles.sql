-- Institutional Team Profiles Migration
-- Purpose: Store forensic performance deltas and user-curated meta notes for grounding AI analysis.

CREATE TABLE IF NOT EXISTS public.institutional_team_profiles (
    team_id TEXT PRIMARY KEY, -- e.g., 'MIA', 'NOP'
    league_id TEXT NOT NULL, -- e.g., 'nba'
    q4_pace_delta NUMERIC DEFAULT 0,
    q4_efficiency_delta NUMERIC DEFAULT 0, -- ORTG Variance
    q4_defensive_delta NUMERIC DEFAULT 0,  -- DRTG Variance
    meta_notes TEXT,
    last_audited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.institutional_team_profiles ENABLE ROW LEVEL SECURITY;

-- Allow public read access (for edge functions and frontend)
-- Allow public read access (for edge functions and frontend)
DROP POLICY IF EXISTS "Allow public read access" ON public.institutional_team_profiles;
CREATE POLICY "Allow public read access" ON public.institutional_team_profiles
    FOR SELECT USING (true);

-- Allow service role full access
DROP POLICY IF EXISTS "Allow service role full access" ON public.institutional_team_profiles;
CREATE POLICY "Allow service role full access" ON public.institutional_team_profiles
    USING (true) WITH CHECK (true);

-- INITIAL SEEDING FOR MIA AND NOP
INSERT INTO public.institutional_team_profiles 
(team_id, league_id, q4_pace_delta, q4_efficiency_delta, q4_defensive_delta, meta_notes)
VALUES 
(
    'MIA', 
    'nba', 
    -0.78, 
    -1.23, 
    0.08, 
    'Institutional Exhaustion Profile: MIA slows down rhythm AND loses efficiency in 4th. Defense remains elite/stable. Prime UNDER candidate in late-game lulls.'
),
(
    'NOP', 
    'nba', 
    -1.05, 
    0.37, 
    -0.71, 
    'Institutional Grinder Profile: NOP slows down significantly (-1.05 pace) but stays sharp. Efficiency holds and defense actually improves. Tactical decelerators, not fatigue-driven.'
)
ON CONFLICT (team_id) DO UPDATE SET
    q4_pace_delta = EXCLUDED.q4_pace_delta,
    q4_efficiency_delta = EXCLUDED.q4_efficiency_delta,
    q4_defensive_delta = EXCLUDED.q4_defensive_delta,
    meta_notes = EXCLUDED.meta_notes,
    updated_at = NOW();
