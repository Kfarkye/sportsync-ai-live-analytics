declare const Deno: any;

/**
 * FINALIZE GAMES CRON
 * 
 * Purpose: Sweep all PENDING picks for games that should be FINAL but weren't caught by ingest.
 * Uses ESPN Summary API directly (more reliable than scoreboard for final status).
 * 
 * Schedule: Run at 2 AM PT and 6 AM PT as cleanup sweeps.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
};

interface PendingMatch {
    match_id: string;
    league_id: string;
}

// Map league_id to ESPN endpoint
const LEAGUE_ENDPOINTS: Record<string, string> = {
    'nba': 'basketball/nba',
    'nfl': 'football/nfl',
    'nhl': 'hockey/nhl',
    'mlb': 'baseball/mlb',
    'mens-college-basketball': 'basketball/mens-college-basketball',
    'college-football': 'football/college-football',
    'eng.1': 'soccer/eng.1',
    'ita.1': 'soccer/ita.1',
    'esp.1': 'soccer/esp.1',
    'ger.1': 'soccer/ger.1',
    'bundesliga': 'soccer/ger.1',
};

async function fetchGameStatus(matchId: string, leagueId: string): Promise<{ status: string; homeScore: number; awayScore: number } | null> {
    const baseId = matchId.replace(/_.*$/, ''); // Strip suffix like _nba, _ncaab
    const endpoint = LEAGUE_ENDPOINTS[leagueId];

    if (!endpoint) {
        console.log(`[Skip] Unknown league: ${leagueId}`);
        return null;
    }

    const url = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/summary?event=${baseId}`;

    try {
        const res = await fetch(url);
        if (!res.ok) return null;

        const data = await res.json();
        const competition = data?.header?.competitions?.[0];
        const status = competition?.status?.type?.name;
        const competitors = competition?.competitors || [];

        const home = competitors.find((c: any) => c.homeAway === 'home');
        const away = competitors.find((c: any) => c.homeAway === 'away');

        return {
            status: status || 'UNKNOWN',
            homeScore: parseInt(home?.score || '0'),
            awayScore: parseInt(away?.score || '0')
        };
    } catch (e: any) {
        console.error(`[ESPN] Failed to fetch ${baseId}:`, e.message);
        return null;
    }
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const batchId = `finalize_${Date.now()}`;
    const trace: string[] = [];
    let finalized = 0;
    let graded = 0;

    try {
        trace.push(`[boot] Finalize Games Cron: ${batchId}`);

        // 1. Find distinct match_ids from PENDING picks where game should be done
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const { data: pendingPicks, error: pickErr } = await supabase
            .from("pregame_intel")
            .select("match_id, league_id")
            .eq("pick_result", "PENDING")
            .lte("game_date", yesterday)
            .limit(100);

        if (pickErr) throw pickErr;
        if (!pendingPicks?.length) {
            trace.push("[exit] No stale pending picks found.");
            return new Response(JSON.stringify({ status: "NO_STALE", trace }), { headers: CORS_HEADERS });
        }

        // Dedupe by match_id
        const uniqueMatches = Array.from(
            new Map(pendingPicks.map((p: PendingMatch) => [p.match_id, p])).values()
        ) as PendingMatch[];

        trace.push(`[discovery] Found ${uniqueMatches.length} stale matches to check.`);

        // 2. Check each match status via ESPN
        for (const match of uniqueMatches) {
            const result = await fetchGameStatus(match.match_id, match.league_id);

            if (!result) {
                trace.push(`[skip] ${match.match_id}: Could not fetch status`);
                continue;
            }

            const isFinal = result.status.toUpperCase().includes('FINAL') ||
                result.status.toUpperCase().includes('COMPLETE');

            if (!isFinal) {
                trace.push(`[skip] ${match.match_id}: Status is ${result.status}`);
                continue;
            }

            // 3. Update matches table with final status and scores
            const { error: updateErr } = await supabase
                .from('matches')
                .update({
                    status: result.status,
                    home_score: result.homeScore,
                    away_score: result.awayScore,
                    last_updated: new Date().toISOString()
                })
                .eq('id', match.match_id);

            if (updateErr) {
                trace.push(`[error] ${match.match_id}: Update failed - ${updateErr.message}`);
                continue;
            }

            trace.push(`[finalized] ${match.match_id}: ${result.awayScore}-${result.homeScore} (${result.status})`);
            finalized++;
        }

        // 4. Trigger grading cron if we finalized any games
        if (finalized > 0) {
            trace.push(`[grading] Triggering grade-picks-cron for ${finalized} finalized games...`);

            const gradeRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/grade-picks-cron`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                    'Content-Type': 'application/json'
                }
            });

            if (gradeRes.ok) {
                const gradeData = await gradeRes.json();
                graded = gradeData.graded || 0;
                trace.push(`[grading] Graded ${graded} picks.`);
            }
        }

        // 5. Log the batch
        await supabase.from("pregame_intel_log").insert({
            batch_id: batchId,
            matches_processed: uniqueMatches.length,
            matches_succeeded: finalized,
            matches_failed: uniqueMatches.length - finalized,
            trace: trace
        });

        return new Response(JSON.stringify({
            status: "COMPLETE",
            finalized,
            graded,
            trace
        }), { headers: CORS_HEADERS });

    } catch (err: any) {
        trace.push(`[fatal] ${err.message}`);
        console.error("[finalize-games-cron] Fatal:", err);
        return new Response(JSON.stringify({ status: "ERROR", error: err.message, trace }), { status: 500, headers: CORS_HEADERS });
    }
});
