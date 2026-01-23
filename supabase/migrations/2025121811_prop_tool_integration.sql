
-- 1. Ensure Domain Types & Enums
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'prop_bet_type') THEN
        CREATE TYPE prop_bet_type AS ENUM (
            'points', 'rebounds', 'assists', 'steals', 'blocks', 
            'threes_made', 'pra', 'pr', 'ra', 'pa', 
            'passing_yards', 'rushing_yards', 'receiving_yards', 
            'receptions', 'tackles', 'sacks', 'hits', 
            'shots_on_goal', 'goals', 'saves', 'interceptions', 'custom'
        );
    END IF;

    -- BEGIN
    --    CREATE TYPE prop_result AS ENUM ('pending', 'won', 'lost', 'push', 'void');
    -- EXCEPTION
    --    WHEN duplicate_object THEN NULL;
    -- END;
END $$;

-- 2. HARDENING PLAYER PROPS SCHEMA
DO $$ 
BEGIN
    -- Core Columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='user_id') THEN
        ALTER TABLE player_prop_bets ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='parlay_id') THEN
        ALTER TABLE player_prop_bets ADD COLUMN parlay_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='event_date') THEN
        ALTER TABLE player_prop_bets ADD COLUMN event_date DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='league') THEN
        ALTER TABLE player_prop_bets ADD COLUMN league TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='team') THEN
        ALTER TABLE player_prop_bets ADD COLUMN team TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='opponent') THEN
        ALTER TABLE player_prop_bets ADD COLUMN opponent TEXT;
    END IF;

    -- Financial & Probability Tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='stake_amount') THEN
        ALTER TABLE player_prop_bets ADD COLUMN stake_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='currency') THEN
        ALTER TABLE player_prop_bets ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='potential_payout') THEN
        ALTER TABLE player_prop_bets ADD COLUMN potential_payout NUMERIC(14,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='implied_prob_pct') THEN
        ALTER TABLE player_prop_bets ADD COLUMN implied_prob_pct NUMERIC(6,3);
    END IF;

    -- Result Tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='result') THEN
        ALTER TABLE player_prop_bets ADD COLUMN result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'won', 'lost', 'push', 'void'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='result_value') THEN
        ALTER TABLE player_prop_bets ADD COLUMN result_value NUMERIC(10,3);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='settled_at') THEN
        ALTER TABLE player_prop_bets ADD COLUMN settled_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='settled_pnl') THEN
        ALTER TABLE player_prop_bets ADD COLUMN settled_pnl NUMERIC(14,2);
    END IF;

    -- Expert / Alpha Fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='clv') THEN
        ALTER TABLE player_prop_bets ADD COLUMN clv NUMERIC(6,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='source_attribution') THEN
        ALTER TABLE player_prop_bets ADD COLUMN source_attribution TEXT;
    END IF;

    -- Adjust Precisions of existing columns
    -- ALTER TABLE player_prop_bets ALTER COLUMN line_value TYPE NUMERIC(10,3);
    -- ALTER TABLE player_prop_bets ALTER COLUMN open_line TYPE NUMERIC(6,2);
    -- ALTER TABLE player_prop_bets ALTER COLUMN current_line TYPE NUMERIC(6,2);
    -- ALTER TABLE player_prop_bets ALTER COLUMN line_movement TYPE NUMERIC(6,2);
    -- ALTER TABLE player_prop_bets ALTER COLUMN implied_prob TYPE NUMERIC(5,2);
    -- ALTER TABLE player_prop_bets ALTER COLUMN odds_decimal TYPE NUMERIC(8,3);

END $$;

-- 3. Trigger for Auto-Mapping Match IDs
-- Allows the mini-app to send (Team, Date) instead of internal UUIDs.
CREATE OR REPLACE FUNCTION sync_prop_to_match_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.match_id IS NULL THEN
        -- Try to find a match by team name part and start date
        SELECT id INTO NEW.match_id
        FROM matches
        WHERE (
            home_team->>'name' ILIKE '%' || NEW.team || '%' 
            OR away_team->>'name' ILIKE '%' || NEW.team || '%'
            OR home_team->>'shortName' ILIKE '%' || NEW.team || '%'
            OR away_team->>'shortName' ILIKE '%' || NEW.team || '%'
        )
        AND date_trunc('day', start_time) = date_trunc('day', NEW.event_date)
        LIMIT 1;
    END IF;
    
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_prop_match_id ON player_prop_bets;
CREATE TRIGGER trg_set_prop_match_id
BEFORE INSERT OR UPDATE OF team, opponent, event_date
ON player_prop_bets
FOR EACH ROW
EXECUTE FUNCTION sync_prop_to_match_id();

-- 4. Indices for Query Performance
-- CREATE INDEX IF NOT EXISTS idx_player_props_expiry ON public.player_prop_bets (valid_to);
CREATE INDEX IF NOT EXISTS idx_props_user ON public.player_prop_bets (user_id);
CREATE INDEX IF NOT EXISTS idx_props_match ON public.player_prop_bets (match_id);
CREATE INDEX IF NOT EXISTS idx_props_status ON public.player_prop_bets (result);
CREATE INDEX IF NOT EXISTS idx_player_props_player_name ON public.player_prop_bets (player_name);
