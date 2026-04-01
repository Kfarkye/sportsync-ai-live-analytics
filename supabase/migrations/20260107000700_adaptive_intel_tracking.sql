-- Add analyzed line tracking to pregame_intel
-- This allows the system to detect when the market has moved significantly
-- and re-trigger analysis for the current line.

ALTER TABLE public.pregame_intel 
ADD COLUMN IF NOT EXISTS analyzed_spread DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS analyzed_total DECIMAL(5,2);

-- Also ensure recommended_pick and other mission-critical columns exist
-- (Adding them here just in case they were added out-of-band)
ALTER TABLE public.pregame_intel 
ADD COLUMN IF NOT EXISTS recommended_pick TEXT,
ADD COLUMN IF NOT EXISTS logic_authority TEXT,
ADD COLUMN IF NOT EXISTS confidence_score INT;

-- Verify
SELECT 'adaptive tracking columns added' as result;
