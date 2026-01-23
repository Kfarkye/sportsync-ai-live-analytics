-- Add pick timing and odds snapshot fields to ai_chat_picks and sharp_intel
-- For CLV analysis and live vs pregame performance tracking

-- ai_chat_picks table
ALTER TABLE ai_chat_picks
ADD COLUMN IF NOT EXISTS pick_game_clock TEXT,      -- e.g., "Q2 5:32", "H1 22:00", "Pregame"
ADD COLUMN IF NOT EXISTS pick_period INTEGER,       -- 0=pregame, 1=Q1/H1, 2=Q2/H2, etc.
ADD COLUMN IF NOT EXISTS pick_odds_snapshot JSONB,  -- Full odds at pick time
ADD COLUMN IF NOT EXISTS pick_spread_at_time NUMERIC,
ADD COLUMN IF NOT EXISTS pick_total_at_time NUMERIC,
ADD COLUMN IF NOT EXISTS pick_ml_home_at_time INTEGER,
ADD COLUMN IF NOT EXISTS pick_ml_away_at_time INTEGER;

-- sharp_intel table
ALTER TABLE sharp_intel
ADD COLUMN IF NOT EXISTS pick_game_clock TEXT,
ADD COLUMN IF NOT EXISTS pick_period INTEGER,
ADD COLUMN IF NOT EXISTS pick_odds_snapshot JSONB,
ADD COLUMN IF NOT EXISTS pick_spread_at_time NUMERIC,
ADD COLUMN IF NOT EXISTS pick_total_at_time NUMERIC,
ADD COLUMN IF NOT EXISTS pick_ml_home_at_time INTEGER,
ADD COLUMN IF NOT EXISTS pick_ml_away_at_time INTEGER;

-- Index for analyzing pregame vs live picks
CREATE INDEX IF NOT EXISTS idx_chat_picks_period ON ai_chat_picks(pick_period);
CREATE INDEX IF NOT EXISTS idx_sharp_intel_period ON sharp_intel(pick_period);
