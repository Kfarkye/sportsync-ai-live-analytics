
-- ADD ODDS TO LIVE GAME STATE HUB
-- v5.2 | January 3, 2026

ALTER TABLE public.live_game_state 
ADD COLUMN IF NOT EXISTS odds JSONB;
