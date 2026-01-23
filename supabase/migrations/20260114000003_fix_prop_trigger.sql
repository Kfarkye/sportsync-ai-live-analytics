
-- Fix for player_prop_bets trigger missing updated_at column
-- Identify: record "new" has no field "updated_at"

DO $$
BEGIN
    -- 1. Add updated_at column if it's genuinely missing but desired
    -- Some triggers assume this column exists on all tables
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='player_prop_bets' AND column_name='updated_at') THEN
        ALTER TABLE player_prop_bets ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    -- 2. Fix the trigger function to be more resilient
    -- It was previously hardcoded to use updated_at, but the table had last_updated
    CREATE OR REPLACE FUNCTION public.sync_prop_to_match_id()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
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
        
        -- Use updated_at if it exists, otherwise use last_updated
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='updated_at') THEN
            NEW.updated_at = NOW();
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='last_updated') THEN
            NEW.last_updated = NOW();
        END IF;
        
        RETURN NEW;
    END;
    $function$;

END $$;
