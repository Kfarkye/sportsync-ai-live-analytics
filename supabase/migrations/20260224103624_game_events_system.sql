-- ============================================================
-- MIGRATION: game_events_system v2
-- Purpose: Append-only play-by-play log + AI recap surface + alert signals
-- Order: game_recaps → game_events → game_alerts (dependency chain)
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. COMPANION: game_recaps (must exist FIRST — referenced by game_events RLS)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_recaps (
  match_id        text PRIMARY KEY,
  league_id       text        NOT NULL,
  sport           text        NOT NULL,
  home_team       text        NOT NULL,
  away_team       text        NOT NULL,
  game_date       date        NOT NULL,
  slug            text UNIQUE NOT NULL,    -- format: celtics-vs-lakers-2026-02-24-401584722
  recap_json      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  seo_title       text,
  seo_description text,
  structured_data jsonb,                   -- Schema.org SportsEvent JSON-LD blob
  answer_block    text,                    -- extractable 1-3 sentence lede for AI citation
  status          text DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'LIVE', 'HALFTIME', 'FINAL')),
  events_count    int  DEFAULT 0,
  last_narrated   timestamptz,
  narration_count int  DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gr_date   ON game_recaps (game_date, league_id);
CREATE INDEX IF NOT EXISTS idx_gr_slug   ON game_recaps (slug);
CREATE INDEX IF NOT EXISTS idx_gr_status ON game_recaps (status) WHERE status IN ('LIVE', 'HALFTIME');

ALTER TABLE game_recaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all" ON game_recaps
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "public_read" ON game_recaps
  FOR SELECT TO anon USING (true);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_game_recaps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_game_recaps_updated_at ON game_recaps;
CREATE TRIGGER trg_game_recaps_updated_at
  BEFORE UPDATE ON game_recaps
  FOR EACH ROW EXECUTE FUNCTION update_game_recaps_updated_at();


-- ──────────────────────────────────────────────────────────────
-- 2. CORE TABLE: game_events (append-only event log)
--    RLS references game_recaps — which now exists above
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id      text        NOT NULL,
  league_id     text        NOT NULL,
  sport         text        NOT NULL,
  event_type    text        NOT NULL,    -- play | odds_change | period_end | timeout | challenge | injury
  sequence      int         NOT NULL,
  period        int,
  clock         text,
  home_score    int         NOT NULL DEFAULT 0,
  away_score    int         NOT NULL DEFAULT 0,
  play_data     jsonb,                   -- sport-specific: play text, player, type, points, assists
  odds_snapshot jsonb,                   -- { spread, total, moneyline } at moment of event
  box_snapshot  jsonb,                   -- full box score, sampled every 5th poll cycle + period ends
  source        text        DEFAULT 'espn',
  created_at    timestamptz DEFAULT now() NOT NULL
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_ge_match  ON game_events (match_id, sequence);
CREATE INDEX IF NOT EXISTS idx_ge_league ON game_events (league_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ge_type   ON game_events (event_type);

-- Idempotent dedup: same match + type + sequence = skip on re-ingest
CREATE UNIQUE INDEX IF NOT EXISTS idx_ge_dedup
  ON game_events (match_id, event_type, sequence);

-- RLS
ALTER TABLE game_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_insert" ON game_events
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "service_select" ON game_events
  FOR SELECT TO service_role USING (true);

-- This policy references game_recaps (which was created above)
CREATE POLICY "public_read_final" ON game_events
  FOR SELECT TO anon USING (
    match_id IN (SELECT match_id FROM game_recaps WHERE status = 'FINAL')
  );


-- ──────────────────────────────────────────────────────────────
-- 3. COMPANION: game_alerts (real-time betting signals)
--    FK references game_events(id) — which now exists above
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_alerts (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id         text        NOT NULL,
  league_id        text        NOT NULL,
  alert_type       text        NOT NULL,   -- MOMENTUM_RUN | SHARP_MONEY | STAR_ERUPTION | FOUL_TROUBLE | KEY_NUMBER_CROSS | TOTAL_DIVERGENCE | COMEBACK_ALERT
  severity         text        DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  headline         text        NOT NULL,
  detail           text,
  trigger_event_id bigint REFERENCES game_events(id),
  context_window   jsonb,                  -- surrounding events for context
  odds_before      jsonb,
  odds_after       jsonb,
  edge_estimate    numeric,
  delivered_at     timestamptz,
  channels         text[],                 -- {'realtime', 'webhook', 'push'}
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ga_match ON game_alerts (match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ga_type  ON game_alerts (alert_type, severity);

ALTER TABLE game_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all" ON game_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "public_read" ON game_alerts
  FOR SELECT TO anon USING (true);


-- ──────────────────────────────────────────────────────────────
-- 4. FINALIZATION TRIGGER: auto-flip game_recaps when matches → FINAL
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_game_recap_final()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'STATUS_FINAL' AND (OLD.status IS NULL OR OLD.status != 'STATUS_FINAL') THEN
    UPDATE game_recaps
    SET status = 'FINAL', updated_at = now()
    WHERE match_id = NEW.id AND status != 'FINAL';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_recap_final ON matches;
CREATE TRIGGER trg_sync_recap_final
  AFTER UPDATE OF status ON matches
  FOR EACH ROW EXECUTE FUNCTION sync_game_recap_final();
