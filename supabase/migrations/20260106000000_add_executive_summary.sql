-- Add executive_summary to pregame_intel for EdgeQuant compatibility
ALTER TABLE public.pregame_intel 
ADD COLUMN IF NOT EXISTS executive_summary JSONB DEFAULT '{}';
