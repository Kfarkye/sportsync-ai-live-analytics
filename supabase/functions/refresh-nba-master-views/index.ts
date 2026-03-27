declare const Deno: any;

/**
 * REFRESH NBA MASTER VIEWS
 *
 * Purpose: Concurrently refresh the canonical NBA materialized views:
 *   - mv_nba_game_master (one row per game, normalized opening/live/closing markets)
 *   - mv_nba_team_game_master (two rows per game, team perspective)
 *
 * Called by: finalize-games-cron (step 4c) | Firebase Cloud Function refreshMasterViews() | manual.
 *
 * Zone: OPS (SRE+Amazon) — materialized view refresh orchestration.
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
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const startMs = Date.now();
    const trace: string[] = [];

    try {
        trace.push(`[boot] refresh-nba-master-views @ ${new Date().toISOString()}`);

        // 1. Pre-check: count rows in source table to verify data exists
        const { count: matchCount, error: countErr } = await supabase
            .from("matches")
            .select("id", { count: "exact", head: true })
            .eq("league_id", "nba")
            .ilike("id", "%_nba");

        if (countErr) {
            trace.push(`[warn] Pre-check count failed: ${countErr.message}`);
        } else {
            trace.push(`[pre-check] ${matchCount ?? 0} NBA matches in source table`);
            if ((matchCount ?? 0) === 0) {
                trace.push(`[abort] No NBA matches found — skipping refresh to avoid empty views`);
                return new Response(JSON.stringify({
                    status: "SKIPPED",
                    reason: "no_source_data",
                    duration_ms: Date.now() - startMs,
                    trace,
                }), { headers: CORS_HEADERS });
            }
        }

        // 2. Refresh both views via the DB function
        trace.push(`[refresh] Calling refresh_nba_master_views()...`);
        const { error: rpcErr } = await supabase.rpc("refresh_nba_master_views");

        if (rpcErr) {
            trace.push(`[error] RPC failed: ${rpcErr.message}`);
            throw rpcErr;
        }

        const refreshMs = Date.now() - startMs;
        trace.push(`[done] Refresh completed in ${refreshMs}ms`);

        // 3. Post-check: verify views have rows
        const { count: gameViewCount } = await supabase
            .from("mv_nba_game_master")
            .select("match_id", { count: "exact", head: true });

        const { count: teamViewCount } = await supabase
            .from("mv_nba_team_game_master")
            .select("match_id", { count: "exact", head: true });

        trace.push(`[post-check] mv_nba_game_master: ${gameViewCount ?? 0} rows`);
        trace.push(`[post-check] mv_nba_team_game_master: ${teamViewCount ?? 0} rows`);

        // 4. Log to job_runs if available
        try {
            await supabase.from("job_runs").insert({
                job_name: "refresh_nba_master_views",
                target_object: "mv_nba_game_master",
                trigger_type: "cron",
                status: "succeeded",
                started_at: new Date(startMs).toISOString(),
                finished_at: new Date().toISOString(),
                rows_written: (gameViewCount ?? 0) + (teamViewCount ?? 0),
                meta: { trace, source_matches: matchCount },
            });
        } catch {
            // job_runs logging is best-effort
            trace.push(`[warn] job_runs logging failed (non-fatal)`);
        }

        return new Response(JSON.stringify({
            status: "REFRESHED",
            mv_nba_game_master: gameViewCount ?? 0,
            mv_nba_team_game_master: teamViewCount ?? 0,
            duration_ms: Date.now() - startMs,
            trace,
        }), { headers: CORS_HEADERS });

    } catch (err: any) {
        trace.push(`[fatal] ${err.message}`);
        console.error("[refresh-nba-master-views] Fatal:", err);

        // Log failure to job_runs
        try {
            await supabase.from("job_runs").insert({
                job_name: "refresh_nba_master_views",
                target_object: "mv_nba_game_master",
                trigger_type: "cron",
                status: "failed",
                started_at: new Date(startMs).toISOString(),
                finished_at: new Date().toISOString(),
                error_message: err.message,
                meta: { trace },
            });
        } catch {
            // best-effort
        }

        return new Response(JSON.stringify({
            status: "ERROR",
            error: err.message,
            duration_ms: Date.now() - startMs,
            trace,
        }), { status: 500, headers: CORS_HEADERS });
    }
});
