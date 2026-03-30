
-- ============================================================================
-- Polymarket Player Props
-- Stores prediction market pricing for individual player prop bets
-- Enables "Real-money markets vs. books" comparison at the prop level
-- ============================================================================

CREATE TABLE IF NOT EXISTS poly_player_props (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id         text,                          -- FK to matches.id
    poly_event_id   text NOT NULL,                 -- Polymarket event ID
    poly_condition_id text NOT NULL,               -- Unique per market
    player_name     text NOT NULL,                 -- Parsed from question
    stat_type       text NOT NULL,                 -- points, rebounds, assists, threes, pra, etc.
    prop_line       numeric NOT NULL,              -- The over/under line (e.g. 27.5)
    over_prob       numeric NOT NULL DEFAULT 0,    -- Polymarket Over probability (0-1)
    under_prob      numeric NOT NULL DEFAULT 0,    -- Polymarket Under probability (0-1)
    volume          numeric DEFAULT 0,             -- Total volume in USD
    local_league_id text,                          -- nba, nhl, etc.
    game_date       date,                          -- Game date
    game_start_time timestamptz,                   -- Event start time
    market_active   boolean DEFAULT true,
    poly_updated_at timestamptz DEFAULT now(),
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),
    
    CONSTRAINT uq_poly_player_prop UNIQUE (poly_condition_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_poly_props_game_id ON poly_player_props(game_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_poly_props_player ON poly_player_props(player_name, stat_type);
CREATE INDEX IF NOT EXISTS idx_poly_props_active ON poly_player_props(market_active, game_date);
CREATE INDEX IF NOT EXISTS idx_poly_props_league_date ON poly_player_props(local_league_id, game_date);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_poly_props_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_poly_props_updated
    BEFORE UPDATE ON poly_player_props
    FOR EACH ROW
    EXECUTE FUNCTION update_poly_props_timestamp();

-- RLS
ALTER TABLE poly_player_props ENABLE ROW LEVEL SECURITY;
CREATE POLICY "poly_player_props_read" ON poly_player_props FOR SELECT USING (true);
;
