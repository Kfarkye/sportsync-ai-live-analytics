
-- PLAYER PROP STREAKS ARCHITECTURE
-- Tracks consecutive occurrences of player performances hitting over/under thresholds.

CREATE TABLE IF NOT EXISTS player_prop_streaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    team TEXT NOT NULL,
    sport TEXT NOT NULL,
    prop_type TEXT NOT NULL, -- Flexible string or link to prop_bet_type enum
    streak_type TEXT CHECK (streak_type IN ('OVER', 'UNDER')),
    streak_count INTEGER NOT NULL DEFAULT 0,
    threshold NUMERIC(10,3), -- The "Line" this streak is against (e.g. 15.5)
    avg_value NUMERIC(10,3), -- Avg performance during streak
    last_game_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Metadata/Grounding
    game_ids TEXT[], -- Array of match IDs included in the streak
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (player_id, prop_type, streak_type, threshold)
);

-- Indices for Scanning
CREATE INDEX IF NOT EXISTS idx_prop_streaks_player ON player_prop_streaks (player_id);
CREATE INDEX IF NOT EXISTS idx_prop_streaks_team ON player_prop_streaks (team);
CREATE INDEX IF NOT EXISTS idx_prop_streaks_active ON player_prop_streaks (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_prop_streaks_count ON player_prop_streaks (streak_count DESC);

-- Enable RLS
ALTER TABLE player_prop_streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read Access" ON player_prop_streaks FOR SELECT USING (true);

-- Function to Update Streaks (Logical Blueprint)
-- This will be called by the Ingest/Sync functions after a game finalizes.
CREATE OR REPLACE FUNCTION update_player_streak(
    p_player_id TEXT,
    p_player_name TEXT,
    p_team TEXT,
    p_sport TEXT,
    p_prop_type TEXT,
    p_streak_type TEXT,
    p_threshold NUMERIC,
    p_actual_value NUMERIC,
    p_match_id TEXT,
    p_game_date DATE
) RETURNS VOID AS $$
DECLARE
    v_hit BOOLEAN;
BEGIN
    -- Determine if the threshold was hit
    IF p_streak_type = 'OVER' THEN
        v_hit := p_actual_value > p_threshold;
    ELSE
        v_hit := p_actual_value < p_threshold;
    END IF;

    IF v_hit THEN
        -- Increase streak or start new
        INSERT INTO player_prop_streaks (
            player_id, player_name, team, sport, prop_type, streak_type, 
            streak_count, threshold, avg_value, last_game_date, game_ids
        ) VALUES (
            p_player_id, p_player_name, p_team, p_sport, p_prop_type, p_streak_type,
            1, p_threshold, p_actual_value, p_game_date, ARRAY[p_match_id]
        )
        ON CONFLICT (player_id, prop_type, streak_type, threshold)
        DO UPDATE SET
            streak_count = player_prop_streaks.streak_count + 1,
            avg_value = (player_prop_streaks.avg_value * player_prop_streaks.streak_count + p_actual_value) / (player_prop_streaks.streak_count + 1),
            last_game_date = p_game_date,
            game_ids = array_append(player_prop_streaks.game_ids, p_match_id),
            is_active = TRUE,
            updated_at = NOW();
    ELSE
        -- Break streak
        UPDATE player_prop_streaks 
        SET is_active = FALSE, streak_count = 0, updated_at = NOW()
        WHERE player_id = p_player_id 
          AND prop_type = p_prop_type 
          AND streak_type = p_streak_type 
          AND threshold = p_threshold;
    END IF;
END;
$$ LANGUAGE plpgsql;
