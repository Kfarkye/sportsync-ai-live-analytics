-- ═══════════════════════════════════════════════════════════════════════════
-- MASTER TEAM REGISTRY (Knowledge Graph Base)
-- Maps fragmented team naming across providers to a stable canonical identity.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Canonical Teams Registry
CREATE TABLE IF NOT EXISTS public.canonical_teams (
    id TEXT PRIMARY KEY, -- e.g. 'basketball_nba_lal' (sport_league_slug)
    league_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    
    display_name TEXT NOT NULL, -- "Los Angeles Lakers"
    short_name TEXT,            -- "Lakers"
    abbreviation TEXT,         -- "LAL"
    
    primary_color TEXT,
    secondary_color TEXT,
    logo_url TEXT,
    
    -- Metadata
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Team Aliases (The Fuzzy Linker)
CREATE TABLE IF NOT EXISTS public.team_aliases (
    id BIGSERIAL PRIMARY KEY,
    canonical_id TEXT REFERENCES public.canonical_teams(id) ON DELETE CASCADE,
    alias TEXT NOT NULL, -- e.g. "Man City", "Manchester City", "MCFC"
    league_id TEXT NOT NULL,
    
    UNIQUE(alias, league_id)
);

-- Optimization: Function-based index for case-insensitive lookup (Audit Refinement 4)
CREATE INDEX IF NOT EXISTS idx_team_aliases_lookup ON public.team_aliases(LOWER(alias), league_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- CANONICAL GAME REGISTRY (Lineage & Evidence)
-- ═══════════════════════════════════════════════════════════════════════════

-- 3. Canonical Games
CREATE TABLE IF NOT EXISTS public.canonical_games (
    id TEXT PRIMARY KEY, -- Deterministic: YYYYMMDD_TEAM1_TEAM2_LEAGUE
    
    league_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    
    home_team_id TEXT REFERENCES public.canonical_teams(id),
    away_team_id TEXT REFERENCES public.canonical_teams(id),
    
    -- Denormalized names for easy debugging / lazy linking
    home_team_name TEXT,
    away_team_name TEXT,
    
    commence_time TIMESTAMPTZ NOT NULL,
    venue_id TEXT, -- Future: link to venue registry
    
    status TEXT DEFAULT 'scheduled', -- scheduled, live, completed, postponed
    
    is_active BOOLEAN DEFAULT TRUE, -- Handling for cancelled/deleted games (Audit Refinement 5)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optimization: Indexes for time-range queries (Audit Addition)
CREATE INDEX IF NOT EXISTS idx_games_commence ON public.canonical_games(commence_time);
CREATE INDEX IF NOT EXISTS idx_games_status ON public.canonical_games(status, commence_time);

-- 4. Entity Mappings (The Bridge)
CREATE TABLE IF NOT EXISTS public.entity_mappings (
    id BIGSERIAL PRIMARY KEY,
    canonical_id TEXT REFERENCES public.canonical_games(id) ON DELETE CASCADE,
    
    provider TEXT NOT NULL, -- 'ESPN', 'THE_ODDS_API', 'SPORTRADAR'
    external_id TEXT NOT NULL,
    
    -- High Integrity Metadata
    discovery_method TEXT DEFAULT 'id_link', -- 'id_link', 'fuzzy_resolve', 'manual'
    confidence_score NUMERIC DEFAULT 1.0,
    
    UNIQUE(provider, external_id),
    UNIQUE(canonical_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_mappings_resolution ON public.entity_mappings(provider, external_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- HELPERS
-- ═══════════════════════════════════════════════════════════════════════════

-- 5. Property Change Log (Audit Trail)
-- Tracks every change to a canonical entity's properties (Google standard).
CREATE TABLE IF NOT EXISTS public.canonical_property_log (
    id BIGSERIAL PRIMARY KEY,
    canonical_id TEXT NOT NULL,
    property_name TEXT NOT NULL, -- e.g. 'commence_time', 'venue_id'
    old_value TEXT,
    new_value TEXT,
    provider TEXT, -- Which provider triggered the change
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SNAP-IN MODULE (Add columns to existing tables)
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS canonical_id TEXT REFERENCES public.canonical_games(id);
ALTER TABLE public.live_game_state ADD COLUMN IF NOT EXISTS canonical_id TEXT REFERENCES public.canonical_games(id);

CREATE INDEX IF NOT EXISTS idx_matches_canonical ON public.matches(canonical_id);
CREATE INDEX IF NOT EXISTS idx_live_state_canonical ON public.live_game_state(canonical_id);

COMMENT ON TABLE public.canonical_property_log IS 'Tracks the lineage of property changes for a game to ensure data provenance.';