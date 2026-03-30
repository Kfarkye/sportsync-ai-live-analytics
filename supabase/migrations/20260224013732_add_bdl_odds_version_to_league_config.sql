
-- Add odds version column: US sports use V2 (has spreads/totals), soccer uses V1 (moneyline only)
ALTER TABLE league_config
ADD COLUMN IF NOT EXISTS bdl_odds_version smallint DEFAULT 1
  CONSTRAINT bdl_odds_version_check CHECK (bdl_odds_version IN (1, 2));

COMMENT ON COLUMN league_config.bdl_odds_version IS 'BDL API version for odds: 2 = spreads+totals (US), 1 = moneyline only (soccer)';

-- Set V2 for US sports that have spread/total data
UPDATE league_config SET bdl_odds_version = 2
WHERE id IN ('nba', 'nfl', 'mlb', 'nhl', 'college-football', 'mens-college-basketball');

-- Soccer stays V1 (moneyline only)
UPDATE league_config SET bdl_odds_version = 1
WHERE id IN ('eng.1', 'esp.1', 'ita.1', 'ucl', 'uefa.champions');
;
