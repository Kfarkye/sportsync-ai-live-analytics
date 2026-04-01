-- Add is_live column to market_feeds if it doesn't exist
ALTER TABLE market_feeds 
ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT FALSE;

-- Add index for faster live event queries
CREATE INDEX IF NOT EXISTS idx_market_feeds_is_live 
ON market_feeds(is_live) 
WHERE is_live = TRUE;

-- Comment for clarity
COMMENT ON COLUMN market_feeds.is_live IS 'True if the event is currently in-progress (live odds)';
