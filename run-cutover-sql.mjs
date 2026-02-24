const queries = [
    {
        step: "STEP 1 - NORMALIZE LEAGUES",
        sql: `
      UPDATE matches SET league_id = 'eng.1' WHERE league_id = 'epl';
      UPDATE matches SET league_id = 'esp.1' WHERE league_id = 'laliga';
      UPDATE matches SET league_id = 'ita.1' WHERE league_id = 'seriea';
      UPDATE matches SET league_id = 'ger.1' WHERE league_id = 'bundesliga';
      UPDATE matches SET league_id = 'fra.1' WHERE league_id = 'ligue1';
      UPDATE matches SET league_id = 'usa.1' WHERE league_id = 'mls';
      UPDATE matches SET league_id = 'uefa.europa' WHERE league_id = 'uel';
    `
    },
    {
        step: "STEP 1 - CHECK NORMALIZE",
        sql: `SELECT league_id, COUNT(*) FROM matches WHERE league_id IN ('epl','laliga','seriea','bundesliga','ligue1','mls','uel') AND start_time > now() GROUP BY league_id;`
    },
    {
        step: "STEP 2 - REPOINT CRON",
        sql: `
      CREATE OR REPLACE FUNCTION invoke_ingest_odds()
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      DECLARE
        v_url text;
        v_key text;
        v_secret text;
      BEGIN
        SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
        SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1;
        SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;

        IF v_url IS NULL OR v_key IS NULL THEN
          RAISE WARNING 'Missing vault secrets for invoke_ingest_odds';
          RETURN;
        END IF;

        PERFORM net.http_post(
          url := v_url || '/functions/v1/ingest-odds-v3',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_key,
            'Content-Type', 'application/json',
            'x-cron-secret', COALESCE(v_secret, '')
          ),
          body := '{"leagues": ["nba", "nhl", "mens-college-basketball", "nfl", "mlb", "college-football", "eng.1", "ita.1", "esp.1", "uefa.champions"]}'::jsonb
        );
      END;
      $$;
    `
    },
    {
        step: "STEP 2 - CHECK PROSRC",
        sql: `SELECT prosrc FROM pg_proc WHERE proname = 'invoke_ingest_odds';`
    },
    {
        step: "STEP 3 - UNSCHEDULE OLD CRON",
        sql: `SELECT cron.unschedule('live-odds-tracker-every-2-min');`
    },
    {
        step: "STEP 3 - CHECK OLD CRON",
        sql: `SELECT jobname FROM cron.job WHERE jobname = 'live-odds-tracker-every-2-min';`
    },
    {
        step: "STEP 4 - DISABLE EXHAUSTED LEAGUES",
        sql: `
      UPDATE league_config
      SET is_active = false
      WHERE odds_provider = 'THE_ODDS_API'
        AND bdl_sport_path IS NULL
        AND id NOT IN ('atp', 'wta');
    `
    },
    {
        step: "STEP 4 - CHECK LEAGUES",
        sql: `
      SELECT id, is_active, odds_provider FROM league_config
      WHERE odds_provider = 'THE_ODDS_API'
      ORDER BY id;
    `
    }
];

async function runQueries() {
    for (const q of queries) {
        console.log(`\n\x1b[36m=== ${q.step} ===\x1b[0m`);
        const resp = await fetch('https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sql-executor-temp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: q.sql })
        });

        const text = await resp.text();
        try {
            const data = JSON.parse(text);
            if (data.success) {
                if (data.result && data.result.length > 0) {
                    console.table(data.result);
                } else {
                    console.log("Success (0 rows or unaffected).");
                }
            } else {
                console.error("Error:", data.error);
            }
        } catch {
            console.log("Raw response:", text);
        }
    }
}

runQueries();
