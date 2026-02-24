async function check() {
    const sql = `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_anon_key'`;
    const resp = await fetch('https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sql-executor-temp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql })
    });
    const text = await resp.text();
    console.log(text);
}
check();
