const { createClient } = require('@supabase/supabase-js');
const url = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN061xW0GzFROLzZ0bTVnc';
const supabase = createClient(url, key);

async function run() {
    console.log('--- STEP 1: LEAGUE NORMALIZATION ---');
    let res = await supabase.rpc('exec_sql', {
        query: `
    UPDATE matches SET league_id = 'eng.1' WHERE league_id = 'epl';
    UPDATE matches SET league_id = 'esp.1' WHERE league_id = 'laliga';
    UPDATE matches SET league_id = 'ita.1' WHERE league_id = 'seriea';
    UPDATE matches SET league_id = 'ger.1' WHERE league_id = 'bundesliga';
    UPDATE matches SET league_id = 'fra.1' WHERE league_id = 'ligue1';
    UPDATE matches SET league_id = 'usa.1' WHERE league_id = 'mls';
    UPDATE matches SET league_id = 'uefa.europa' WHERE league_id = 'uel';
  `});
    console.log('Update res:', res);
    let res2 = await supabase.from('matches').select('league_id', { count: 'exact', head: true }).in('league_id', ['epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'mls', 'uel']).gt('start_time', new Date().toISOString());
    console.log('Orphan leagues remaining:', res2.count);

    console.log('--- STEP 2: CRON REPOINT ---');
    let res3 = await supabase.rpc('exec_sql', {
        query: `
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
  `});
    console.log('Create function res:', res3);
    let res4 = await supabase.rpc('exec_sql', { query: `SELECT prosrc FROM pg_proc WHERE proname = 'invoke_ingest_odds';` });
    console.log('Function src:', res4.data ? res4.data[0].prosrc : 'none');

    console.log('--- STEP 3: KILL live-odds-tracker CRON ---');
    let res5 = await supabase.rpc('exec_sql', { query: `SELECT cron.unschedule('live-odds-tracker-every-2-min');` });
    console.log('Unschedule res:', res5);
    let res6 = await supabase.rpc('exec_sql', { query: `SELECT jobname FROM cron.job WHERE jobname = 'live-odds-tracker-every-2-min';` });
    console.log('Jobs remaining:', res6.data);

    console.log('--- STEP 4: DISABLE QUOTA-EXHAUSTED LEAGUES ---');
    let res7 = await supabase.rpc('exec_sql', {
        query: `
    UPDATE league_config
    SET is_active = false
    WHERE odds_provider = 'THE_ODDS_API'
      AND bdl_sport_path IS NULL
      AND id NOT IN ('atp', 'wta');
  `});
    console.log('Disable leagues res:', res7);
    let res8 = await supabase.rpc('exec_sql', {
        query: `
    SELECT id, is_active FROM league_config
    WHERE odds_provider = 'THE_ODDS_API'
    ORDER BY id;
  `});
    console.log('THE_ODDS_API leagues status:', res8.data);
}

run().catch(console.error);
