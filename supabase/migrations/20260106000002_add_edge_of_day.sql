-- Migration: Add is_edge_of_day to pregame_intel
-- Description: Enables highlighting the highest EV pick of the day.

ALTER TABLE pregame_intel ADD COLUMN IF NOT EXISTS is_edge_of_day BOOLEAN DEFAULT false;

-- Index for efficient lookup of the daily edge
CREATE INDEX IF NOT EXISTS idx_pregame_intel_edge_day ON pregame_intel (game_date, is_edge_of_day) WHERE is_edge_of_day = true;
