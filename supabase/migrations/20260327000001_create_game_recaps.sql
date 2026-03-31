-- Fix: Create game_recaps table that triggers reference
-- This table was referenced by a trigger on matches but was never created,
-- causing all UPDATE operations on matches to fail with:
-- "relation game_recaps does not exist"

CREATE TABLE IF NOT EXISTS public.game_recaps (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id text,
  recap_text text,
  home_team text,
  away_team text,
  home_score integer,
  away_score integer,
  league_id text,
  recap_source text DEFAULT 'system',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for match lookups
CREATE INDEX IF NOT EXISTS idx_game_recaps_match_id ON public.game_recaps(match_id);

-- Grant access
ALTER TABLE public.game_recaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Allow service role full access on game_recaps"
  ON public.game_recaps
  FOR ALL
  USING (true)
  WITH CHECK (true);
