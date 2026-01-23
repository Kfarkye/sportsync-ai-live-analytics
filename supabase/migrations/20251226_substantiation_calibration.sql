-- 20251226_substantiation_calibration.sql
-- Purpose: Records model projections for historical substantiation and FTC compliance.

CREATE TABLE IF NOT EXISTS public.model_calibration_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    model_version TEXT DEFAULT 'gemini-3-flash-preview',
    confidence_level FLOAT NOT NULL, -- The 0.0 - 1.0 confidence score
    edge_orientation TEXT NOT NULL, -- OVER / UNDER / NEUTRAL
    edge_points FLOAT,              -- The detected delta (e.g. 5.5)
    market_total FLOAT,             -- The market line at time of projection
    signals_snapshot JSONB,         -- Full tactical signals JSON
    created_at TIMESTAMPTZ DEFAULT now(),
    actual_total FLOAT,             -- Updated later once game is final
    status TEXT DEFAULT 'PENDING'   -- PENDING / COMPLETED
);

-- Enable RLS
ALTER TABLE public.model_calibration_logs ENABLE ROW LEVEL SECURITY;

-- Allow public read of calibration stats (for transparency/legal review)
CREATE POLICY "Allow public read of calibration logs"
ON public.model_calibration_logs FOR SELECT
USING (true);

-- Allow service role to insert/update
CREATE POLICY "Allow service_role full access"
ON public.model_calibration_logs FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_calibration_match_id ON public.model_calibration_logs(match_id);
CREATE INDEX IF NOT EXISTS idx_calibration_sport ON public.model_calibration_logs(sport);
