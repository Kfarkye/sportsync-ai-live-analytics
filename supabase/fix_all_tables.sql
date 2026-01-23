
-- ============================================================================
-- MASTER DATABASE REPAIR & OPTIMIZATION SCRIPT
-- v6.0 | Resolve 404s, RLS issues, and Cron Failures
-- ============================================================================

-- 1. EXTENSIONS (Requirement for net and cron)
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENSURE TABLES EXIST (Safe creation)
-- ----------------------------------------------------------------------------

-- MATCHES (The central hub)
CREATE TABLE IF NOT EXISTS public.matches (
    id TEXT PRIMARY KEY,
    league_id TEXT,
    sport TEXT,
    home_team_id TEXT,
    away_team_id TEXT,
    home_team TEXT, -- String displayName
    away_team TEXT, -- String displayName
    "homeTeam" JSONB, -- Engine compatibility (CamelCase)
    "awayTeam" JSONB, -- Engine compatibility (CamelCase)
    start_time TIMESTAMPTZ,
    "startTime" TIMESTAMPTZ, -- Engine compatibility (CamelCase)
    "leagueId" TEXT,         -- Engine compatibility (CamelCase)
    status TEXT DEFAULT 'STATUS_SCHEDULED',
    period INTEGER,
    display_clock TEXT,
    home_score INTEGER,
    away_score INTEGER,
    win_probability JSONB,
    current_odds JSONB,
    opening_odds JSONB,
    closing_odds JSONB,
    odds_api_event_id TEXT, -- For Prop Sync
    last_odds_update TIMESTAMPTZ,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PREGAME INTEL
CREATE TABLE IF NOT EXISTS public.pregame_intel (
    intel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    sport TEXT,
    league_id TEXT,
    home_team TEXT,
    away_team TEXT,
    game_date DATE,
    headline TEXT,
    cards JSONB DEFAULT '[]',
    sources JSONB DEFAULT '[]',
    briefing TEXT, 
    freshness TEXT DEFAULT 'RECENT', -- Added for frontend compatibility
    confidence_score NUMERIC,         -- Added for frontend compatibility
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(match_id, game_date)
);

-- PLAYER PROP BETS
CREATE TABLE IF NOT EXISTS public.player_prop_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    player_id TEXT,
    player_name TEXT NOT NULL,
    bet_type TEXT NOT NULL,
    line_value NUMERIC(10,3) NOT NULL,
    odds_american INTEGER NOT NULL,
    side TEXT NOT NULL,
    market_label TEXT,
    provider TEXT,
    sportsbook TEXT,
    team TEXT,
    headshot_url TEXT,
    confidence_score NUMERIC(5,2),
    event_date DATE,
    league TEXT,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(match_id, player_name, bet_type, side, provider)
);

-- MARKET FEEDS (Real-time odds)
CREATE TABLE IF NOT EXISTS public.market_feeds (
    id BIGSERIAL PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    sport_key TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    commence_time TIMESTAMPTZ NOT NULL,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    raw_bookmakers JSONB DEFAULT '[]',
    best_h2h JSONB,
    best_spread JSONB,
    best_total JSONB,
    best_h2h_h2 JSONB,
    best_spread_h2 JSONB,
    best_total_h2 JSONB,
    is_live BOOLEAN DEFAULT FALSE
);

