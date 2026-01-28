-- published_picks: The "publish layer" that sits on top of raw pregame_intel
-- UI reads from this table (or a view on top of it), not pregame_intel directly

CREATE TABLE IF NOT EXISTS published_picks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Game identification
    game_id TEXT NOT NULL,
    game_date DATE NOT NULL,
    
    -- Teams
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    
    -- Sport & Market
    sport TEXT NOT NULL,
    league TEXT,
    market_type TEXT NOT NULL, -- 'spread', 'moneyline', 'total'
    
    -- The final published pick
    final_pick_text TEXT NOT NULL,
    final_side TEXT, -- 'home', 'away', 'over', 'under'
    final_line DECIMAL(5,1), -- The spread/total line
    final_odds INTEGER, -- American odds (-110, +150, etc.)
    
    -- The write-up
    writeup TEXT,
    
    -- Source tracking (the magic stays internal)
    source TEXT NOT NULL DEFAULT 'base', -- 'base' or 'fade'
    derived_from_intel_id UUID REFERENCES pregame_intel(intel_id),
    was_inverted BOOLEAN DEFAULT FALSE,
    policy_version TEXT DEFAULT 'v1',
    
    -- Grading
    pick_result TEXT DEFAULT 'PENDING',
    graded_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    published_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(game_id, market_type) -- One pick per game per market type
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_published_picks_game_date ON published_picks(game_date);
CREATE INDEX IF NOT EXISTS idx_published_picks_sport ON published_picks(sport);
CREATE INDEX IF NOT EXISTS idx_published_picks_source ON published_picks(source);
CREATE INDEX IF NOT EXISTS idx_published_picks_result ON published_picks(pick_result);
CREATE INDEX IF NOT EXISTS idx_published_picks_derived ON published_picks(derived_from_intel_id);

-- View for today's picks (what the UI reads)
CREATE OR REPLACE VIEW v_picks_today AS
SELECT 
    id,
    game_id,
    game_date,
    home_team,
    away_team,
    sport,
    league,
    market_type,
    final_pick_text AS recommended_pick,
    final_side,
    final_line,
    final_odds,
    writeup,
    pick_result,
    created_at
FROM published_picks
WHERE game_date = CURRENT_DATE
  AND pick_result = 'PENDING'
ORDER BY sport, game_date;

-- View for performance tracking (shows source internally)
CREATE OR REPLACE VIEW v_published_performance AS
SELECT 
    source,
    sport,
    pick_result,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE pick_result = 'WIN') / 
          NULLIF(COUNT(*) FILTER (WHERE pick_result IN ('WIN', 'LOSS')), 0), 1) as win_pct
FROM published_picks
WHERE pick_result IN ('WIN', 'LOSS', 'PUSH')
GROUP BY source, sport, pick_result
ORDER BY source, sport;

COMMENT ON TABLE published_picks IS 'The publish layer - contains final picks after decision policy is applied. UI reads from here.';
COMMENT ON COLUMN published_picks.source IS 'base = direct from model, fade = inverted based on fade rules';
COMMENT ON COLUMN published_picks.was_inverted IS 'True if the pick was flipped from the original model output';
COMMENT ON COLUMN published_picks.derived_from_intel_id IS 'Reference to original pregame_intel record if applicable';
