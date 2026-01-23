-- Add recent_plays column for NBA play-by-play context
-- v5.2 | January 15, 2026

ALTER TABLE public.live_game_state ADD COLUMN IF NOT EXISTS recent_plays JSONB;

COMMENT ON COLUMN public.live_game_state.recent_plays IS 'Last 5 plays from ESPN for AI context (NBA-focused)';
