-- Pregame Intel System Hardening Migration
-- 1. Add logic_group column for pick categorization
-- 2. Add confidence_tier for pick quality
-- 3. Add unique constraint to prevent duplicates
-- 4. Clean up existing duplicates first

-- Step 1: Add new columns
ALTER TABLE public.pregame_intel
ADD COLUMN IF NOT EXISTS logic_group TEXT,
ADD COLUMN IF NOT EXISTS confidence_tier TEXT CHECK (confidence_tier IN ('HIGH', 'MEDIUM', 'LOW')),
ADD COLUMN IF NOT EXISTS pick_summary TEXT;

-- Step 2: Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_pregame_intel_logic_group 
ON pregame_intel(logic_group) WHERE logic_group IS NOT NULL;

-- Step 3: Delete exact duplicates (keep first by intel_id)
DELETE FROM pregame_intel a
USING pregame_intel b
WHERE a.intel_id > b.intel_id
  AND a.match_id = b.match_id
  AND a.recommended_pick = b.recommended_pick;

-- Step 4: Add unique constraint to prevent future duplicates
-- Using match_id + bet type hash (spread/total/ml + side)
ALTER TABLE public.pregame_intel
ADD CONSTRAINT unique_pick_per_match_bet 
UNIQUE (match_id, recommended_pick);

-- Step 5: Grant permissions
GRANT SELECT ON public.pregame_intel TO authenticated;
GRANT SELECT ON public.pregame_intel TO anon;

-- Verification
SELECT 'pregame_intel_hardening_complete' as result;
