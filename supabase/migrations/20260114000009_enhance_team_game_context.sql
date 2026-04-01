-- Migration: Add opponent and fatigue flag columns to team_game_context
-- Purpose: Capture full fidelity from User's JSON schedule data

ALTER TABLE team_game_context
ADD COLUMN IF NOT EXISTS opponent TEXT,
ADD COLUMN IF NOT EXISTS is_home BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS is_b2b BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_second_of_b2b BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_3in4 BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_4in5 BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS game_number INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN team_game_context.opponent IS 'Opponent team name from user JSON';
COMMENT ON COLUMN team_game_context.is_home IS 'TRUE if team is playing at home';
COMMENT ON COLUMN team_game_context.is_second_of_b2b IS 'TRUE if this is the second game of a back-to-back';
COMMENT ON COLUMN team_game_context.game_number IS 'Season game number (e.g., 41 of 82)';
