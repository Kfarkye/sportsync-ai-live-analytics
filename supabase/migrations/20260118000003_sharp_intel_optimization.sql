-- Sharp Intel Optimization & Hardening
-- Objectives: Data integrity, sport-specific performance, and CLV analytics

-- 1. Tighten Data Integrity with Constraints
DO $$ 
BEGIN
    ALTER TABLE sharp_intel ADD CONSTRAINT check_pick_result 
    CHECK (pick_result IN ('WIN', 'LOSS', 'PUSH', 'PENDING'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ 
BEGIN
    ALTER TABLE sharp_intel ADD CONSTRAINT check_pick_type 
    CHECK (pick_type IN ('spread', 'total', 'moneyline'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. Advanced Indexing for UI & Analytics
CREATE INDEX IF NOT EXISTS idx_sharp_intel_league ON sharp_intel(league);
CREATE INDEX IF NOT EXISTS idx_sharp_intel_graded_at ON sharp_intel(graded_at);
CREATE INDEX IF NOT EXISTS idx_sharp_intel_match_side ON sharp_intel(match_id, pick_side); -- Helps identify duplicate picks

-- 3. Enhanced Performance View (ROI & CLV Tracking)
CREATE OR REPLACE VIEW sharp_intel_record AS
WITH stats AS (
    SELECT 
        COUNT(*) FILTER (WHERE pick_result = 'WIN') as wins,
        COUNT(*) FILTER (WHERE pick_result = 'LOSS') as losses,
        COUNT(*) FILTER (WHERE pick_result = 'PUSH') as pushes,
        COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')) as graded_count,
        SUM(clv) as total_clv,
        AVG(clv) as avg_clv
    FROM sharp_intel
)
SELECT 
    wins,
    losses,
    pushes,
    graded_count,
    ROUND(100.0 * wins / NULLIF(graded_count, 0), 1) as win_pct,
    -- Simple ROI calculation assuming flat -110 betting
    -- (wins * 100) - (losses * 110) / (graded_count * 110)
    ROUND(
        ( (wins * 100.0) - (losses * 110.0) ) / 
        NULLIF((graded_count * 110.0), 0) * 100.0, 
    2) as est_roi_pct,
    ROUND(avg_clv, 2) as avg_clv_beat
FROM stats;
