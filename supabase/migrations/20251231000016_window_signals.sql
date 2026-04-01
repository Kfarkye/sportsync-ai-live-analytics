-- =================================================================
-- NBA Live Totals - 3-Window Signal Architecture
-- Window 1: Q1_END (~12 min) - Early variance not yet priced in
-- Window 2: HALFTIME (~24 min) - Classic decision point
-- Window 3: Q3_END (~36-40 min) - Most reliable, still actionable
-- =================================================================

-- 1. Create the window signals table
CREATE TABLE IF NOT EXISTS nba_window_signals (
    signal_id BIGSERIAL PRIMARY KEY,
    game_id TEXT NOT NULL,
    window_number INT NOT NULL CHECK (window_number IN (1, 2, 3)),
    window_name TEXT NOT NULL, -- 'HALFTIME', 'Q3_END', 'FINAL_PUSH'
    
    -- Game state at signal time
    elapsed_min NUMERIC NOT NULL,
    remaining_min NUMERIC NOT NULL,
    current_score_home INT NOT NULL,
    current_score_away INT NOT NULL,
    current_total INT GENERATED ALWAYS AS (current_score_home + current_score_away) STORED,
    
    -- Model output at signal time
    model_fair NUMERIC NOT NULL,
    live_market_total NUMERIC NOT NULL,
    edge_z NUMERIC NOT NULL,
    
    -- Signal decision
    signal_side TEXT NOT NULL CHECK (signal_side IN ('OVER', 'UNDER', 'NO_PLAY')),
    confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
    
    -- Grading (filled in after game ends)
    final_total INT,  -- Actual final score
    result TEXT CHECK (result IN ('WIN', 'LOSS', 'PUSH', 'PENDING')),
    graded_at TIMESTAMPTZ,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One signal per window per game
    UNIQUE (game_id, window_number)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_window_signals_game ON nba_window_signals(game_id);
CREATE INDEX IF NOT EXISTS idx_window_signals_pending ON nba_window_signals(result) WHERE result = 'PENDING';

-- RLS
ALTER TABLE nba_window_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read nba_window_signals" ON nba_window_signals;
DROP POLICY IF EXISTS "Service role full access" ON nba_window_signals;
CREATE POLICY "Allow read nba_window_signals" ON nba_window_signals FOR SELECT USING (true);
CREATE POLICY "Service role full access" ON nba_window_signals FOR ALL USING (true);

-- 2. View for signal record tracking
CREATE OR REPLACE VIEW nba_signal_record AS
SELECT 
    signal_side,
    window_name,
    COUNT(*) FILTER (WHERE result = 'WIN') as wins,
    COUNT(*) FILTER (WHERE result = 'LOSS') as losses,
    COUNT(*) FILTER (WHERE result = 'PUSH') as pushes,
    COUNT(*) FILTER (WHERE result = 'PENDING') as pending,
    ROUND(
        COUNT(*) FILTER (WHERE result = 'WIN')::NUMERIC / 
        NULLIF(COUNT(*) FILTER (WHERE result IN ('WIN', 'LOSS')), 0) * 100, 1
    ) as win_pct
FROM nba_window_signals
WHERE signal_side != 'NO_PLAY'
GROUP BY signal_side, window_name
ORDER BY window_name, signal_side;

-- 3. Function to grade signals after game ends
CREATE OR REPLACE FUNCTION grade_nba_signals()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    sig RECORD;
    final_score INT;
BEGIN
    FOR sig IN 
        SELECT s.signal_id, s.game_id, s.signal_side, s.live_market_total
        FROM nba_window_signals s
        JOIN nba_games g ON s.game_id = g.game_id
        WHERE s.result = 'PENDING' 
        AND g.status = 'STATUS_FINAL'
    LOOP
        -- Get final score from latest tick
        SELECT pts_home + pts_away INTO final_score
        FROM nba_ticks 
        WHERE game_id = sig.game_id 
        ORDER BY elapsed_min DESC 
        LIMIT 1;
        
        IF final_score IS NOT NULL THEN
            UPDATE nba_window_signals
            SET 
                final_total = final_score,
                result = CASE
                    WHEN sig.signal_side = 'OVER' AND final_score > sig.live_market_total THEN 'WIN'
                    WHEN sig.signal_side = 'OVER' AND final_score < sig.live_market_total THEN 'LOSS'
                    WHEN sig.signal_side = 'UNDER' AND final_score < sig.live_market_total THEN 'WIN'
                    WHEN sig.signal_side = 'UNDER' AND final_score > sig.live_market_total THEN 'LOSS'
                    WHEN final_score = sig.live_market_total THEN 'PUSH'
                    ELSE 'PENDING'
                END,
                graded_at = NOW()
            WHERE signal_id = sig.signal_id;
        END IF;
    END LOOP;
END;
$$;

-- Verification
SELECT 'nba_window_signals table created' as status;
