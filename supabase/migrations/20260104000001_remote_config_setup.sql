-- REMOTE CONFIG: DYNAMIC GATES SCHEMA
-- v1.0 | January 4, 2026

-- 1. Create the table
CREATE TABLE IF NOT EXISTS public.app_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable Performance & Security
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access for app_config" ON public.app_config;
CREATE POLICY "Public read access for app_config" 
ON public.app_config FOR SELECT TO public USING (true);

-- 3. Enable Realtime
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'app_config'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.app_config;
    END IF;
END $$;

-- 4. Seed Default Gates (Mapping from SYSTEM_GATES in gates.ts)
INSERT INTO public.app_config (key, value, description)
VALUES 
('NFL_GATES', '{
    "AVG_DRIVES_PER_GAME": 22.0,
    "SEC_PER_DRIVE_STD": 155,
    "SEC_PER_DRIVE_HURRY": 100,
    "SEC_PER_DRIVE_MILK": 180,
    "KEY_NUMBERS": [3, 7, 10, 14],
    "KEY_TOTALS": [37, 41, 43, 44, 47, 51],
    "GARBAGE_TIME_DIFF": 24,
    "MIN_DRIVES_OBSERVED": 4
}'::jsonb, 'NFL Physics & Pace Constants'),
('NBA_GATES', '{
    "BASELINE_PACE": 98.5,
    "CRUNCH_TIME_SEC": 120,
    "FOUL_GAME_DIFF": 8,
    "BLOWOUT_DIFF": 22,
    "ACTIONABLE_EDGE": 3.5,
    "BLOWOUT_SCALAR": 0.90,
    "FOUL_ADDER": 3.0,
    "ENDGAME_ADDER": 6.0,
    "ENDGAME_START_MIN": 42
}'::jsonb, 'NBA Performance & Endgame Tuning'),
('NHL_GATES', '{
    "SOG_CONVERSION_AVG": 0.096,
    "MIN_EVENTS_TRUST": 15,
    "TIED_DECAY_MULT": 0.75,
    "EN_INJECTION_1G": 0.85,
    "EN_INJECTION_2G": 0.70,
    "P3_INFLATION": 1.25,
    "PROACTIVE_EN_WEIGHT": 0.45
}'::jsonb, 'NHL Shot Conversion & Empty Net Weighting')
ON CONFLICT (key) DO NOTHING;
