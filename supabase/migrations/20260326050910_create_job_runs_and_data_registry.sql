
-- ==============================================
-- MIGRATION CONTROL PLANE: OPERATING SKELETON
-- ==============================================

-- 1. DATA REGISTRY: If a dataset is not in the registry, it is not real.
CREATE TABLE IF NOT EXISTS public.data_registry (
  object_name          TEXT PRIMARY KEY,
  physical_table       TEXT NOT NULL,
  owner_job            TEXT,
  source_system        TEXT NOT NULL DEFAULT 'supabase',
  destination_system   TEXT NOT NULL DEFAULT 'supabase',
  update_frequency     TEXT,
  primary_key          TEXT,
  description          TEXT,
  status               TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'migrating', 'migrated', 'deprecated', 'archived')),
  row_count_snapshot   BIGINT,
  last_validated_at    TIMESTAMPTZ,
  family               TEXT
    CHECK (family IN ('games', 'refs', 'teams', 'odds', 'intel', 'events', 'enrichment', 'props', 'injuries', 'recaps', 'config', 'control')),
  naming_tier          TEXT
    CHECK (naming_tier IN ('HUB', 'APP', 'SOURCE', 'JOB')),
  canonical_name       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.data_registry IS 
  'Canonical registry of all datasets. If a dataset is not in the registry, it is not real. Migration control plane foundation.';

-- 2. JOB_RUNS: Every job needs 3 states (scheduled, succeeded, failed)
CREATE TABLE IF NOT EXISTS public.job_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            TEXT NOT NULL,
  job_name          TEXT NOT NULL,
  target_object     TEXT,
  status            TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'running', 'succeeded', 'failed', 'replayed')),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  duration_ms       INTEGER GENERATED ALWAYS AS (
    CASE WHEN finished_at IS NOT NULL AND started_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (finished_at - started_at))::integer * 1000
         ELSE NULL
    END
  ) STORED,
  row_count         INTEGER,
  error_message     TEXT,
  trigger_type      TEXT DEFAULT 'scheduled'
    CHECK (trigger_type IN ('scheduled', 'watchdog', 'replay', 'manual')),
  parent_run_id     UUID REFERENCES public.job_runs(id),
  metadata          JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_runs_job_id_status ON public.job_runs(job_id, status);
CREATE INDEX idx_job_runs_started_at ON public.job_runs(started_at DESC);
CREATE INDEX idx_job_runs_target_object ON public.job_runs(target_object);

COMMENT ON TABLE public.job_runs IS 
  'Structured job execution tracking. Every cron/Cloud Function run logs here. Supports watchdog/replay with parent_run_id chain.';

-- 3. JOB_ALERTS: One error log sink
CREATE TABLE IF NOT EXISTS public.job_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_run_id        UUID REFERENCES public.job_runs(id),
  job_name          TEXT NOT NULL,
  alert_type        TEXT NOT NULL DEFAULT 'failure'
    CHECK (alert_type IN ('failure', 'freshness_sla_miss', 'row_count_anomaly', 'replay_triggered', 'replay_failed')),
  severity          TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'critical')),
  message           TEXT NOT NULL,
  acknowledged      BOOLEAN DEFAULT false,
  acknowledged_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_alerts_severity ON public.job_alerts(severity, acknowledged);

COMMENT ON TABLE public.job_alerts IS 
  'Centralized alert log for job failures, SLA misses, and replay events.';

-- 4. FRESHNESS TRACKING VIEW
CREATE OR REPLACE VIEW public.v_job_freshness AS
SELECT 
  jr.job_name,
  jr.target_object,
  jr.status,
  jr.started_at,
  jr.finished_at,
  jr.row_count,
  jr.error_message,
  jr.trigger_type,
  EXTRACT(EPOCH FROM (now() - jr.finished_at))::integer AS seconds_since_last_success,
  ROW_NUMBER() OVER (PARTITION BY jr.job_name ORDER BY jr.started_at DESC) AS run_rank
FROM public.job_runs jr
WHERE jr.status IN ('succeeded', 'failed')
ORDER BY jr.started_at DESC;

COMMENT ON VIEW public.v_job_freshness IS 
  'Freshness dashboard: shows the most recent run per job with time-since-success.';