-- TEAMS (Canonical database)
CREATE TABLE IF NOT EXISTS public.teams (
    id TEXT PRIMARY KEY,
    league_id TEXT,
    name TEXT NOT NULL,
    short_name TEXT,
    abbreviation TEXT,
    logo_url TEXT,
    color TEXT,
    alternate_color TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read teams" ON teams;
CREATE POLICY "Public read teams" ON teams FOR SELECT TO anon, authenticated USING (true);

-- HISTORICAL INTEL & METRICS
CREATE TABLE IF NOT EXISTS public.match_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT NOT NULL,
    insight_text TEXT NOT NULL,
    impact_level TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_name TEXT UNIQUE NOT NULL,
    offensive_rating NUMERIC,
    defensive_rating NUMERIC,
    pace NUMERIC,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ref_intel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT UNIQUE NOT NULL,
    content JSONB NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stadiums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    espn_id INTEGER UNIQUE,
    name TEXT NOT NULL,
    city TEXT,
    state TEXT,
    capacity INTEGER,
    indoor BOOLEAN DEFAULT FALSE,
    surface_type TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.opening_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT UNIQUE NOT NULL,
    home_spread NUMERIC,
    away_spread NUMERIC,
    total NUMERIC,
    home_ml INTEGER,
    away_ml INTEGER,
    provider TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.closing_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id TEXT UNIQUE NOT NULL,
    total NUMERIC,
    home_spread NUMERIC,
    away_spread NUMERIC,
    home_ml INTEGER,
    away_ml INTEGER,
    league_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ENSURE COLUMNS (Recovery for existing tables)
-- ----------------------------------------------------------------------------
DO $$ 
BEGIN
    -- matches columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='home_team_id') THEN
        ALTER TABLE matches ADD COLUMN home_team_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='away_team_id') THEN
        ALTER TABLE matches ADD COLUMN away_team_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='period') THEN
        ALTER TABLE matches ADD COLUMN period INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='display_clock') THEN
        ALTER TABLE matches ADD COLUMN display_clock TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='home_score') THEN
        ALTER TABLE matches ADD COLUMN home_score INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='away_score') THEN
        ALTER TABLE matches ADD COLUMN away_score INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='last_updated') THEN
        ALTER TABLE matches ADD COLUMN last_updated TIMESTAMPTZ DEFAULT NOW();
    END IF;
    -- CamelCase Support
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='homeTeam') THEN
        ALTER TABLE matches ADD COLUMN "homeTeam" JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='awayTeam') THEN
        ALTER TABLE matches ADD COLUMN "awayTeam" JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='startTime') THEN
        ALTER TABLE matches ADD COLUMN "startTime" TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='leagueId') THEN
        ALTER TABLE matches ADD COLUMN "leagueId" TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='odds_api_event_id') THEN
        ALTER TABLE matches ADD COLUMN odds_api_event_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='last_odds_update') THEN
        ALTER TABLE matches ADD COLUMN last_odds_update TIMESTAMPTZ;
    END IF;

    -- pregame_intel columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pregame_intel' AND column_name='briefing') THEN
        ALTER TABLE pregame_intel ADD COLUMN briefing TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pregame_intel' AND column_name='home_team') THEN
        ALTER TABLE pregame_intel ADD COLUMN home_team TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pregame_intel' AND column_name='away_team') THEN
        ALTER TABLE pregame_intel ADD COLUMN away_team TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pregame_intel' AND column_name='freshness') THEN
        ALTER TABLE pregame_intel ADD COLUMN freshness TEXT DEFAULT 'RECENT';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pregame_intel' AND column_name='confidence_score') THEN
        ALTER TABLE pregame_intel ADD COLUMN confidence_score NUMERIC;
    END IF;

    -- player_prop_bets columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='event_date') THEN
        ALTER TABLE player_prop_bets ADD COLUMN event_date DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='league') THEN
        ALTER TABLE player_prop_bets ADD COLUMN league TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='team') THEN
        ALTER TABLE player_prop_bets ADD COLUMN team TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='headshot_url') THEN
        ALTER TABLE player_prop_bets ADD COLUMN headshot_url TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_prop_bets' AND column_name='sportsbook') THEN
        ALTER TABLE player_prop_bets ADD COLUMN sportsbook TEXT;
    END IF;

    -- market_feeds columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='market_feeds' AND column_name='external_id') THEN
        ALTER TABLE market_feeds ADD COLUMN external_id TEXT UNIQUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='market_feeds' AND column_name='best_h2h_h2') THEN
        ALTER TABLE market_feeds ADD COLUMN best_h2h_h2 JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='market_feeds' AND column_name='best_spread_h2') THEN
        ALTER TABLE market_feeds ADD COLUMN best_spread_h2 JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='market_feeds' AND column_name='best_total_h2') THEN
        ALTER TABLE market_feeds ADD COLUMN best_total_h2 JSONB;
    END IF;

    -- live_game_state columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='live_game_state' AND column_name='odds') THEN
        ALTER TABLE live_game_state ADD COLUMN odds JSONB;
    END IF;
END $$;

-- LIVE GAME STATE (Real-time hub)
CREATE TABLE IF NOT EXISTS public.live_game_state (
    id TEXT PRIMARY KEY,
    league_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    game_status TEXT NOT NULL DEFAULT 'SCHEDULED',
    period INTEGER,
    clock TEXT,
    home_score INTEGER DEFAULT 0,
    away_score INTEGER DEFAULT 0,
    situation JSONB,
    last_play JSONB,
    current_drive JSONB,
    deterministic_signals JSONB,
    ai_analysis JSONB,
    odds JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- COACHES (Seeded data reference)
CREATE TABLE IF NOT EXISTS public.coaches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    team_abbrev TEXT NOT NULL,
    coach_name TEXT NOT NULL,
    sport TEXT NOT NULL,
    league_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, sport)
);

