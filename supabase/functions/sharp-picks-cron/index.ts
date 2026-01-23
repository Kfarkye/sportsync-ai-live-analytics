// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

/**
 * SHARP PICKS CRON (Triple Confluence Gate)
 * 
 * Dispatches games to sharp-picks-worker for analysis.
 * Only saves picks that pass all 3 gates with 70+ confluence.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCanonicalMatchId } from "../_shared/match-registry.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
};

const CONFIG = {
    LOOKAHEAD_HOURS: 24,
    FETCH_LIMIT: 50,
    BATCH_SIZE: 5,
    TIMEOUT_MS: 120_000,
};

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: number | undefined;
    const timeout = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} (>${ms}ms)`)), ms) as unknown as number;
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const trace: string[] = [];
    const batchId = `sharp_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
        const body = await req.json().catch(() => ({}));
        const isForce = body.force === true;

        trace.push(`[boot] Sharp Picks Cron Started | Batch: ${batchId} | Force: ${isForce}`);
        console.log(`[sharp-cron] 🎯 Triple Confluence Gate Activated: ${batchId}`);

        // 1. Discover upcoming games
        const now = new Date();
        const windowEnd = new Date(now.getTime() + CONFIG.LOOKAHEAD_HOURS * 60 * 60 * 1000);

        const { data: slate, error: slateErr } = await supabase
            .from("matches")
            .select("id, home_team, away_team, start_time, sport, league_id, odds_home_spread_safe, odds_total_safe, current_odds")
            .gte("start_time", now.toISOString())
            .lt("start_time", windowEnd.toISOString())
            .order("start_time", { ascending: true })
            .limit(CONFIG.FETCH_LIMIT);

        if (slateErr) throw slateErr;

        trace.push(`[discovery] Found ${slate?.length || 0} games in window.`);

        if (!slate?.length) {
            return new Response(JSON.stringify({ status: "NO_GAMES", trace }), { headers: CORS_HEADERS });
        }

        // 2. Check for existing sharp picks to avoid duplicates
        const { data: existingPicks } = await supabase
            .from("sharp_intel")
            .select("match_id")
            .in("match_id", slate.map((s: any) => getCanonicalMatchId(s.id, s.league_id)));

        const existingMatchIds = new Set((existingPicks || []).map((p: any) => p.match_id));
        const gamesToAnalyze = slate.filter((g: any) => !existingMatchIds.has(getCanonicalMatchId(g.id, g.league_id)));

        trace.push(`[filter] ${gamesToAnalyze.length} games need sharp analysis (${existingMatchIds.size} already analyzed).`);

        if (gamesToAnalyze.length === 0) {
            return new Response(JSON.stringify({ status: "ALL_ANALYZED", trace }), { headers: CORS_HEADERS });
        }

        // 3. Dispatch to workers (same pattern as pregame-intel-cron)
        const batch = gamesToAnalyze.slice(0, CONFIG.BATCH_SIZE);
        let dispatched = 0;
        let qualified = 0;

        const results = await Promise.allSettled(batch.map(async (game: any) => {
            console.log(`[sharp-cron] 🚀 Dispatching: ${game.away_team} @ ${game.home_team}`);
            trace.push(`[dispatch] ${game.id}: ${game.away_team} @ ${game.home_team}`);

            const invocation = supabase.functions.invoke("sharp-picks-worker", {
                body: {
                    match_id: game.id,
                    home_team: game.home_team,
                    away_team: game.away_team,
                    sport: game.sport,
                    league: game.league_id,
                    start_time: game.start_time,
                    current_spread: game.odds_home_spread_safe,
                    current_total: game.odds_total_safe,
                    current_odds: game.current_odds
                },
                headers: {
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                    apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
                }
            });

            const result = await withTimeout(invocation, CONFIG.TIMEOUT_MS, `Sharp Analysis: ${game.id}`) as any;

            if (result.error) {
                trace.push(`[error] ${game.id}: ${result.error.message || result.error}`);
                throw result.error;
            }

            dispatched++;
            if (result.data?.status === "QUALIFIED") {
                qualified++;
                trace.push(`[qualified] ✅ ${result.data.pick} (${result.data.confluence_score}%)`);
            } else {
                trace.push(`[skip] ${game.id}: Not qualified (${result.data?.confluence_score || 0}%)`);
            }

            return result;
        }));

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        trace.push(`[summary] Dispatched: ${dispatched}, Succeeded: ${succeeded}, Qualified: ${qualified}`);

        console.log(`[sharp-cron] 📊 Batch Complete: ${succeeded}/${batch.length} analyzed, ${qualified} qualified.`);

        return new Response(JSON.stringify({
            status: "OK",
            batch_id: batchId,
            games_analyzed: succeeded,
            qualified_picks: qualified,
            trace
        }), { headers: CORS_HEADERS });

    } catch (error: any) {
        console.error(`[sharp-cron] 💥 Fatal Error:`, error);
        return new Response(JSON.stringify({
            status: "ERROR",
            error: error.message,
            trace
        }), { status: 500, headers: CORS_HEADERS });
    }
});
