-- =================================================================
-- SQL BACKFILL SCRIPT FOR CANONICAL IDENTITY LAYER
-- Run this in the Supabase SQL Editor to "snap-in" the architecture.
-- =================================================================

-- 1. Create Helper Function to Normalize Team Slugs (mirrors match-registry.ts)
CREATE OR REPLACE FUNCTION normalize_team_slug(name TEXT) RETURNS TEXT AS $$
DECLARE
    clean TEXT;
BEGIN
    if name IS NULL THEN RETURN 'unknown'; END IF;
    clean := lower(name);
    -- Remove common prefixes/suffixes (basic set)
    clean := regexp_replace(clean, '\y(the|fc|afc|sc|club)\y', '', 'g');
    -- Remove non-alphanumeric (keep spaces temporarily for word matching)
    clean := regexp_replace(clean, '[^a-z0-9\s]', '', 'g');
    -- Replacements
    clean := regexp_replace(clean, '\ystate\y', 'st', 'g');
    clean := regexp_replace(clean, '\yuniversity\y', 'univ', 'g');
    clean := regexp_replace(clean, '\ylos angeles\y', 'la', 'g');
    clean := regexp_replace(clean, '\yst louis\y', 'stl', 'g');
    -- Remove all spaces final
    clean := replace(clean, ' ', '');
    RETURN trim(clean);
END;
$$ LANGUAGE plpgsql;

-- 2. Create Helper to Generate Deterministic ID
CREATE OR REPLACE FUNCTION generate_backfill_id(team_a TEXT, team_b TEXT, start_time TIMESTAMPTZ, league_id TEXT) RETURNS TEXT AS $$
DECLARE
    slug_a TEXT := normalize_team_slug(team_a);
    slug_b TEXT := normalize_team_slug(team_b);
    date_part TEXT := to_char(start_time, 'YYYYMMDD');
    first_team TEXT;
    second_team TEXT;
    league_part TEXT;
BEGIN
    -- Alphabetical Sort for stability
    IF slug_a < slug_b THEN
        first_team := slug_a;
        second_team := slug_b;
    ELSE
        first_team := slug_b;
        second_team := slug_a;
    END IF;
    
    -- League ID Cleaning (simplified map)
    league_part := CASE lower(league_id)
        WHEN 'nba' THEN 'nba'
        WHEN 'nfl' THEN 'nfl'
        WHEN 'college-football' THEN 'ncaaf'
        WHEN 'mens-college-basketball' THEN 'ncaab'
        WHEN 'mlb' THEN 'mlb'
        WHEN 'nhl' THEN 'nhl'
        WHEN 'eng.1' THEN 'epl'
        WHEN 'esp.1' THEN 'laliga'
        WHEN 'usa.1' THEN 'mls'
        WHEN 'ger.1' THEN 'bundesliga'
        WHEN 'ita.1' THEN 'seriea'
        WHEN 'fra.1' THEN 'ligue1'
        WHEN 'uefa.champions' THEN 'ucl'
        WHEN 'uefa.europa' THEN 'uel'
        WHEN 'caf.nations' THEN 'afcon'
        WHEN 'wnba' THEN 'wnba'
        ELSE replace(league_id, '.', '') -- Fallback
    END;

    RETURN date_part || '_' || first_team || '_' || second_team || '_' || league_part;
END;
$$ LANGUAGE plpgsql;

-- 3. Execute Backfill (DO Block)
DO $$
DECLARE
    r RECORD;
    c_id TEXT;
    counter INT := 0;
BEGIN
    -- Iterate over active/scheduled/recent games
    FOR r IN SELECT * FROM matches 
             WHERE status IN ('STATUS_SCHEDULED', 'STATUS_IN_PROGRESS', 'STATUS_HALFTIME') 
             OR start_time > NOW() - INTERVAL '2 days' 
    LOOP
        -- Generate ID (fix: cast JSONB to TEXT)
        c_id := generate_backfill_id(r.home_team #>> '{}', r.away_team #>> '{}', r.start_time, r.league_id);
        
        -- 1. Upsert Canonical Game
        -- Note: We use ON CONFLICT DO UPDATE to handle status changes
        INSERT INTO canonical_games (id, league_id, sport, commence_time, status, home_team_name, away_team_name)
        VALUES (
            c_id, 
            r.league_id, 
            COALESCE(r.sport, CASE 
                WHEN r.league_id IN ('nba', 'mens-college-basketball', 'wnba') THEN 'basketball'
                WHEN r.league_id IN ('nfl', 'college-football') THEN 'football'
                WHEN r.league_id IN ('mlb') THEN 'baseball'
                WHEN r.league_id IN ('nhl') THEN 'hockey'
                ELSE 'soccer' 
            END),
            r.start_time, 
            r.status, 
            r.home_team #>> '{}', 
            r.away_team #>> '{}'
        )
        ON CONFLICT (id) DO UPDATE SET 
            status = EXCLUDED.status,
            updated_at = NOW();
        
        -- 2. Upsert Mapping (Link ESPN ID to Canonical ID)
        INSERT INTO entity_mappings (canonical_id, provider, external_id, discovery_method, confidence_score)
        VALUES (c_id, 'ESPN', r.id, 'backfill_sql', 1.0)
        ON CONFLICT (provider, external_id) 
        DO UPDATE SET canonical_id = c_id;
        
        -- 3. Update Match Record (Snap-in)
        UPDATE matches SET canonical_id = c_id WHERE id = r.id;
        
        counter := counter + 1;
    END LOOP;
    
    RAISE NOTICE 'Backfill Complete: Processed % matches.', counter;
END;
$$;
