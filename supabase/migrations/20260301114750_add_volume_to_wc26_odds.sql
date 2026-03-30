
ALTER TABLE wc26_odds ADD COLUMN volume numeric DEFAULT 0;
COMMENT ON COLUMN wc26_odds.volume IS 'Total market volume in USD. Populated for prediction market bookmakers.';
;
