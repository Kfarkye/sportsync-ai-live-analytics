-- Migration: Create team_blowout_priors table
-- Created at: 2025-12-24

CREATE TABLE IF NOT EXISTS public.team_blowout_priors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league TEXT NOT NULL DEFAULT 'NBA',
    season TEXT NOT NULL,
    team_abbr TEXT NOT NULL,
    "leading" JSONB DEFAULT '{}',
    "trailing" JSONB DEFAULT '{}',
    baseline JSONB DEFAULT '{}',
    meta JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(league, season, team_abbr)
);

-- Index for lookup
CREATE INDEX IF NOT EXISTS idx_team_blowout_priors_lookup ON team_blowout_priors(league, season, team_abbr);

-- Enable RLS (adjust policies as needed)
ALTER TABLE public.team_blowout_priors ENABLE ROW LEVEL SECURITY;

-- Allow public read access (matches anon policy in other tables)
DROP POLICY IF EXISTS "Allow public read access" ON public.team_blowout_priors;
CREATE POLICY "Allow public read access" ON public.team_blowout_priors
    FOR SELECT TO anon, authenticated
    USING (true);

COMMENT ON TABLE team_blowout_priors IS 'Stores team-specific blowout deltas and baseline priors for regime shift analysis.';
