-- Temporal State Persistence for Live Sentinel
-- Adds columns to track game state at critical moments (T-60, T-0)

-- 1. Add temporal snapshot columns
ALTER TABLE public.live_game_state 
ADD COLUMN IF NOT EXISTS t60_snapshot JSONB,
ADD COLUMN IF NOT EXISTS t0_snapshot JSONB,
ADD COLUMN IF NOT EXISTS t60_captured_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS t0_captured_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS home_team TEXT,
ADD COLUMN IF NOT EXISTS away_team TEXT,
ADD COLUMN IF NOT EXISTS display_clock TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.live_game_state.t60_snapshot IS 'Game state snapshot 60 minutes before tipoff (injuries, odds, lineups)';
COMMENT ON COLUMN public.live_game_state.t0_snapshot IS 'Game state snapshot at tipoff (final lines, CLV baseline)';
COMMENT ON COLUMN public.live_game_state.start_time IS 'Scheduled start time of the game';

-- 2. Create index for temporal queries
CREATE INDEX IF NOT EXISTS idx_live_game_state_start_time 
ON public.live_game_state(start_time);
