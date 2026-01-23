-- NBA Live Totals Control Engine v3.0 - Core Schema
-- Deterministic, replayable, calibratable

-- 1. Games metadata (pregame anchor + priors)
CREATE TABLE IF NOT EXISTS nba_games (
  game_id TEXT PRIMARY KEY,
  season TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  start_ts TIMESTAMPTZ,
  close_total NUMERIC,
  pace_pre48 NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tick ledger (canonical raw data per update)
CREATE TABLE IF NOT EXISTS nba_ticks (
  tick_id BIGSERIAL PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES nba_games(game_id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  elapsed_min NUMERIC NOT NULL,
  rem_min NUMERIC NOT NULL,
  pts_home INT NOT NULL,
  pts_away INT NOT NULL,

  -- Home box stats
  home_fga INT NOT NULL,
  home_fgm INT NOT NULL,
  home_3pa INT NOT NULL,
  home_3pm INT NOT NULL,
  home_fta INT NOT NULL,
  home_ftm INT NOT NULL,
  home_tov INT NOT NULL,
  home_orb INT NOT NULL,

  -- Away box stats
  away_fga INT NOT NULL,
  away_fgm INT NOT NULL,
  away_3pa INT NOT NULL,
  away_3pm INT NOT NULL,
  away_fta INT NOT NULL,
  away_ftm INT NOT NULL,
  away_tov INT NOT NULL,
  away_orb INT NOT NULL,

  -- Situational (optional but high ROI)
  timeouts_home INT,
  timeouts_away INT,
  team_fouls_q_home INT,
  team_fouls_q_away INT,
  in_bonus_home BOOLEAN,
  in_bonus_away BOOLEAN,

  -- Lineups (for EPM lookup)
  home_on_court JSONB,
  away_on_court JSONB,

  -- Idempotency: unique key per feed tick
  UNIQUE (game_id, ts, pts_home, pts_away, elapsed_min)
);

CREATE INDEX IF NOT EXISTS nba_ticks_game_ts ON nba_ticks(game_id, ts);

-- 3. Snapshot ledger (v3.0 model outputs per tick)
CREATE TABLE IF NOT EXISTS nba_snapshots (
  snapshot_id BIGSERIAL PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES nba_games(game_id) ON DELETE CASCADE,
  tick_id BIGINT NOT NULL REFERENCES nba_ticks(tick_id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,

  -- Anchor + Possessions
  anchor_ppp NUMERIC NOT NULL,
  poss_live NUMERIC NOT NULL,
  live_pace_48 NUMERIC NOT NULL,
  pace_blend_48 NUMERIC NOT NULL,
  rem_poss NUMERIC NOT NULL,

  -- Luck + Structural
  luck_gap NUMERIC NOT NULL,
  struct_ppp NUMERIC NOT NULL,
  proj_ppp NUMERIC NOT NULL,

  -- Lineup + Raw
  lineup_adj_ppp NUMERIC NOT NULL,
  raw_proj NUMERIC NOT NULL,

  -- Endgame EV
  foul_ev NUMERIC NOT NULL,
  ot_ev NUMERIC NOT NULL DEFAULT 0,
  model_fair NUMERIC NOT NULL,

  -- Market + Edge
  live_mkt NUMERIC NOT NULL,
  edge_z NUMERIC NOT NULL,
  vol_std NUMERIC NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (game_id, tick_id)
);

CREATE INDEX IF NOT EXISTS nba_snapshots_game_ts ON nba_snapshots(game_id, ts);

-- 4. Decision ledger (when/why we fired)
CREATE TABLE IF NOT EXISTS nba_decisions (
  decision_id BIGSERIAL PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES nba_games(game_id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('OVER', 'UNDER')),
  edge_z NUMERIC NOT NULL,
  model_fair NUMERIC NOT NULL,
  live_mkt NUMERIC NOT NULL,
  reason_codes JSONB NOT NULL DEFAULT '[]'::JSONB,
  snapshot_id BIGINT REFERENCES nba_snapshots(snapshot_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nba_decisions_game_ts ON nba_decisions(game_id, ts);

-- 5. Team priors (pregame expectations, updated daily)
CREATE TABLE IF NOT EXISTS nba_team_priors (
  season TEXT NOT NULL,
  team TEXT NOT NULL,
  pace_pre48 NUMERIC NOT NULL,
  exp_3pa_rate NUMERIC NOT NULL,
  exp_3p_pct NUMERIC NOT NULL,
  exp_2p_pct NUMERIC NOT NULL,
  exp_ftr NUMERIC,
  exp_tov_pct NUMERIC,
  exp_orb_pct NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (season, team)
);

-- 6. Player EPM (per 100 possessions)
CREATE TABLE IF NOT EXISTS nba_player_epm (
  season TEXT NOT NULL,
  player_id TEXT NOT NULL,
  team TEXT,
  epm NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (season, player_id)
);

-- 7. Calibration runs (weekly residual analysis + adjustments)
CREATE TABLE IF NOT EXISTS nba_calibration_runs (
  run_id BIGSERIAL PRIMARY KEY,
  season TEXT NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  metrics JSONB NOT NULL,
  adjustments JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (season, week_start, week_end)
);

-- RLS Policies (optional, for edge function access)
ALTER TABLE nba_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE nba_ticks ENABLE ROW LEVEL SECURITY;
ALTER TABLE nba_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE nba_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nba_team_priors ENABLE ROW LEVEL SECURITY;
ALTER TABLE nba_player_epm ENABLE ROW LEVEL SECURITY;
ALTER TABLE nba_calibration_runs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON nba_games FOR ALL USING (true);
CREATE POLICY "Service role full access" ON nba_ticks FOR ALL USING (true);
CREATE POLICY "Service role full access" ON nba_snapshots FOR ALL USING (true);
CREATE POLICY "Service role full access" ON nba_decisions FOR ALL USING (true);
CREATE POLICY "Service role full access" ON nba_team_priors FOR ALL USING (true);
CREATE POLICY "Service role full access" ON nba_player_epm FOR ALL USING (true);
CREATE POLICY "Service role full access" ON nba_calibration_runs FOR ALL USING (true);
