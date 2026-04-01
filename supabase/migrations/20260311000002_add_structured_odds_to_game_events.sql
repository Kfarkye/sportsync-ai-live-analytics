-- Migration: add_structured_odds_to_game_events

ALTER TABLE game_events ADD COLUMN IF NOT EXISTS odds_open jsonb;
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS odds_close jsonb;
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS odds_live jsonb;
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS bet365_live jsonb;
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS dk_live_200 jsonb;
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS player_props jsonb;
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS match_state jsonb;

CREATE INDEX IF NOT EXISTS idx_ge_odds_lookup
  ON game_events (match_id, created_at DESC)
  WHERE event_type = 'odds_snapshot';