-- 5. SEED THE DATA REGISTRY with current Supabase tables
INSERT INTO public.data_registry (object_name, physical_table, source_system, primary_key, family, naming_tier, canonical_name, description, row_count_snapshot) VALUES
  ('canonical_games', 'public.canonical_games', 'supabase', 'id', 'games', 'HUB', 'HUB_GAMES_CANONICAL', 'Game identity resolution: canonical game IDs across providers', 15197),
  ('matches', 'public.matches', 'supabase', 'id', 'games', 'HUB', 'HUB_GAMES_CURRENT', 'Primary game table with odds, scores, status', 16056),
  ('live_game_state', 'public.live_game_state', 'supabase', 'id', 'games', 'HUB', 'HUB_GAMES_LIVE', 'Real-time game state for live games', 1994),
  ('teams', 'public.teams', 'supabase', 'id', 'teams', 'HUB', 'HUB_TEAMS', 'Team master data: names, logos, conferences', 1233),
  ('official_tendencies', 'public.official_tendencies', 'supabase', 'id', 'refs', 'APP', 'APP_REF_TENDENCIES_CURRENT', 'Referee tendency profiles per season', 446),
  ('pregame_intel', 'public.pregame_intel', 'supabase', 'intel_id', 'intel', 'APP', 'APP_PREGAME_INTEL', 'AI-generated pregame intelligence cards', 3167),
  ('game_recaps', 'public.game_recaps', 'supabase', 'match_id', 'recaps', 'APP', 'APP_GAME_RECAPS', 'Post-game narrative recaps', 557),
  ('injury_snapshots', 'public.injury_snapshots', 'supabase', 'id', 'injuries', 'APP', 'APP_INJURIES_CURRENT', 'Daily injury snapshots from ESPN', 2300),
  ('espn_enrichment', 'public.espn_enrichment', 'supabase', 'id', 'enrichment', 'SOURCE', 'SOURCE_ESPN_ENRICHMENT', 'Raw ESPN summary/predictor/odds data per game', 8973),
  ('espn_athletes', 'public.espn_athletes', 'supabase', 'id', 'enrichment', 'SOURCE', 'SOURCE_ESPN_ATHLETES', 'Player profiles, stats, injury status from ESPN', 16788),
  ('espn_game_logs', 'public.espn_game_logs', 'supabase', 'id', 'enrichment', 'SOURCE', 'SOURCE_ESPN_GAME_LOGS', 'Per-player game logs from ESPN', 33106),
  ('espn_team_season_stats', 'public.espn_team_season_stats', 'supabase', 'id', 'enrichment', 'SOURCE', 'SOURCE_ESPN_TEAM_STATS', 'Team season stats from ESPN', 736),
  ('market_feeds', 'public.market_feeds', 'supabase', 'id', 'odds', 'SOURCE', 'SOURCE_ODDS_MARKET_FEEDS', 'The Odds API market data', 4485),
  ('poly_odds', 'public.poly_odds', 'supabase', 'id', 'odds', 'SOURCE', 'SOURCE_POLY_ODDS', 'Polymarket game-level moneylines', 9804),
  ('player_prop_bets', 'public.player_prop_bets', 'supabase', 'id', 'props', 'APP', 'APP_PLAYER_PROPS', 'Player prop bets with analysis', 136081),
  ('game_events', 'public.game_events', 'supabase', 'id', 'events', 'SOURCE', 'SOURCE_GAME_EVENTS', 'Play-by-play event log across all sports', 3848026),
  ('job_runs', 'public.job_runs', 'supabase', 'id', 'control', 'JOB', 'JOB_RUNS', 'Job execution tracking for control plane', 0),
  ('job_alerts', 'public.job_alerts', 'supabase', 'id', 'control', 'JOB', 'JOB_ALERTS', 'Centralized alert log for job failures', 0),
  ('data_registry', 'public.data_registry', 'supabase', 'object_name', 'control', 'JOB', 'JOB_DATA_REGISTRY', 'This table. Canonical dataset registry.', 0)
ON CONFLICT (object_name) DO NOTHING;

-- 6. HELPER: Log a job run (called by cron wrappers)
CREATE OR REPLACE FUNCTION public.log_job_start(
  p_job_id TEXT,
  p_job_name TEXT,
  p_target_object TEXT DEFAULT NULL,
  p_trigger_type TEXT DEFAULT 'scheduled'
) RETURNS UUID AS $$
DECLARE
  v_run_id UUID;
BEGIN
  INSERT INTO public.job_runs (job_id, job_name, target_object, status, started_at, trigger_type)
  VALUES (p_job_id, p_job_name, p_target_object, 'running', now(), p_trigger_type)
  RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.log_job_end(
  p_run_id UUID,
  p_status TEXT DEFAULT 'succeeded',
  p_row_count INTEGER DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  UPDATE public.job_runs
  SET status = p_status,
      finished_at = now(),
      row_count = p_row_count,
      error_message = p_error_message
  WHERE id = p_run_id;
  
  -- Auto-alert on failure
  IF p_status = 'failed' THEN
    INSERT INTO public.job_alerts (job_run_id, job_name, alert_type, severity, message)
    SELECT p_run_id, jr.job_name, 'failure', 'critical', COALESCE(p_error_message, 'Job failed with no error message')
    FROM public.job_runs jr WHERE jr.id = p_run_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. WATCHDOG: Check freshness SLA and trigger alerts
CREATE OR REPLACE FUNCTION public.watchdog_check_freshness(
  p_job_name TEXT,
  p_max_age_minutes INTEGER DEFAULT 7
) RETURNS BOOLEAN AS $$
DECLARE
  v_last_success TIMESTAMPTZ;
  v_is_fresh BOOLEAN;
BEGIN
  SELECT MAX(finished_at) INTO v_last_success
  FROM public.job_runs
  WHERE job_name = p_job_name AND status = 'succeeded';
  
  v_is_fresh := v_last_success IS NOT NULL 
    AND v_last_success >= (now() - (p_max_age_minutes || ' minutes')::interval);
  
  IF NOT v_is_fresh THEN
    INSERT INTO public.job_alerts (job_name, alert_type, severity, message)
    VALUES (p_job_name, 'freshness_sla_miss', 'warning',
      format('No successful run in the last %s minutes. Last success: %s', 
        p_max_age_minutes, COALESCE(v_last_success::text, 'NEVER')));
  END IF;
  
  RETURN v_is_fresh;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS on new tables
ALTER TABLE public.data_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_alerts ENABLE ROW LEVEL SECURITY;
;
