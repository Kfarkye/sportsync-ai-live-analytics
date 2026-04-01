-- 20260116000001_pregame_intel_juice_columns.sql
-- Adds high-fidelity market pricing columns (juice, moneyline) to pregame_intel table.
-- This enables the UI to display accurate pricing alongside the pick.

-- 1. Add juice and moneyline columns
ALTER TABLE public.pregame_intel
ADD COLUMN IF NOT EXISTS spread_juice TEXT,
ADD COLUMN IF NOT EXISTS total_juice TEXT,
ADD COLUMN IF NOT EXISTS home_ml TEXT,
ADD COLUMN IF NOT EXISTS away_ml TEXT;

-- 2. Add index for faster lookups by match_id (if not exists)
CREATE INDEX IF NOT EXISTS idx_pregame_intel_match_id ON public.pregame_intel(match_id);

-- 3. Verification
SELECT 'Juice columns added to pregame_intel' as status;
