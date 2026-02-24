async function check() {
    console.log("=== STEP 5 - TEST BDL INGESTION ===");
    const sql = `
    SELECT
      league_id,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE current_odds IS NOT NULL)::int AS has_odds,
      COUNT(*) FILTER (WHERE last_odds_update > now() - interval '5 minutes')::int AS fresh
    FROM matches
    WHERE start_time > now() AND start_time < now() + interval '3 days'
      AND league_id IN ('nba','nhl','mens-college-basketball')
    GROUP BY league_id;
  `;
    const resp = await fetch('https://qffzvrnbzabcokqqrwbv.supabase.co/functions/v1/sql-executor-temp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql })
    });
    const text = await resp.text();
    console.log(text);
}
check();
