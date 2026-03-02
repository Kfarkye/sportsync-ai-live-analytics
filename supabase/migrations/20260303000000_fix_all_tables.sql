-- ============================================================================
-- MASTER DATABASE REPAIR & OPTIMIZATION SCRIPT
-- v6.6 | Contextual Intelligence Moat & Master Entity Resolvers
-- ============================================================================

-- 1. EXTENSIONS
-- Omitted CREATE EXTENSION pg_cron to bypass 2BP01 privilege errors.
-- Manage via dashboard.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. ENSURE TABLES EXIST (Safe creation)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.matches (
    id TEXT PRIMARY KEY,
    league_id TEXT,
    sport TEXT,
    home_team_id TEXT,
    away_team_id TEXT,
    home_team TEXT,
    away_team TEXT,
    "homeTeam" JSONB, 
    "awayTeam" JSONB, 
    start_time TIMESTAMPTZ,
    "startTime" TIMESTAMPTZ, 
    "leagueId" TEXT,         
    status TEXT DEFAULT 'STATUS_SCHEDULED',
    period INTEGER,
    display_clock TEXT,
    home_score INTEGER,
    away_score INTEGER,
    win_probability JSONB,
    current_odds JSONB,
    opening_odds JSONB,
    closing_odds JSONB,
    is_closing_locked BOOLEAN DEFAULT FALSE,
    odds_api_event_id TEXT,
    extra_data JSONB,
    last_odds_update TIMESTAMPTZ,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 🚨 MASTER ENTITY TABLES RESTORED 🚨
CREATE TABLE IF NOT EXISTS public.canonical_games (
    id TEXT PRIMARY KEY,
    league_id TEXT,
    sport TEXT,
    home_team_name TEXT,
    away_team_name TEXT,
    commence_time TIMESTAMPTZ,
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.entity_mappings (
    id BIGSERIAL PRIMARY KEY,
    external_id TEXT NOT NULL,
    canonical_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    discovery_method TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, external_id)
);

CREATE TABLE IF NOT EXISTS public.canonical_venues (
    id TEXT PRIMARY KEY,
    name TEXT,
    city TEXT,
    state TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.canonical_officials (
    id TEXT PRIMARY KEY,
    name TEXT,
    sport TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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
    freshness TEXT DEFAULT 'RECENT', 
    confidence_score NUMERIC,         
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(match_id, game_date)
);

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

CREATE TABLE IF NOT EXISTS public.market_feeds (
    id BIGSERIAL PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    canonical_id TEXT,
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

-- 🚨 LIVE GAME STATE WITH RESTORED DATA MOAT SCHEMA
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
    recent_plays JSONB,
    stats JSONB,
    player_stats JSONB,
    leaders JSONB,
    momentum JSONB,
    advanced_metrics JSONB,
    match_context JSONB,
    predictor JSONB,
    deterministic_signals JSONB,
    ai_analysis JSONB,
    odds JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- 3. ENSURE COLUMNS (Recovery for existing tables)
-- ----------------------------------------------------------------------------
DO $$ 
BEGIN
    -- matches columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='home_team_id') THEN ALTER TABLE matches ADD COLUMN home_team_id TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='away_team_id') THEN ALTER TABLE matches ADD COLUMN away_team_id TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='period') THEN ALTER TABLE matches ADD COLUMN period INTEGER; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='display_clock') THEN ALTER TABLE matches ADD COLUMN display_clock TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='home_score') THEN ALTER TABLE matches ADD COLUMN home_score INTEGER; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='away_score') THEN ALTER TABLE matches ADD COLUMN away_score INTEGER; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='extra_data') THEN ALTER TABLE matches ADD COLUMN extra_data JSONB; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='is_closing_locked') THEN ALTER TABLE matches ADD COLUMN is_closing_locked BOOLEAN DEFAULT FALSE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='last_updated') THEN ALTER TABLE matches ADD COLUMN last_updated TIMESTAMPTZ DEFAULT NOW(); END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='homeTeam') THEN ALTER TABLE matches ADD COLUMN "homeTeam" JSONB; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='awayTeam') THEN ALTER TABLE matches ADD COLUMN "awayTeam" JSONB; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='startTime') THEN ALTER TABLE matches ADD COLUMN "startTime" TIMESTAMPTZ; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='leagueId') THEN ALTER TABLE matches ADD COLUMN "leagueId" TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='odds_api_event_id') THEN ALTER TABLE matches ADD COLUMN odds_api_event_id TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='matches' AND column_name='last_odds_update') THEN ALTER TABLE matches ADD COLUMN last_odds_update TIMESTAMPTZ; END IF;

    -- pregame_intel columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pregame_intel' AND column_name='briefing') THEN ALTER TABLE pregame_intel ADD COLUMN briefing TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pregame_intel' AND column_name='home_team') THEN ALTER TABLE pregame_intel ADD COLUMN home_team TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pregame_intel' AND column_name='away_team') THEN ALTER TABLE pregame_intel ADD COLUMN away_team TEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pregame_intel' AND column_name='freshness') THEN ALTER TABLE pregame_intel ADD COLUMN freshness TEXT DEFAULT 'RECENT'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pregame_intel' AND column_name='confidence_score') THEN ALTER TABLE pregame_intel ADD COLUMN confidence_score NUMERIC; END IF;

    -- market_feeds columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='market_feeds' AND column_name='external_id') THEN ALTER TABLE market_feeds ADD COLUMN external_id TEXT UNIQUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='market_feeds' AND column_name='canonical_id') THEN ALTER TABLE market_feeds ADD COLUMN canonical_id TEXT; END IF;

    -- 🚨 LIVE GAME STATE CONTEXT COLUMNS RESTORATION 🚨
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='live_game_state' AND column_name='recent_plays') THEN ALTER TABLE live_game_state ADD COLUMN recent_plays JSONB; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='live_game_state' AND column_name='stats') THEN ALTER TABLE live_game_state ADD COLUMN stats JSONB; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='live_game_state' AND column_name='player_stats') THEN ALTER TABLE live_game_state ADD COLUMN player_stats JSONB; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='live_game_state' AND column_name='leaders') THEN ALTER TABLE live_game_state ADD COLUMN leaders JSONB; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='live_game_state' AND column_name='momentum') THEN ALTER TABLE live_game_state ADD COLUMN momentum JSONB; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='live_game_state' AND column_name='advanced_metrics') THEN ALTER TABLE live_game_state ADD COLUMN advanced_metrics JSONB; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='live_game_state' AND column_name='match_context') THEN ALTER TABLE live_game_state ADD COLUMN match_context JSONB; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='live_game_state' AND column_name='predictor') THEN ALTER TABLE live_game_state ADD COLUMN predictor JSONB; END IF;
END $$;


