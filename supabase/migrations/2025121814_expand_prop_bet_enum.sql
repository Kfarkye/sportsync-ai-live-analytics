
-- Update prop_bet_type enum to include missing markets from The Odds API
-- We use a DO block to safely add values without failing if they already exist

DO $$ 
BEGIN
    -- Add anytime_td
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'prop_bet_type' AND e.enumlabel = 'anytime_td') THEN
        ALTER TYPE prop_bet_type ADD VALUE 'anytime_td';
    END IF;

    -- Add passing_tds
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'prop_bet_type' AND e.enumlabel = 'passing_tds') THEN
        ALTER TYPE prop_bet_type ADD VALUE 'passing_tds';
    END IF;

    -- Add strikeouts
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'prop_bet_type' AND e.enumlabel = 'strikeouts') THEN
        ALTER TYPE prop_bet_type ADD VALUE 'strikeouts';
    END IF;

    -- Add total_bases
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'prop_bet_type' AND e.enumlabel = 'total_bases') THEN
        ALTER TYPE prop_bet_type ADD VALUE 'total_bases';
    END IF;
END $$;
