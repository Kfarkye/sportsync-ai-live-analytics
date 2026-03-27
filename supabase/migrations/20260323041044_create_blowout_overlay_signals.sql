
-- Blowout Overlay Model: runs AFTER the main pregame-intel model
-- Isolates games with blowout profile teams (WAS, etc.) and generates
-- secondary picks (game total OVER, etc.) based on ref/coach/team confluence

CREATE TABLE IF NOT EXISTS blowout_overlay_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  league_id TEXT NOT NULL DEFAULT 'nba',
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  game_date DATE NOT NULL,
  
  -- Which team triggered the overlay
  trigger_team TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,  -- e.g. 'blowout_profile_team'
  
  -- Opening line context from main model
  opening_spread NUMERIC,
  opening_total NUMERIC,
  
  -- Confluence signals
  team_over_rate NUMERIC,       -- from team_ou_splits
  team_over_delta NUMERIC,      -- avg delta from team_ou_splits
  lead_ref TEXT,                 -- assigned lead ref
  ref_league_over_pct NUMERIC,  -- ref's league-wide over %
  ref_team_over_pct NUMERIC,    -- ref's over % in trigger_team games
  opp_coach TEXT,               -- opponent coach name
  opp_coach_over_pct NUMERIC,   -- opponent coach overall O/U %
  opp_coach_vs_team_over_pct NUMERIC, -- opponent coach O/U vs this team
  
  -- Confluence tier (1-4)
  confluence_tier INTEGER NOT NULL CHECK (confluence_tier BETWEEN 1 AND 4),
  confluence_label TEXT NOT NULL, -- 'MAX_OVER', 'STANDARD_OVER', 'CONFLICT', 'NO_PLAY'
  
  -- The overlay pick (separate from main model)
  overlay_pick TEXT,             -- e.g. 'GAME_TOTAL_OVER 227.5'
  overlay_pick_type TEXT,        -- 'game_total_over', 'game_total_under', 'skip'
  overlay_confidence NUMERIC,   -- estimated hit rate based on confluence
  overlay_rationale TEXT,        -- human-readable explanation
  
  -- Main model's pick for comparison (read-only, just for auditing)
  main_model_pick TEXT,          -- what pregame-intel-worker recommended
  main_model_confidence TEXT,    -- confidence_tier from pregame_intel
  
  -- Grading (filled after game)
  actual_total INTEGER,
  overlay_result TEXT,           -- 'win', 'loss', 'push', 'skip'
  graded_at TIMESTAMPTZ,
  
  -- Timestamps
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for daily lookups
CREATE INDEX IF NOT EXISTS idx_blowout_overlay_game_date ON blowout_overlay_signals(game_date);
CREATE INDEX IF NOT EXISTS idx_blowout_overlay_match ON blowout_overlay_signals(match_id);
CREATE INDEX IF NOT EXISTS idx_blowout_overlay_tier ON blowout_overlay_signals(confluence_tier);

-- Prevent duplicate entries per match
CREATE UNIQUE INDEX IF NOT EXISTS idx_blowout_overlay_unique_match 
  ON blowout_overlay_signals(match_id, trigger_team);

COMMENT ON TABLE blowout_overlay_signals IS 
  'Secondary model that runs AFTER pregame-intel-worker. Isolates blowout-profile games and generates game total picks based on ref/coach/team confluence. Does NOT modify the main model.';
;
