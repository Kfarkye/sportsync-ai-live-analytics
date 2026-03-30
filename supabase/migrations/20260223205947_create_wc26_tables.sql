
-- ═══════════════════════════════════════════════════════════════════════
-- WC26 pSEO Tables — Sprint 1 Migration
-- 3 tables: wc26_teams, wc26_fixtures, wc26_odds
-- RLS: anon SELECT, service_role ALL
-- ═══════════════════════════════════════════════════════════════════════

-- ── Enable moddatetime for updated_at triggers ────────────────────────
CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;

-- ═══ TABLE 1: wc26_teams ══════════════════════════════════════════════
CREATE TABLE public.wc26_teams (
  slug            TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  fifa_code       TEXT        NOT NULL CHECK (fifa_code ~ '^[A-Z]{3}$'),
  flag_uri        TEXT        NOT NULL,
  group_letter    CHAR(1)     NOT NULL CHECK (group_letter ~ '^[A-L]$'),
  pot             INT         NOT NULL CHECK (pot BETWEEN 1 AND 4),
  fifa_rank       INT                  CHECK (fifa_rank BETWEEN 1 AND 211),
  world_cup_titles INT        NOT NULL DEFAULT 0,
  confederation   TEXT        NOT NULL CHECK (confederation IN (
                    'AFC','CAF','CONCACAF','CONMEBOL','OFC','UEFA'
                  )),
  head_coach      TEXT,
  is_playoff_pending BOOLEAN  NOT NULL DEFAULT false,
  publish_state   TEXT        NOT NULL DEFAULT 'DRAFT'
                  CHECK (publish_state IN ('PUBLISHED','NOINDEX','DRAFT')),
  tactical_analysis TEXT,
  historical_json JSONB,
  roster_json     JSONB,
  seo_title       TEXT        CHECK (char_length(seo_title) <= 70),
  seo_description TEXT        CHECK (char_length(seo_description) <= 160),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.wc26_teams IS
  'World Cup 2026 team profiles for pSEO. 48 rows (42 confirmed + 6 playoff TBD). Source of truth for /teams/:slug/ pages.';

-- Auto-touch updated_at
CREATE TRIGGER wc26_teams_updated_at
  BEFORE UPDATE ON public.wc26_teams
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ═══ TABLE 2: wc26_fixtures ═══════════════════════════════════════════
CREATE TABLE public.wc26_fixtures (
  fixture_id      TEXT        PRIMARY KEY,
  match_number    INT         NOT NULL UNIQUE,
  home_slug       TEXT        NOT NULL REFERENCES public.wc26_teams(slug),
  away_slug       TEXT        NOT NULL REFERENCES public.wc26_teams(slug),
  stage           TEXT        NOT NULL CHECK (stage IN (
                    'group','r32','r16','qf','sf','third_place','final'
                  )),
  group_letter    CHAR(1)              CHECK (group_letter ~ '^[A-L]$'),
  venue           TEXT        NOT NULL,
  city            TEXT        NOT NULL,
  kickoff         TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.wc26_fixtures IS
  'World Cup 2026 match schedule. 104 rows (72 group + 32 knockout). Knockout fixtures use TBD placeholder slugs until bracket resolves.';

-- Ensure group fixtures always carry a group_letter
ALTER TABLE public.wc26_fixtures
  ADD CONSTRAINT fixtures_group_letter_required
  CHECK (stage != 'group' OR group_letter IS NOT NULL);

-- ═══ TABLE 3: wc26_odds ══════════════════════════════════════════════
CREATE TABLE public.wc26_odds (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_slug           TEXT        NOT NULL REFERENCES public.wc26_teams(slug),
  market              TEXT        NOT NULL,
  bookmaker           TEXT        NOT NULL,
  american_odds       INT         NOT NULL,
  decimal_odds        NUMERIC(8,4) NOT NULL CHECK (decimal_odds > 1),
  implied_probability NUMERIC(6,5) NOT NULL CHECK (implied_probability BETWEEN 0 AND 1),
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_slug, market, bookmaker)
);

COMMENT ON TABLE public.wc26_odds IS
  'Live odds snapshots for WC26 futures. Ingested via ingest-odds edge function. One row per team × market × bookmaker.';

-- ═══ INDEXES ══════════════════════════════════════════════════════════

-- Odds: fast lookup by team + market (covers the primary query pattern)
CREATE INDEX idx_wc26_odds_team_market
  ON public.wc26_odds (team_slug, market);

-- Fixtures: find all matches for a given team (home or away)
CREATE INDEX idx_wc26_fixtures_home
  ON public.wc26_fixtures (home_slug);

CREATE INDEX idx_wc26_fixtures_away
  ON public.wc26_fixtures (away_slug);

-- Teams: filter by group for group-view pages
CREATE INDEX idx_wc26_teams_group
  ON public.wc26_teams (group_letter);

-- Teams: filter by publish state for sitemap generation
CREATE INDEX idx_wc26_teams_publish_state
  ON public.wc26_teams (publish_state);

-- ═══ ROW LEVEL SECURITY ═══════════════════════════════════════════════

ALTER TABLE public.wc26_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wc26_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wc26_odds ENABLE ROW LEVEL SECURITY;

-- anon: read-only on all three
CREATE POLICY "wc26_teams_anon_select"
  ON public.wc26_teams FOR SELECT TO anon
  USING (true);

CREATE POLICY "wc26_fixtures_anon_select"
  ON public.wc26_fixtures FOR SELECT TO anon
  USING (true);

CREATE POLICY "wc26_odds_anon_select"
  ON public.wc26_odds FOR SELECT TO anon
  USING (true);

-- service_role: full access on all three
CREATE POLICY "wc26_teams_service_all"
  ON public.wc26_teams FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "wc26_fixtures_service_all"
  ON public.wc26_fixtures FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "wc26_odds_service_all"
  ON public.wc26_odds FOR ALL TO service_role
  USING (true) WITH CHECK (true);
;
