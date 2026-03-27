
-- Migration: Add primary key to match_halftime_odds
-- This table was flagged as having no PK. The natural composite key is
-- (match_id, market, bookmaker, outcome, snapshot_timestamp).
-- Verified zero duplicates exist on this combo.

ALTER TABLE public.match_halftime_odds
  ADD CONSTRAINT match_halftime_odds_pkey
  PRIMARY KEY (match_id, market, bookmaker, outcome, snapshot_timestamp);
;
