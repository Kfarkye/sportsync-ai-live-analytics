declare const Deno: any;

/**
 * REFRESH SOCCER TEAM TOTAL TRENDS
 *
 * Purpose: Refresh soccer team+venue UNDER trend materialized views used by the trends page.
 * Called by: soccer-postgame-drain (event-driven), cron fallback, manual.
 *
 * Zone: OPS (SRE+Amazon) + DATA/ID (Amazon+Google).
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const startMs = Date.now();
  const runId = `refresh_soccer_team_total_trends_${startMs}`;
  const trace: string[] = [];

  try {
    trace.push(`[boot] refresh-soccer-team-total-trends @ ${new Date().toISOString()}`);

    const { count: sourceCount, error: sourceErr } = await supabase
      .from("soccer_bet365_team_odds")
      .select("id", { count: "exact", head: true })
      .not("b365_ou_handicap", "is", null)
      .not("total_goals", "is", null);

    if (sourceErr) {
      trace.push(`[warn] source pre-check failed: ${sourceErr.message}`);
    } else {
      trace.push(`[pre-check] source rows=${sourceCount ?? 0}`);
      if ((sourceCount ?? 0) === 0) {
        return new Response(JSON.stringify({
          status: "SKIPPED",
          reason: "no_source_rows",
          source_rows: 0,
          duration_ms: Date.now() - startMs,
          trace,
        }), { headers: CORS_HEADERS });
      }
    }

    trace.push("[refresh] calling refresh_soccer_team_total_trend_views()");
    const { data: refreshResult, error: rpcErr } = await supabase.rpc("refresh_soccer_team_total_trend_views");
    if (rpcErr) {
      trace.push(`[error] refresh RPC failed: ${rpcErr.message}`);
      throw rpcErr;
    }

    const [gamesCountResult, trendsCountResult] = await Promise.all([
      supabase
        .from("mv_soccer_team_total_venue_games")
        .select("match_id", { count: "exact", head: true }),
      supabase
        .from("mv_soccer_team_total_venue_trends")
        .select("team_name", { count: "exact", head: true }),
    ]);

    const gamesRows = gamesCountResult.count ?? 0;
    const trendsRows = trendsCountResult.count ?? 0;
    trace.push(`[post-check] mv_soccer_team_total_venue_games=${gamesRows}`);
    trace.push(`[post-check] mv_soccer_team_total_venue_trends=${trendsRows}`);

    try {
      const { error: logErr } = await supabase.from("job_runs").insert({
        job_id: runId,
        job_name: "refresh_soccer_team_total_trends",
        target_object: "mv_soccer_team_total_venue_trends",
        trigger_type: "manual",
        status: "succeeded",
        started_at: new Date(startMs).toISOString(),
        finished_at: new Date().toISOString(),
        row_count: gamesRows + trendsRows,
        rows_written: gamesRows + trendsRows,
        metadata: {
          source_rows: sourceCount ?? null,
          refresh_result: refreshResult ?? null,
          trace,
        },
      });
      if (logErr) throw logErr;
    } catch (logErr: any) {
      trace.push(`[warn] job_runs logging failed (non-fatal): ${logErr?.message ?? "unknown error"}`);
    }

    return new Response(JSON.stringify({
      status: "REFRESHED",
      source_rows: sourceCount ?? null,
      mv_soccer_team_total_venue_games: gamesRows,
      mv_soccer_team_total_venue_trends: trendsRows,
      refresh_result: refreshResult ?? null,
      duration_ms: Date.now() - startMs,
      trace,
    }), { headers: CORS_HEADERS });
  } catch (err: any) {
    trace.push(`[fatal] ${err?.message ?? "unknown error"}`);
    console.error("[refresh-soccer-team-total-trends] Fatal:", err);

    try {
      const { error: logErr } = await supabase.from("job_runs").insert({
        job_id: runId,
        job_name: "refresh_soccer_team_total_trends",
        target_object: "mv_soccer_team_total_venue_trends",
        trigger_type: "manual",
        status: "failed",
        started_at: new Date(startMs).toISOString(),
        finished_at: new Date().toISOString(),
        error_message: err?.message ?? "unknown error",
        metadata: { trace },
      });
      if (logErr) throw logErr;
    } catch {
      // best effort
    }

    return new Response(JSON.stringify({
      status: "ERROR",
      error: err?.message ?? "unknown error",
      duration_ms: Date.now() - startMs,
      trace,
    }), { status: 500, headers: CORS_HEADERS });
  }
});
