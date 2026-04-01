-- 20260112000008_schema_hardening.sql
-- Schema hardening: Assert public.matches.status exists, create stable identity mapping

-- ============================================================================
-- PART 1: Explicitly ensure public.matches.status exists
-- ============================================================================
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS status TEXT;

-- Index for kill threshold queries (qualified to public schema)
CREATE INDEX IF NOT EXISTS idx_matches_league_status ON public.matches (league_id, status);

-- ============================================================================
-- PART 2: Invariant assertion - fail fast if schema is broken
-- ============================================================================
DO $$
DECLARE
  has_col boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'matches'
      AND a.attname = 'status'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) INTO has_col;

  IF NOT has_col THEN
    RAISE EXCEPTION 'Invariant failed: public.matches.status does not exist after migration';
  END IF;
  
  RAISE NOTICE 'Invariant passed: public.matches.status exists';
END $$;

-- ============================================================================
-- PART 3: Stable external ID mapping (fixes IDENTITY_GAP permanently)
-- ============================================================================

-- Note: matches.id is TEXT not UUID in this schema
CREATE TABLE IF NOT EXISTS public.match_external_ids (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  match_id TEXT NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_match_external_ids_match_id ON public.match_external_ids (match_id);

-- ============================================================================
-- PART 4: Unmatched events table (for tracking IDENTITY_GAP without log spam)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.unmatched_external_events (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  league TEXT NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (provider, external_id)
);

SELECT 'Schema hardening complete: status column verified, identity mapping tables created' as status;
