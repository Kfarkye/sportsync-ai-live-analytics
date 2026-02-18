-- ═══════════════════════════════════════════════════════════════════════════
-- CREATE MISSING TABLES
-- Audit finding: 5 tables referenced in src/services/dbService.ts
-- but never defined in any migration
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. daily_thesis — Cron-generated daily angle / thesis
--    Used by: dbService.getDailyAngle()
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_thesis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  match_id TEXT,
  headline TEXT,
  content JSONB NOT NULL DEFAULT '{}'::JSONB,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT daily_thesis_date_unique UNIQUE (date)
);

CREATE INDEX IF NOT EXISTS idx_daily_thesis_date ON public.daily_thesis(date);

ALTER TABLE public.daily_thesis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read daily_thesis" ON public.daily_thesis
  FOR SELECT USING (true);
CREATE POLICY "Service write daily_thesis" ON public.daily_thesis
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 2. team_metrics — Team pace, offensive/defensive ratings
--    Used by: dbService.getTeamMetrics()
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name TEXT NOT NULL,
  rank INTEGER,
  pace NUMERIC,
  defensive_rating NUMERIC,
  offensive_rating NUMERIC,
  net_rating NUMERIC,
  turnover_pct NUMERIC,
  games_played INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT team_metrics_name_unique UNIQUE (team_name)
);

CREATE INDEX IF NOT EXISTS idx_team_metrics_name ON public.team_metrics(team_name);

ALTER TABLE public.team_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read team_metrics" ON public.team_metrics
  FOR SELECT USING (true);
CREATE POLICY "Service write team_metrics" ON public.team_metrics
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 3. ai_signal_snapshots — Write-once AI signal archive
--    Used by: dbService.storeAISignalSnapshot()
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_signal_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  signals JSONB NOT NULL DEFAULT '{}'::JSONB,
  system_state JSONB,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_signal_snapshots_match ON public.ai_signal_snapshots(match_id);
CREATE INDEX IF NOT EXISTS idx_ai_signal_snapshots_fetched ON public.ai_signal_snapshots(fetched_at DESC);

ALTER TABLE public.ai_signal_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ai_signal_snapshots" ON public.ai_signal_snapshots
  FOR SELECT USING (true);
CREATE POLICY "Service write ai_signal_snapshots" ON public.ai_signal_snapshots
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 4. news_intel — Legacy team news cache
--    Used by: dbService.getTeamNews(), dbService.cacheTeamNews()
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.news_intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL,
  home_team TEXT,
  away_team TEXT,
  content JSONB NOT NULL DEFAULT '{}'::JSONB,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT news_intel_cache_key_unique UNIQUE (cache_key)
);

CREATE INDEX IF NOT EXISTS idx_news_intel_cache_key ON public.news_intel(cache_key);

ALTER TABLE public.news_intel ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read news_intel" ON public.news_intel
  FOR SELECT USING (true);
CREATE POLICY "Service write news_intel" ON public.news_intel
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ───────────────────────────────────────────────────────────────────────────
-- 5. deep_intel — Cached deep intel / JSON-mode analysis
--    Used by: dbService.getCachedIntel(), dbService.cacheIntel()
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deep_intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::JSONB,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT deep_intel_match_unique UNIQUE (match_id)
);

CREATE INDEX IF NOT EXISTS idx_deep_intel_match ON public.deep_intel(match_id);

ALTER TABLE public.deep_intel ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read deep_intel" ON public.deep_intel
  FOR SELECT USING (true);
CREATE POLICY "Service write deep_intel" ON public.deep_intel
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
