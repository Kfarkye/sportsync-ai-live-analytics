-- ═══════════════════════════════════════════════════════════════════════════
-- ENVIRONMENTAL KNOWLEDGE GRAPH (Venues & Human Entities)
-- Enables forensic calibration of referee bias and stadium physics.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Canonical Venues Registry
CREATE TABLE IF NOT EXISTS public.canonical_venues (
    id TEXT PRIMARY KEY, -- Slug-based: 'stadium_name_city'
    display_name TEXT NOT NULL,
    city TEXT,
    state_province TEXT,
    country TEXT,
    
    -- Institutional Metadata
    capacity INTEGER,
    is_indoor BOOLEAN DEFAULT FALSE,
    surface_type TEXT, -- 'grass', 'turf', 'hybrid', 'hardwood', 'ice'
    altitude_feet INTEGER,
    climate_zone TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Canonical Officials Registry
CREATE TABLE IF NOT EXISTS public.canonical_officials (
    id TEXT PRIMARY KEY, -- Slug-based: 'ref_name_league'
    display_name TEXT NOT NULL,
    league_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    
    -- Metadata (Historical provenance)
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Game Officials (Join Table)
-- Maps a crew of officials to a specific canonical game.
CREATE TABLE IF NOT EXISTS public.game_officials (
    id BIGSERIAL PRIMARY KEY,
    canonical_game_id TEXT REFERENCES public.canonical_games(id) ON DELETE CASCADE,
    official_id TEXT REFERENCES public.canonical_officials(id) ON DELETE CASCADE,
    position TEXT, -- 'Referee', 'Umpire', 'Linesman', 'VAR'
    
    UNIQUE(canonical_game_id, official_id)
);

-- 4. Venue Aliases (Resolution Bridge)
CREATE TABLE IF NOT EXISTS public.venue_aliases (
    id BIGSERIAL PRIMARY KEY,
    canonical_id TEXT REFERENCES public.canonical_venues(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    
    UNIQUE(alias)
);

-- 5. Official Aliases (Resolution Bridge)
CREATE TABLE IF NOT EXISTS public.official_aliases (
    id BIGSERIAL PRIMARY KEY,
    canonical_id TEXT REFERENCES public.canonical_officials(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    league_id TEXT NOT NULL,
    
    UNIQUE(alias, league_id)
);

-- Optimization: Indexes for quick resolution
CREATE INDEX IF NOT EXISTS idx_venue_alias_lookup ON public.venue_aliases(LOWER(alias));
CREATE INDEX IF NOT EXISTS idx_official_alias_lookup ON public.official_aliases(LOWER(alias), league_id);
CREATE INDEX IF NOT EXISTS idx_game_officials_lookup ON public.game_officials(canonical_game_id);

-- 6. Link Games to Venues
ALTER TABLE public.canonical_games ADD COLUMN IF NOT EXISTS canonical_venue_id TEXT REFERENCES public.canonical_venues(id);
CREATE INDEX IF NOT EXISTS idx_games_venue ON public.canonical_games(canonical_venue_id);

COMMENT ON TABLE public.canonical_venues IS 'High-fidelity stadium/arena data for physics engine calibration.';
COMMENT ON TABLE public.canonical_officials IS 'Master registry of league officials for bias and tendency analysis.';
