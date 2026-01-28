-- Migration: Add final score columns + MANUAL_REVIEW support
-- Part of the Strict Grading Architecture (Jan 27, 2026)

-- 1) Add final score columns for audit evidence
ALTER TABLE public.pregame_intel
ADD COLUMN IF NOT EXISTS final_home_score INTEGER,
ADD COLUMN IF NOT EXISTS final_away_score INTEGER;

-- 2) Add graded_at timestamp for tracking
ALTER TABLE public.pregame_intel
ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ;

-- 3) Comments for documentation
COMMENT ON COLUMN public.pregame_intel.final_home_score IS 'Final home team score at grading time - audit evidence';
COMMENT ON COLUMN public.pregame_intel.final_away_score IS 'Final away team score at grading time - audit evidence';
COMMENT ON COLUMN public.pregame_intel.graded_at IS 'Timestamp when pick was graded';

-- 4) Index for finding stale PENDING picks efficiently
CREATE INDEX IF NOT EXISTS idx_pregame_intel_pending_stale
ON public.pregame_intel (game_date)
WHERE pick_result = 'PENDING';

-- 5) Index for finding MANUAL_REVIEW picks
CREATE INDEX IF NOT EXISTS idx_pregame_intel_manual_review
ON public.pregame_intel (game_date)
WHERE pick_result = 'MANUAL_REVIEW';

-- 6) Update the pick_result CHECK constraint to allow MANUAL_REVIEW and VOID
-- First drop the old constraint, then add new one
DO $$
BEGIN
    -- Drop old constraint if exists (may have different names)
    ALTER TABLE pregame_intel DROP CONSTRAINT IF EXISTS pregame_intel_pick_result_check;
    ALTER TABLE pregame_intel DROP CONSTRAINT IF EXISTS check_pick_result;
    
    -- Add new constraint with all valid statuses
    ALTER TABLE pregame_intel ADD CONSTRAINT pregame_intel_pick_result_check
    CHECK (pick_result IN ('WIN', 'LOSS', 'PUSH', 'PENDING', 'NO_PICK', 'MANUAL_REVIEW', 'VOID', 'CANCELLED'));
EXCEPTION
    WHEN others THEN
        -- Constraint might not exist or have different name, that's OK
        NULL;
END $$;
