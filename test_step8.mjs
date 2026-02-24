async function check() {
    console.log("=== STEP 8 - DATA FLOW VERIFICATION ===");
    const sql = `
    SELECT
      (SELECT COUNT(*) FROM matches WHERE start_time > now() AND start_time < now() + interval '3 days' AND league_id IN ('nba','nhl','mens-college-basketball','eng.1','esp.1','ita.1','uefa.champions') AND current_odds IS NOT NULL)::int AS has_odds,
      (SELECT COUNT(*) FROM raw_odds_log WHERE ts > now() - interval '15 minutes')::int AS raw_odds_log_new_rows,
      (SELECT COUNT(*) FROM market_feeds WHERE last_updated > now() - interval '15 minutes')::int AS market_feeds_new_rows,
      (
        SELECT ROUND(100.0 * SUM(matches_succeeded) / NULLIF(SUM(matches_processed), 0), 1)::varchar 
        FROM pregame_intel_log WHERE created_at > now() - interval '1 hour'
      ) AS pregame_intel_success_pct
    ;
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