-- 4. PUBLIC ACCESS PERMISSIONS (🚨 GUARANTEED COMPREHENSIVE RECOVERY)
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
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_officials ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "Public read teams" ON teams;
CREATE POLICY "Public read teams" ON teams FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read canonical_games" ON canonical_games;
CREATE POLICY "Public read canonical_games" ON canonical_games FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read entity_mappings" ON entity_mappings;
CREATE POLICY "Public read entity_mappings" ON entity_mappings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read canonical_venues" ON canonical_venues;
CREATE POLICY "Public read canonical_venues" ON canonical_venues FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read canonical_officials" ON canonical_officials;
CREATE POLICY "Public read canonical_officials" ON canonical_officials FOR SELECT TO anon, authenticated USING (true);


-- 5. CRON INFRASTRUCTURE 
-- ----------------------------------------------------------------------------
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
    body := '{"leagues": ["nba", "nfl", "nhl", "mlb", "college-football", "mens-college-basketball", "epl", "laliga", "mls", "bundesliga", "seriea", "ligue1", "ucl", "uel", "wnba", "atp", "wta"]}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END; $$;

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

DROP FUNCTION IF EXISTS public.invoke_capture_opening_lines();
CREATE OR REPLACE FUNCTION public.invoke_capture_opening_lines()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_url text := 'https://qffzvrnbzabcokqqrwbv.supabase.co';
  service_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/capture-opening-lines',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := '{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END; $$;

-- 6. SCHEDULE JOBS
DO $$
BEGIN
    PERFORM cron.unschedule('pregame-intel-research-cron');
    PERFORM cron.unschedule('high-frequency-live-ingest');
    PERFORM cron.unschedule('ingest-odds-every-minute');
    PERFORM cron.unschedule('espn-sync-daily');
    PERFORM cron.unschedule('capture-opening-lines-every-6-hours');
    PERFORM cron.unschedule('live-odds-tracker-every-2-min');
    PERFORM cron.unschedule('sync-player-props-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('espn-sync-daily', '0 */12 * * *', 'SELECT invoke_espn_sync()');
SELECT cron.schedule('pregame-intel-research-cron', '0 * * * *', 'SELECT invoke_pregame_intel_cron()');
SELECT cron.schedule('high-frequency-live-ingest', '* * * * *', 'SELECT invoke_ingest_live_games()');
SELECT cron.schedule('ingest-odds-every-minute', '* * * * *', 'SELECT invoke_ingest_odds()');
SELECT cron.schedule('live-odds-tracker-every-2-min', '*/2 * * * *', 'SELECT invoke_live_odds_tracker()');
SELECT cron.schedule('sync-player-props-hourly', '30 * * * *', 'SELECT invoke_sync_player_props()');
SELECT cron.schedule('capture-opening-lines-every-6-hours', '0 */6 * * *', 'SELECT invoke_capture_opening_lines()');

NOTIFY pgrst, 'reload schema';
SELECT 'DATABASE STRUCTURE RECOVERY COMPLETED' as status;
