
-- ============================================================================
-- INTEL EXPERT LAYER - STRUCTURAL UPGRADE
-- Adds injury tracking, causal linking, market context, and temporal logic.
-- ============================================================================

-- 0. HELPER FUNCTIONS (Must be defined before use)
CREATE OR REPLACE FUNCTION add_temporal_columns(target_table TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name=target_table AND column_name='valid_from') THEN
        EXECUTE 'ALTER TABLE ' || target_table || ' ADD COLUMN valid_from TIMESTAMPTZ DEFAULT NOW()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name=target_table AND column_name='valid_to') THEN
        EXECUTE 'ALTER TABLE ' || target_table || ' ADD COLUMN valid_to TIMESTAMPTZ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name=target_table AND column_name='confidence_score') THEN
        EXECUTE 'ALTER TABLE ' || target_table || ' ADD COLUMN confidence_score DECIMAL(3,2) DEFAULT 1.0';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 1. INJURY + AVAILABILITY TRACKER
CREATE TABLE IF NOT EXISTS injuries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_name TEXT NOT NULL,
    team_id TEXT,
    sport TEXT NOT NULL,
    status TEXT NOT NULL,              -- E.g., 'OUT', 'QUESTIONABLE', 'ACTIVE'
    injury_type TEXT,
    minutes_restriction BOOLEAN DEFAULT FALSE,
    expected_return_date DATE,
    impact_rating INT DEFAULT 5,       -- 1–10 intensity
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_to TIMESTAMPTZ,
    confidence_score DECIMAL(3,2) DEFAULT 1.0,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PROP ↔ INSIGHT LINKAGE
-- Converts narrative insights into weighted signals for specific bets.
CREATE TABLE IF NOT EXISTS prop_insight_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    bet_type TEXT NOT NULL,
    insight_type TEXT NOT NULL,
    weight DECIMAL(3,2) DEFAULT 1.0,   -- 0.0 to 1.0 correlation weight
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(match_id, player_name, bet_type, insight_type)
);

-- 3. IMPORTANCE NORMALIZATION
-- Prevents "NFL Playoffs" from being weighted the same as "NBA Regular Season".
CREATE TABLE IF NOT EXISTS importance_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sport TEXT NOT NULL,
    insight_type TEXT NOT NULL,        -- E.g., 'ELIMINATION_GAME', 'ROOKIE_USAGE'
    base_weight DECIMAL(3,2) DEFAULT 1.0,
    UNIQUE(sport, insight_type)
);

-- 4. HARDENING EXISTING SCHEMA (MARKET & TEMPORAL FIELDS)
DO $$ 
BEGIN
    -- PLAYER PROP BETS: Market Context
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='open_line') THEN
        ALTER TABLE player_prop_bets ADD COLUMN open_line DECIMAL(6,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='current_line') THEN
        ALTER TABLE player_prop_bets ADD COLUMN current_line DECIMAL(6,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='line_movement') THEN
        ALTER TABLE player_prop_bets ADD COLUMN line_movement DECIMAL(6,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='implied_prob') THEN
        ALTER TABLE player_prop_bets ADD COLUMN implied_prob DECIMAL(5,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='clv') THEN
        ALTER TABLE player_prop_bets ADD COLUMN clv DECIMAL(6,2);
    END IF;

    -- TEAM TRENDS: Window Metadata
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_trends' AND column_name='games_sampled') THEN
        ALTER TABLE team_trends ADD COLUMN games_sampled INT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_trends' AND column_name='window_type') THEN
        ALTER TABLE team_trends ADD COLUMN window_type TEXT DEFAULT 'FULL_SEASON';
    END IF;

    -- UNIVERSAL TEMPORAL VALIDITY (Intel Cleanup/TTL)
    -- This handles the "time-decay" issue mentioned in the verdict.
    -- PERFORM add_temporal_columns('match_news');
    -- PERFORM add_temporal_columns('match_thesis');
    -- PERFORM add_temporal_columns('narrative_intel');
    -- PERFORM add_temporal_columns('edge_analysis');
    -- PERFORM add_temporal_columns('match_insights');
    -- PERFORM add_temporal_columns('player_prop_bets');
    -- PERFORM add_temporal_columns('team_trends');
END $$;

-- 5. EXPERT SEED DATA (Importance Normalization)
INSERT INTO importance_context (sport, insight_type, base_weight) VALUES
('NFL', 'ELIMINATION_GAME', 1.0),
('NFL', 'DIVISIONAL_MATCHUP', 0.8),
('NBA', 'ROOKIE_USAGE', 0.6),
('NBA', 'LOAD_MANAGEMENT', 0.9),
('NHL', 'HOME_ICE', 0.7)
ON CONFLICT (sport, insight_type) DO UPDATE SET base_weight = EXCLUDED.base_weight;