-- 4. PUBLIC ACCESS PERMISSIONS (Fixes 404s)
-- ----------------------------------------------------------------------------
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pregame_intel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_prop_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ref_intel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stadiums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closing_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_game_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;

-- DROP and RECREATE anonymous read policies
DROP POLICY IF EXISTS "Public read matches" ON matches;
CREATE POLICY "Public read matches" ON matches FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read pregame_intel" ON pregame_intel;
CREATE POLICY "Public read pregame_intel" ON pregame_intel FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read player_prop_bets" ON player_prop_bets;
CREATE POLICY "Public read player_prop_bets" ON player_prop_bets FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read market_feeds" ON market_feeds;
CREATE POLICY "Public read market_feeds" ON market_feeds FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read match_insights" ON match_insights;
CREATE POLICY "Public read match_insights" ON match_insights FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read team_metrics" ON team_metrics;
CREATE POLICY "Public read team_metrics" ON team_metrics FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read ref_intel" ON ref_intel;
CREATE POLICY "Public read ref_intel" ON ref_intel FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read stadiums" ON stadiums;
CREATE POLICY "Public read stadiums" ON stadiums FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read opening_lines" ON opening_lines;
CREATE POLICY "Public read opening_lines" ON opening_lines FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read closing_lines" ON closing_lines;
CREATE POLICY "Public read closing_lines" ON closing_lines FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read live_game_state" ON live_game_state;
CREATE POLICY "Public read live_game_state" ON live_game_state FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read coaches" ON coaches;
CREATE POLICY "Public read coaches" ON coaches FOR SELECT TO anon, authenticated USING (true);

-- 5. CRON INFRASTRUCTURE (Fixes missing function errors)
-- ----------------------------------------------------------------------------

-- A. PREGAME INTEL CRON
DROP FUNCTION IF EXISTS public.invoke_pregame_intel_cron();
CREATE OR REPLACE FUNCTION public.invoke_pregame_intel_cron()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  service_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/pregame-intel-cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := '{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END; $$;

-- B. LIVE INGEST CRON
DROP FUNCTION IF EXISTS public.invoke_ingest_live_games();
CREATE OR REPLACE FUNCTION public.invoke_ingest_live_games()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  service_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/ingest-live-games',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := '{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END; $$;

-- C. ODDS INGEST CRON
DROP FUNCTION IF EXISTS public.invoke_ingest_odds();
CREATE OR REPLACE FUNCTION public.invoke_ingest_odds()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  service_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/ingest-odds',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := '{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END; $$;

-- D. LIVE ODDS TRACKER CRON
DROP FUNCTION IF EXISTS public.invoke_live_odds_tracker();
CREATE OR REPLACE FUNCTION public.invoke_live_odds_tracker()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  service_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/live-odds-tracker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := '{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END; $$;

-- E. PLAYER PROP SYNC CRON
DROP FUNCTION IF EXISTS public.invoke_sync_player_props();
CREATE OR REPLACE FUNCTION public.invoke_sync_player_props()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  service_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/sync-player-props',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := '{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END; $$;

-- F. MASTER ESPN SYNC (Daily Schedule)
DROP FUNCTION IF EXISTS public.invoke_espn_sync();
CREATE OR REPLACE FUNCTION public.invoke_espn_sync()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  service_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/espn-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := '{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END; $$;

-- 6. SCHEDULE JOBS
DO $$
BEGIN
    PERFORM cron.unschedule('pregame-intel-hourly');
    PERFORM cron.unschedule('pregame-intel-research-cron');
    PERFORM cron.unschedule('high-frequency-live-ingest');
    PERFORM cron.unschedule('ingest-odds-every-minute');
    PERFORM cron.unschedule('live-odds-tracker-every-2-min');
    PERFORM cron.unschedule('sync-player-props-hourly');
    PERFORM cron.unschedule('espn-sync-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('espn-sync-daily', '0 */12 * * *', 'SELECT invoke_espn_sync()');
SELECT cron.schedule('pregame-intel-research-cron', '0 * * * *', 'SELECT invoke_pregame_intel_cron()');
SELECT cron.schedule('high-frequency-live-ingest', '* * * * *', 'SELECT invoke_ingest_live_games()');
SELECT cron.schedule('ingest-odds-every-minute', '* * * * *', 'SELECT invoke_ingest_odds()');
SELECT cron.schedule('live-odds-tracker-every-2-min', '*/2 * * * *', 'SELECT invoke_live_odds_tracker()');
SELECT cron.schedule('sync-player-props-hourly', '30 * * * *', 'SELECT invoke_sync_player_props()');

-- Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

SELECT 'DATABASE STRUCTURE RECOVERY COMPLETED' as status;
