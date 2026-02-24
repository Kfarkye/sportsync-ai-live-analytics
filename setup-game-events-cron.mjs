// ================================================================
// setup-game-events-cron.mjs
// Sets up the pg_cron job for ingest-game-events
// CRITICAL: Uses 22-23,0-6 NOT 22-06 (wrapped ranges invalid in pg_cron)
// ================================================================

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
    console.log('\x1b[35m║  GAME EVENTS CRON — Setup & Verify        ║\x1b[0m');
    console.log('\x1b[35m╚════════════════════════════════════════════╝\x1b[0m');

    // Check pg_cron and pg_net are available
    await execSQL('CHECK — pg_cron + pg_net extensions', `
    SELECT extname FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net') ORDER BY extname;
  `);

    // Unschedule if already exists (idempotent)
    await execSQL('CLEANUP — Unschedule existing job if any', `
    SELECT cron.unschedule('ingest-game-events');
  `).catch(() => { console.log('No existing job to unschedule.'); });

    // Schedule the cron job
    // CRITICAL: * 22-23,0-6 * * * — NOT * 22-06 * * *
    // Covers 10pm-6am UTC → roughly 5pm-1am ET (standard) / 6pm-2am ET (daylight)
    await execSQL('SCHEDULE — Create ingest-game-events cron job', `
    SELECT cron.schedule(
      'ingest-game-events',
      '* 22-23,0-6 * * *',
      $$
      SELECT net.http_post(
        url := 'https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/ingest-game-events',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
        ),
        body := '{}'::jsonb
      );
      $$
    );
  `);

    // Verify the job was created
    await execSQL('VERIFY — Cron job exists', `
    SELECT jobid, schedule, command FROM cron.job WHERE jobname = 'ingest-game-events';
  `);

    console.log('\n\x1b[32m✅ Cron setup complete.\x1b[0m');
}

main().catch(err => {
    console.error('\x1b[31m❌ Fatal error:\x1b[0m', err);
    process.exit(1);
});
