
-- Generalized intelligence table for ALL pregame regime factors
-- Same architecture as coaching_intel but covers every layer that affects live play

CREATE TABLE regime_intel (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- WHAT LAYER
  intel_type text NOT NULL, -- 'coaching', 'referee', 'player_matchup', 'pace_profile', 'schedule_spot', 'venue', 'lineup', 'quarter_splits', 'foul_profile', 'broadcast'
  
  -- WHO / WHAT
  entity_name text NOT NULL, -- Coach name, referee name, player name, team name, venue name
  entity_type text NOT NULL, -- 'coach', 'referee', 'player', 'team', 'venue'
  team_name text,
  league_id text NOT NULL,
  season text DEFAULT '2025',
  
  -- THE CLAIM
  claim text NOT NULL,
  claim_conditions jsonb,
  
  -- NARRATIVE vs TRUTH
  narrative_says text, -- What the public believes
  truth_says text, -- What the data shows
  divergence text, -- Where they disagree and what it means
  divergence_direction text, -- 'OVER', 'UNDER', 'COVER', 'MISS', 'PACE_UP', 'PACE_DOWN', 'NEUTRAL'
  
  -- LIVE WATCH TRIGGER
  watch_for text, -- Plain English: "If Gonzaga leads by 10+ at half, tempo dies"
  watch_trigger jsonb, -- {"condition": "home_lead_10+", "half": "2nd", "expected_effect": "pace_collapse"}
  live_market_impact text, -- "Total drops 8-12 pts from open. Props on bench players become live."
  
  -- VALIDATION
  source text NOT NULL,
  validated boolean DEFAULT false,
  alignment_score numeric,
  games_tested integer,
  
  -- META
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  validated_at timestamptz
);

CREATE INDEX idx_regime_intel_type ON regime_intel(intel_type);
CREATE INDEX idx_regime_intel_entity ON regime_intel(entity_name);
CREATE INDEX idx_regime_intel_team ON regime_intel(team_name);
CREATE INDEX idx_regime_intel_league ON regime_intel(league_id);
;
