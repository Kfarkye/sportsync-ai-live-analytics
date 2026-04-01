-- Pick Grading & Volatility System: Schema Extension
-- This migration adds columns and views for tracking pick outcomes.

-- 1. Add Grading Columns
ALTER TABLE public.pregame_intel
ADD COLUMN IF NOT EXISTS grading_metadata JSONB,
ADD COLUMN IF NOT EXISTS pick_result TEXT DEFAULT 'PENDING' 
    CHECK (pick_result IN ('WIN', 'LOSS', 'PUSH', 'PENDING', 'NO_PICK')),
ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS actual_home_score INT,
ADD COLUMN IF NOT EXISTS actual_away_score INT;

-- 2. Index for Grading Cron (find pending picks efficiently)
CREATE INDEX IF NOT EXISTS idx_pregame_intel_pending 
    ON pregame_intel(pick_result) WHERE pick_result = 'PENDING';

-- 3. Record View (Aggregate Win/Loss)
CREATE OR REPLACE VIEW public.pregame_intel_record AS
SELECT
    COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
    COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes,
    COUNT(*) FILTER (WHERE pick_result = 'PENDING') as pending,
    ROUND(
        COUNT(*) FILTER (WHERE pick_result = 'WIN')::NUMERIC /
        NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0) * 100, 1
    ) as win_pct
FROM pregame_intel
WHERE recommended_pick IS NOT NULL;

-- 4. Grant read access for UI rendering
GRANT SELECT ON public.pregame_intel_record TO authenticated;
GRANT SELECT ON public.pregame_intel_record TO anon;

-- Verification
SELECT 'pick_grading_columns_added' as result;
