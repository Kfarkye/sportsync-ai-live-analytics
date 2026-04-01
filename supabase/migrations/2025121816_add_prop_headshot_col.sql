
-- Add headshot_url to player_prop_bets for a better architecture
-- This allows us to resolve photos at ingestion time rather than guessing in the browser.
ALTER TABLE player_prop_bets ADD COLUMN IF NOT EXISTS headshot_url TEXT;

-- Index it for performance although it's mostly for display
CREATE INDEX IF NOT EXISTS idx_prop_bets_player_name ON player_prop_bets(player_name);
