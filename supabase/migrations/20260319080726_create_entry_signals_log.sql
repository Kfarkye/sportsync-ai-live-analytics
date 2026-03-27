
CREATE TABLE IF NOT EXISTS entry_signals_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id text NOT NULL,
  game_date date NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  -- DK numbers at time of signal
  dk_total numeric,
  dk_spread numeric,
  -- ESPN model numbers
  espn_implied_spread numeric,
  espn_spread_gap numeric,
  -- Physics
  matchup_avg numeric,
  dk_shade numeric,
  home_vs_open numeric,
  away_vs_open numeric,
  combined_vs_open numeric,
  -- Signal
  entry_signal text NOT NULL,
  entry_direction text, -- 'UNDER', 'OVER', or null
  confidence text, -- 'STRONG', 'LEAN', 'PHYSICS_ONLY', 'NONE'
  -- Reasoning
  reasoning text,
  -- Results (filled after game)
  final_total numeric,
  vs_dk_total numeric,
  signal_correct boolean,
  -- Timestamps
  recorded_at timestamptz DEFAULT now(),
  scored_at timestamptz
);

CREATE INDEX idx_entry_signals_match ON entry_signals_log(match_id);
CREATE INDEX idx_entry_signals_date ON entry_signals_log(game_date);
;
