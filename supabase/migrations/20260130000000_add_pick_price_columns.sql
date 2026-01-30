-- ============================================================
-- Add pick-time price/odds columns to pregame_intel
-- These fields enable ROI, EV, and CLV calculations
-- ============================================================

ALTER TABLE pregame_intel
  ADD COLUMN IF NOT EXISTS pick_market_key text,
  ADD COLUMN IF NOT EXISTS pick_book_key text,
  ADD COLUMN IF NOT EXISTS pick_point numeric,
  ADD COLUMN IF NOT EXISTS pick_price_american integer,
  ADD COLUMN IF NOT EXISTS pick_price_decimal numeric,
  ADD COLUMN IF NOT EXISTS pick_price_ts timestamptz;

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS pregame_intel_pick_price_ts_idx
  ON pregame_intel (pick_price_ts);

-- Index for book/market analysis
CREATE INDEX IF NOT EXISTS pregame_intel_pick_book_market_idx
  ON pregame_intel (pick_book_key, pick_market_key);

COMMENT ON COLUMN pregame_intel.pick_market_key IS 'Market identifier (e.g., spreads, totals, h2h)';
COMMENT ON COLUMN pregame_intel.pick_book_key IS 'Sportsbook identifier (e.g., draftkings, fanduel)';
COMMENT ON COLUMN pregame_intel.pick_point IS 'Line/spread value at pick time (e.g., -3.5)';
COMMENT ON COLUMN pregame_intel.pick_price_american IS 'American odds at pick time (e.g., -110)';
COMMENT ON COLUMN pregame_intel.pick_price_decimal IS 'Decimal odds at pick time (e.g., 1.91)';
COMMENT ON COLUMN pregame_intel.pick_price_ts IS 'Timestamp when price was captured';
