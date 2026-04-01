
-- Create sharp_movements table to track "Whale" performance
CREATE TABLE IF NOT EXISTS public.sharp_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL REFERENCES public.matches(id),
    market_type TEXT NOT NULL, -- 'TOTAL', 'SPREAD', 'ML'
    
    -- Analysis Data
    open_line NUMERIC,
    closing_line NUMERIC,
    delta NUMERIC, -- Positive = Line moved UP, Negative = Line moved DOWN
    
    -- Pick Logic
    pick_side TEXT, -- 'OVER', 'UNDER', 'HOME', 'AWAY'
    pick_line NUMERIC, -- The line we are grading against (usually Opening Line)
    
    -- Result
    home_score INT,
    away_score INT,
    final_total INT,
    final_margin INT,
    
    grade TEXT, -- 'WIN', 'LOSS', 'PUSH'
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_sharp_movements_match_id ON public.sharp_movements(match_id);
CREATE INDEX IF NOT EXISTS idx_sharp_movements_grade ON public.sharp_movements(grade);

-- Add unique constraint to prevent duplicate grading for same match/type
CREATE UNIQUE INDEX IF NOT EXISTS idx_sharp_movements_unique_grade 
ON public.sharp_movements(match_id, market_type);

-- RLS Policies
ALTER TABLE public.sharp_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public.sharp_movements
    FOR SELECT USING (true);

CREATE POLICY "Enable write access for service role" ON public.sharp_movements
    FOR ALL USING (auth.role() = 'service_role');
