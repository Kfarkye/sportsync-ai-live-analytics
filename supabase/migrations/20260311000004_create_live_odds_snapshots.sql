-- Migration: create_live_odds_snapshots

CREATE TABLE IF NOT EXISTS live_odds_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id text NOT NULL,
  sport text NOT NULL,
  league_id text NOT NULL,
  provider text NOT NULL,
  provider_id text,
  market_type text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),

  status text,
  period integer,
  clock text,
  home_score integer,
  away_score integer,
  home_team text,
  away_team text,

  home_ml integer,
  away_ml integer,
  draw_ml integer,

  spread_home numeric,
  spread_away numeric,
  spread_home_price integer,
  spread_away_price integer,

  total numeric,
  over_price integer,
  under_price integer,

  is_live boolean DEFAULT true,
  source text,
  raw_payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_los_match_time
  ON live_odds_snapshots (match_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_los_league_time
  ON live_odds_snapshots (league_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_los_provider_market
  ON live_odds_snapshots (provider, market_type, captured_at DESC);
