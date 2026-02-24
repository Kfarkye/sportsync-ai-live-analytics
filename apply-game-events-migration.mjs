// ================================================================
// apply-game-events-migration.mjs
// Executes the game_events_system migration via sql-executor-temp
// Then runs all verification queries from STEP 2
// ================================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SQL_EXECUTOR_URL = 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sql-executor-temp';

async function execSQL(label, sql) {
    console.log(`\n\x1b[36m=== ${label} ===\x1b[0m`);
    try {
        const resp = await fetch(SQL_EXECUTOR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql }),
        });
        const text = await resp.text();
        try {
            const data = JSON.parse(text);
            if (data.success) {
                if (data.result && data.result.length > 0) {
                    console.table(data.result);
                } else {
                    console.log('✅ Success (0 rows returned).');
                }
                return data;
            } else {
                console.error('❌ Error:', data.error);
                return data;
            }
        } catch {
            console.log('Raw response:', text.substring(0, 500));
            return { success: false, error: text };
        }
    } catch (err) {
        console.error('❌ Fetch error:', err.message);
        return { success: false, error: err.message };
    }
}

async function main() {
    console.log('\x1b[35m╔════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[35m║  GAME EVENTS SYSTEM — Migration & Verify  ║\x1b[0m');
    console.log('\x1b[35m╚════════════════════════════════════════════╝\x1b[0m');

    // ── STEP 1: Apply migration ──
    const migrationPath = join(__dirname, 'supabase', 'migrations', '20260224103624_game_events_system.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Split migration into logical blocks to avoid single-statement issues
    // Block 1: game_recaps table + indexes + RLS + trigger
    await execSQL('STEP 1a — CREATE game_recaps', `
    CREATE TABLE IF NOT EXISTS game_recaps (
      match_id        text PRIMARY KEY,
      league_id       text        NOT NULL,
      sport           text        NOT NULL,
      home_team       text        NOT NULL,
      away_team       text        NOT NULL,
      game_date       date        NOT NULL,
      slug            text UNIQUE NOT NULL,
      recap_json      jsonb       NOT NULL DEFAULT '{}'::jsonb,
      seo_title       text,
      seo_description text,
      structured_data jsonb,
      answer_block    text,
      status          text DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'LIVE', 'HALFTIME', 'FINAL')),
      events_count    int  DEFAULT 0,
      last_narrated   timestamptz,
      narration_count int  DEFAULT 0,
      created_at      timestamptz DEFAULT now(),
      updated_at      timestamptz DEFAULT now()
    );
  `);

    await execSQL('STEP 1b — game_recaps indexes', `
    CREATE INDEX IF NOT EXISTS idx_gr_date   ON game_recaps (game_date, league_id);
    CREATE INDEX IF NOT EXISTS idx_gr_slug   ON game_recaps (slug);
    CREATE INDEX IF NOT EXISTS idx_gr_status ON game_recaps (status) WHERE status IN ('LIVE', 'HALFTIME');
  `);

    await execSQL('STEP 1c — game_recaps RLS', `
    ALTER TABLE game_recaps ENABLE ROW LEVEL SECURITY;
  `);

    await execSQL('STEP 1d — game_recaps RLS policies', `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'game_recaps' AND policyname = 'service_all') THEN
        CREATE POLICY "service_all" ON game_recaps FOR ALL TO service_role USING (true) WITH CHECK (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'game_recaps' AND policyname = 'public_read') THEN
        CREATE POLICY "public_read" ON game_recaps FOR SELECT TO anon USING (true);
      END IF;
    END $$;
  `);

    await execSQL('STEP 1e — game_recaps updated_at trigger', `
    CREATE OR REPLACE FUNCTION update_game_recaps_updated_at()
    RETURNS TRIGGER AS $t$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $t$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_game_recaps_updated_at ON game_recaps;
    CREATE TRIGGER trg_game_recaps_updated_at
      BEFORE UPDATE ON game_recaps
      FOR EACH ROW EXECUTE FUNCTION update_game_recaps_updated_at();
  `);

    // Block 2: game_events table + indexes + RLS
    await execSQL('STEP 1f — CREATE game_events', `
    CREATE TABLE IF NOT EXISTS game_events (
      id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      match_id      text        NOT NULL,
      league_id     text        NOT NULL,
      sport         text        NOT NULL,
      event_type    text        NOT NULL,
      sequence      int         NOT NULL,
      period        int,
      clock         text,
      home_score    int         NOT NULL DEFAULT 0,
      away_score    int         NOT NULL DEFAULT 0,
      play_data     jsonb,
      odds_snapshot jsonb,
      box_snapshot  jsonb,
      source        text        DEFAULT 'espn',
      created_at    timestamptz DEFAULT now() NOT NULL
    );
  `);

    await execSQL('STEP 1g — game_events indexes', `
    CREATE INDEX IF NOT EXISTS idx_ge_match  ON game_events (match_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_ge_league ON game_events (league_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ge_type   ON game_events (event_type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ge_dedup ON game_events (match_id, event_type, sequence);
  `);

    await execSQL('STEP 1h — game_events RLS', `
    ALTER TABLE game_events ENABLE ROW LEVEL SECURITY;
  `);

    await execSQL('STEP 1i — game_events RLS policies', `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'game_events' AND policyname = 'service_insert') THEN
        CREATE POLICY "service_insert" ON game_events FOR INSERT TO service_role WITH CHECK (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'game_events' AND policyname = 'service_select') THEN
        CREATE POLICY "service_select" ON game_events FOR SELECT TO service_role USING (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'game_events' AND policyname = 'public_read_final') THEN
        CREATE POLICY "public_read_final" ON game_events FOR SELECT TO anon USING (
          match_id IN (SELECT match_id FROM game_recaps WHERE status = 'FINAL')
        );
      END IF;
    END $$;
  `);

    // Block 3: game_alerts table + indexes + RLS
    await execSQL('STEP 1j — CREATE game_alerts', `
    CREATE TABLE IF NOT EXISTS game_alerts (
      id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      match_id         text        NOT NULL,
      league_id        text        NOT NULL,
      alert_type       text        NOT NULL,
      severity         text        DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      headline         text        NOT NULL,
      detail           text,
      trigger_event_id bigint REFERENCES game_events(id),
      context_window   jsonb,
      odds_before      jsonb,
      odds_after       jsonb,
      edge_estimate    numeric,
      delivered_at     timestamptz,
      channels         text[],
      created_at       timestamptz DEFAULT now()
    );
  `);

    await execSQL('STEP 1k — game_alerts indexes', `
    CREATE INDEX IF NOT EXISTS idx_ga_match ON game_alerts (match_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ga_type  ON game_alerts (alert_type, severity);
  `);

    await execSQL('STEP 1l — game_alerts RLS', `
    ALTER TABLE game_alerts ENABLE ROW LEVEL SECURITY;
  `);

    await execSQL('STEP 1m — game_alerts RLS policies', `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'game_alerts' AND policyname = 'service_all') THEN
        CREATE POLICY "service_all" ON game_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'game_alerts' AND policyname = 'public_read') THEN
        CREATE POLICY "public_read" ON game_alerts FOR SELECT TO anon USING (true);
      END IF;
    END $$;
  `);

    // Block 4: Finalization trigger
    await execSQL('STEP 1n — Finalization trigger', `
    CREATE OR REPLACE FUNCTION sync_game_recap_final()
    RETURNS TRIGGER AS $t$
    BEGIN
      IF NEW.status = 'STATUS_FINAL' AND (OLD.status IS NULL OR OLD.status != 'STATUS_FINAL') THEN
        UPDATE game_recaps
        SET status = 'FINAL', updated_at = now()
        WHERE match_id = NEW.id AND status != 'FINAL';
      END IF;
      RETURN NEW;
    END;
    $t$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_recap_final ON matches;
    CREATE TRIGGER trg_sync_recap_final
      AFTER UPDATE OF status ON matches
      FOR EACH ROW EXECUTE FUNCTION sync_game_recap_final();
  `);

    // ── STEP 2: Verification Queries ──
    console.log('\n\x1b[33m╔════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[33m║          VERIFICATION QUERIES              ║\x1b[0m');
    console.log('\x1b[33m╚════════════════════════════════════════════╝\x1b[0m');

    await execSQL('VERIFY 1 — All three tables exist', `
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('game_events', 'game_recaps', 'game_alerts')
    ORDER BY table_name;
  `);

    await execSQL('VERIFY 2 — RLS enabled on all three', `
    SELECT tablename, rowsecurity FROM pg_tables
    WHERE tablename IN ('game_events', 'game_recaps', 'game_alerts');
  `);

    await execSQL('VERIFY 3 — Indexes exist', `
    SELECT indexname FROM pg_indexes
    WHERE tablename IN ('game_events', 'game_recaps', 'game_alerts')
    ORDER BY indexname;
  `);

    // VERIFY 4 — Dedup constraint
    await execSQL('VERIFY 4a — Insert test recap', `
    INSERT INTO game_recaps (match_id, league_id, sport, home_team, away_team, game_date, slug)
    VALUES ('TEST_DEDUP', 'nba', 'basketball', 'Team A', 'Team B', '2026-01-01', 'test-dedup-slug');
  `);

    await execSQL('VERIFY 4b — Insert test event', `
    INSERT INTO game_events (match_id, league_id, sport, event_type, sequence, home_score, away_score)
    VALUES ('TEST_DEDUP', 'nba', 'basketball', 'play', 1, 0, 0);
  `);

    await execSQL('VERIFY 4c — Duplicate insert (ON CONFLICT DO NOTHING)', `
    INSERT INTO game_events (match_id, league_id, sport, event_type, sequence, home_score, away_score)
    VALUES ('TEST_DEDUP', 'nba', 'basketball', 'play', 1, 2, 0)
    ON CONFLICT (match_id, event_type, sequence) DO NOTHING;
  `);

    await execSQL('VERIFY 4d — Count should be 1', `
    SELECT COUNT(*) as event_count FROM game_events WHERE match_id = 'TEST_DEDUP';
  `);

    await execSQL('VERIFY 5 — Finalization trigger exists', `
    SELECT tgname FROM pg_trigger WHERE tgname = 'trg_sync_recap_final';
  `);

    // Clean up test data
    await execSQL('CLEANUP — Remove test data', `
    DELETE FROM game_events WHERE match_id = 'TEST_DEDUP';
    DELETE FROM game_recaps WHERE match_id = 'TEST_DEDUP';
  `);

    console.log('\n\x1b[32m✅ Migration & verification complete.\x1b[0m');
}

main().catch(err => {
    console.error('\x1b[31m❌ Fatal error:\x1b[0m', err);
    process.exit(1);
});
