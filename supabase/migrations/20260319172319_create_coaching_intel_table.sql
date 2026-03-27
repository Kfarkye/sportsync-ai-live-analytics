
-- Gemini's qualitative intelligence, structured for validation against data
CREATE TABLE coaching_intel (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- WHO
  coach_name text NOT NULL,
  team_name text NOT NULL,
  league_id text NOT NULL,
  season text DEFAULT '2025',
  
  -- WHAT (the claim)
  claim_type text NOT NULL, -- 'tempo', 'late_game', 'defensive', 'offensive', 'matchup', 'injury_response', 'lineup', 'pace'
  claim text NOT NULL, -- Plain English: "Slows tempo to crawl when leading by 10+"
  claim_conditions jsonb, -- {"game_state": "leading", "margin": "10+", "half": "2nd", "trigger": "any_lead"}
  
  -- WHERE IT CAME FROM
  source text NOT NULL, -- 'gemini_training', 'gemini_grounded_search', 'manual', 'press_conference', 'film_study'
  source_url text, -- URL if from grounded search
  source_date date, -- When the source was published
  
  -- DATA VALIDATION
  validated boolean DEFAULT false,
  validation_query text, -- The SQL that tests this claim
  validation_result jsonb, -- {"games_tested": 10, "claim_supported": 8, "claim_contradicted": 2}
  alignment_score numeric, -- 0-100, how well the data supports the claim
  data_correction text, -- If misaligned: "Track meet activates but total still goes under 70% of the time"
  
  -- PRODUCT USE
  active boolean DEFAULT true, -- Should the AI panel use this?
  consumer_version text, -- Plain English for the card: "Gonzaga slows the pace when ahead"
  regime_impact text, -- How this affects the regime: "UNDER pressure when leading"
  
  -- META
  created_at timestamptz DEFAULT now(),
  validated_at timestamptz,
  expires_at timestamptz -- Some claims are season-specific
);

CREATE INDEX idx_coaching_intel_coach ON coaching_intel(coach_name);
CREATE INDEX idx_coaching_intel_team ON coaching_intel(team_name);
CREATE INDEX idx_coaching_intel_type ON coaching_intel(claim_type);
CREATE INDEX idx_coaching_intel_active ON coaching_intel(active) WHERE active = true;
;
