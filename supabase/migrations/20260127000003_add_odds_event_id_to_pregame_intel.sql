-- Migration: Add odds_event_id to pregame_intel (DETERMINISTIC GRADING)
-- This is the correct architecture: exact ID matching, no fuzzy logic

-- 1) Add column
ALTER TABLE public.pregame_intel
ADD COLUMN IF NOT EXISTS odds_event_id TEXT;

-- 2) Index for fast grading joins
CREATE INDEX IF NOT EXISTS pregame_intel_odds_event_id_idx
ON public.pregame_intel (odds_event_id);

-- 3) Backfill from matches table (where odds_api_event_id is stored)
UPDATE public.pregame_intel pi
SET odds_event_id = m.odds_api_event_id
FROM public.matches m
WHERE pi.odds_event_id IS NULL
  AND pi.match_id = m.id
  AND m.odds_api_event_id IS NOT NULL;

-- 4) Add comment documenting the purpose
COMMENT ON COLUMN public.pregame_intel.odds_event_id IS 
  'Odds API event ID for deterministic grading. Must be populated at pick creation. Grading joins exclusively on this ID - no fuzzy team name matching.';
