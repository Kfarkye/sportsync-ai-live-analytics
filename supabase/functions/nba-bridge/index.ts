/**
 * nba-bridge - Production Hardened Orchestrator
 * 
 * Coordinates the NBA signal pipeline:
 * 1. Fetches live games from matches table
 * 2. Upserts to nba_games
 * 3. Triggers nba-ingest-tick for live data
 * 4. Triggers nba-run-model for signal generation
 * 
 * Logs all operations to nba_audit_log for monitoring
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: any;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
};

// Audit log helper
async function logAudit(
    supabase: any,
    operation: string,
    gameId: string | null,
    details: object,
    success: boolean,
    durationMs: number,
    errorMessage?: string
) {
    try {
        await supabase.from("nba_audit_log").insert({
            function_name: "nba-bridge",
            operation,
            game_id: gameId,
            details,
            duration_ms: durationMs,
            success,
            error_message: errorMessage,
        });
    } catch (e) {
        console.error("[AUDIT] Failed to log:", e);
    }
}

Deno.serve(async (req: Request) => {
    const startTime = Date.now();

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: CORS_HEADERS });
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    try {
        // 1. Fetch live NBA games (last 24h to next 24h)
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const { data: matches, error: mErr } = await supabase
            .from("matches")
            .select("id, home_team, away_team, start_time, status, odds_total_safe, closing_odds")
            .eq("league_id", "nba")
            .gte("start_time", yesterday);

        if (mErr) throw mErr;

        if (!matches || matches.length === 0) {
            await logAudit(supabase, "NO_GAMES", null, {}, true, Date.now() - startTime);
            return new Response(
                JSON.stringify({ message: "No NBA games found" }),
                { headers: CORS_HEADERS }
            );
        }

        console.log(`[nba-bridge] Processing ${matches.length} games`);

        console.log(`[nba-bridge] Processing ${matches.length} games`);

        // Helper: Upsert Game Metadata
        const upsertGameMeta = async (m: any) => {
            // First, get existing status to avoid downgrading
            const { data: existing } = await supabase.from("nba_games").select("status").eq("game_id", m.id).single();
            const currentStatus = existing?.status || "STATUS_SCHEDULED";

            // Only update status if it's an advancement or matching
            let newStatus = m.status || "STATUS_SCHEDULED";
            if (currentStatus === "STATUS_IN_PROGRESS" && newStatus === "STATUS_SCHEDULED") {
                newStatus = "STATUS_IN_PROGRESS"; // Stick to live
            }
            if (currentStatus === "STATUS_FINAL" && (newStatus === "STATUS_SCHEDULED" || newStatus === "STATUS_IN_PROGRESS")) {
                newStatus = "STATUS_FINAL"; // Stick to final
            }

            await supabase.from("nba_games").upsert({
                game_id: m.id,
                season: "2024-25",
                home_team: m.home_team,
                away_team: m.away_team,
                start_ts: m.start_time,
                status: newStatus,
                close_total: m.odds_total_safe || m.closing_odds?.total || 220,
                pace_pre48: 100,
            }, { onConflict: "game_id" });
        };

        // Helper: Ingest Tick (Returns success/fail)
        const ingestTick = async (m: any) => {
            const status = String(m.status || "").toUpperCase();
            const isInProgress = status.includes("PROGRESS") || status.includes("LIVE") || status.includes("HALFTIME");
            const isFinal = status.includes("FINAL") || status === "FINISHED";

            // v3.1: Start time awareness. If scheduled but start time is near or past, we MUST check.
            const startTs = new Date(m.start_time).getTime();
            const isNearStart = startTs <= Date.now() + 5 * 60 * 1000; // 5 min buffer

            if (!isInProgress && !isFinal && !isNearStart) return { skipped: true };
            try {
                const start = Date.now();
                const { error } = await supabase.functions.invoke("nba-ingest-tick", { body: { gameId: m.id } });
                if (error) throw new Error(error.message);
                return { id: m.id, success: true, duration: Date.now() - start };
            } catch (e: any) {
                console.error(`[nba-bridge] Tick failed for ${m.id}:`, e.message);
                return { id: m.id, success: false, error: e.message };
            }
        };

        // Helper: Run Model (Returns success/fail)
        const runModel = async (m: any) => {
            const status = String(m.status || "").toUpperCase();
            const isInProgress = status.includes("PROGRESS") || status.includes("LIVE") || status.includes("HALFTIME");
            const isFinal = status.includes("FINAL") || status === "FINISHED";

            if (!isInProgress && !isFinal) return { skipped: true };
            try {
                const start = Date.now();
                const { error } = await supabase.functions.invoke("nba-run-model", { body: { gameId: m.id } });
                if (error) throw new Error(error.message);
                return { id: m.id, success: true, duration: Date.now() - start };
            } catch (e: any) {
                console.error(`[nba-bridge] Model failed for ${m.id}:`, e.message);
                return { id: m.id, success: false, error: e.message };
            }
        };

        // PHASE 1: Metadata Sync (Parallel)
        await Promise.all(matches.map(upsertGameMeta));

        // PHASE 2: Live Data Ingestion (Parallel - Wait for all ticks to land)
        // We use allSettled to ensure one failure doesn't block the rest
        const tickResults = await Promise.all(matches.map(ingestTick));

        // PHASE 3: Edge Model Execution (Parallel)
        // Only run model for games where tick ingestion succeeded (or wasn't needed)
        const modelPromises = matches.map(async (m: any, i: number) => {
            const tickRes = tickResults[i];

            // v3.1: If tick succeeded for a previously SCHEDULED game, promote status locally
            // This ensures we run the model in the SAME bridge cycle the game starts.
            if (tickRes.success && (m.status === "STATUS_SCHEDULED" || !m.status)) {
                m.status = "STATUS_IN_PROGRESS";
            }

            // If tick failed, we skip model run to avoid using stale data
            if (tickRes.success === false) return { id: m.id, skipped: true, note: "Tick failed" };
            return await runModel(m);
        });
        const modelResults = await Promise.all(modelPromises);

        // Summarize
        const successCount = modelResults.filter((r: any) => r.success).length;
        const errorCount = modelResults.filter((r: any) => r.success === false).length;


        // Log summary
        await logAudit(supabase, "BRIDGE_RUN", null, {
            total: matches.length,
            success: successCount,
            errors: errorCount,
        }, errorCount === 0, Date.now() - startTime);

        return new Response(
            JSON.stringify({
                success: true,
                processed: successCount,
                errors: errorCount,
                durationMs: Date.now() - startTime,
            }),
            { headers: CORS_HEADERS }
        );

    } catch (e: any) {
        console.error("[nba-bridge] Fatal error:", e.message);
        await logAudit(supabase, "ERROR", null, {}, false, Date.now() - startTime, e.message);

        return new Response(
            JSON.stringify({ error: e.message }),
            { status: 500, headers: CORS_HEADERS }
        );
    }
});
