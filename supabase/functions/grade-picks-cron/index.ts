declare const Deno: any;

/**
 * GRADE PICKS CRON (Pick Grading Engine)
 * 
 * Objectives:
 *  - Find all pending picks where the game is FINAL.
 *  - Grade each pick using the grading_metadata.
 *  - Update pregame_intel with WIN/LOSS/PUSH.
 *  - Log all grading actions for observability.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-cron-secret",
    "Content-Type": "application/json",
};

interface GradingMetadata {
    side: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
    type: 'SPREAD' | 'TOTAL' | 'MONEYLINE';
    selection: string;
}

interface PendingPick {
    intel_id: string;
    match_id: string;
    home_team: string;
    away_team: string;
    analyzed_spread: number | null;
    analyzed_total: number | null;
    grading_metadata: GradingMetadata | null;
    recommended_pick: string;
}

interface GameResult {
    match_id: string;
    home_score: number;
    away_score: number;
    status: string;
    home_games?: number;
    away_games?: number;
}

function gradePick(
    pick: PendingPick,
    result: GameResult
): { outcome: 'WIN' | 'LOSS' | 'PUSH' | 'NO_PICK', reason: string } {
    const meta = pick.grading_metadata;
    if (!meta) {
        return { outcome: 'NO_PICK', reason: 'No grading_metadata' };
    }

    let homeS = result.home_score;
    let awayS = result.away_score;

    const isTennis = pick.match_id.includes('tennis');
    const isGamesPick = pick.recommended_pick.toLowerCase().includes('games');

    if (isTennis && isGamesPick && result.home_games !== undefined && result.away_games !== undefined) {
        homeS = result.home_games;
        awayS = result.away_games;
    }

    const margin = homeS - awayS;
    const total = homeS + awayS;

    if (meta.type === 'SPREAD') {
        let line = pick.analyzed_spread;

        // Fallback: Parse line from recommended_pick if standard field is missing
        if (line === null && pick.recommended_pick) {
            const match = pick.recommended_pick.match(/([+-]?\d+\.?\d*)/);
            if (match) {
                line = parseFloat(match[0]);
                console.log(`[RESCUE] Parsed line ${line} from "${pick.recommended_pick}" for ${pick.match_id}`);
            }
        }

        if (line == null) return { outcome: 'NO_PICK', reason: 'No analyzed_spread' };

        // GRADING MATH (v2 - Fixed Jan 2026):
        // CRITICAL: analyzed_spread is stored as the HOME team's spread.
        //   - Hawks -2.5 means analyzed_spread = -2.5
        //   - But if we picked Bucks (AWAY), the Bucks line is +2.5
        //
        // FIX: When side=AWAY, negate the line to get the away team's actual spread.
        //
        // Cover formula: pickedTeamMargin + pickedTeamSpread > 0
        // where pickedTeamMargin = (pickedTeamScore - opponentScore)

        let pickedTeamMargin: number;
        let effectiveLine: number;

        if (meta.side === 'HOME') {
            pickedTeamMargin = result.home_score - result.away_score;
            effectiveLine = line; // Home spread is stored directly
        } else {
            pickedTeamMargin = result.away_score - result.home_score;
            effectiveLine = -line; // AWAY spread is the inverse of the stored HOME spread
        }

        const coverMargin = pickedTeamMargin + effectiveLine;
        console.log(`[GRADE-MATH] ${pick.match_id}: side=${meta.side} storedLine=${line} effectiveLine=${effectiveLine} margin=${pickedTeamMargin} cover=${coverMargin.toFixed(1)}`);

        if (coverMargin > 0) return { outcome: 'WIN', reason: `Cover: ${coverMargin.toFixed(1)}` };
        if (coverMargin < 0) return { outcome: 'LOSS', reason: `Miss: ${coverMargin.toFixed(1)}` };
        return { outcome: 'PUSH', reason: 'Exact line' };
    }

    if (meta.type === 'TOTAL') {
        const line = pick.analyzed_total;
        if (line == null) return { outcome: 'NO_PICK', reason: 'No analyzed_total' };

        if (meta.side === 'OVER') {
            if (total > line) return { outcome: 'WIN', reason: `Total ${total} > ${line}` };
            if (total < line) return { outcome: 'LOSS', reason: `Total ${total} < ${line}` };
            return { outcome: 'PUSH', reason: 'Exact total' };
        } else {
            if (total < line) return { outcome: 'WIN', reason: `Total ${total} < ${line}` };
            if (total > line) return { outcome: 'LOSS', reason: `Total ${total} > ${line}` };
            return { outcome: 'PUSH', reason: 'Exact total' };
        }
    }

    if (meta.type === 'MONEYLINE') {
        if (meta.side === 'HOME') {
            if (margin > 0) return { outcome: 'WIN', reason: 'Home won' };
            if (margin < 0) return { outcome: 'LOSS', reason: 'Home lost' };
            return { outcome: 'PUSH', reason: 'Tie' };
        } else {
            if (margin < 0) return { outcome: 'WIN', reason: 'Away won' };
            if (margin > 0) return { outcome: 'LOSS', reason: 'Away lost' };
            return { outcome: 'PUSH', reason: 'Tie' };
        }
    }

    return { outcome: 'NO_PICK', reason: 'Unknown bet type' };
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const batchId = `grade_${Date.now()}`;
    const trace: string[] = [];
    let graded = 0;
    let wins = 0;
    let losses = 0;

    try {
        trace.push(`[boot] Grading Cron Started: ${batchId}`);

        // 1. Find all pending picks
        const { data: pendingPicks, error: pickErr } = await supabase
            .from("pregame_intel")
            .select("intel_id, match_id, home_team, away_team, analyzed_spread, analyzed_total, grading_metadata, recommended_pick")
            .eq("pick_result", "PENDING")
            .not("recommended_pick", "is", null)
            .limit(500);

        if (pickErr) throw pickErr;
        if (!pendingPicks?.length) {
            trace.push("[exit] No pending picks found.");
            return new Response(JSON.stringify({ status: "NO_PENDING", trace }), { headers: CORS_HEADERS });
        }

        trace.push(`[discovery] Found ${pendingPicks.length} pending picks.`);

        // 2. Get match IDs and find final results from matches table
        const matchIds = pendingPicks.map((p: any) => p.match_id);
        const { data: results, error: resultErr } = await supabase
            .from("matches")
            .select("id, home_score, away_score, status")
            .in("id", matchIds)
            .in("status", ["FINAL", "POST_GAME", "F", "Final", "STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_POST_GAME"]);

        if (resultErr) throw resultErr;

        const resultMap = new Map((results || []).map((r: any) => [r.id, r]));
        trace.push(`[results] Found ${resultMap.size} final results in matches table.`);

        // 2b. SELF-HEALING: For picks without matches table results, try ESPN directly
        const missingMatchIds = matchIds.filter((id: string) => !resultMap.has(id));
        if (missingMatchIds.length > 0) {
            trace.push(`[espn-fallback] Checking ESPN for ${missingMatchIds.length} missing games...`);

            for (const matchId of missingMatchIds) {
                try {
                    // Extract ESPN event ID (strip suffix like _ncaab)
                    const espnEventId = matchId.split('_')[0];
                    const suffix = matchId.split('_')[1] || '';

                    // Determine sport endpoint from suffix
                    let endpoint = 'basketball/mens-college-basketball'; // default for ncaab
                    if (suffix === 'nba') endpoint = 'basketball/nba';
                    else if (suffix === 'nfl') endpoint = 'football/nfl';
                    else if (suffix === 'ncaaf') endpoint = 'football/college-football';
                    else if (suffix === 'nhl') endpoint = 'hockey/nhl';
                    else if (suffix === 'tennis') endpoint = 'tennis/atp'; // Default to ATP, could branch for WTA

                    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/summary?event=${espnEventId}`;
                    const res = await fetch(espnUrl, { signal: AbortSignal.timeout(8000) });

                    if (!res.ok) {
                        trace.push(`[espn-fallback] ${matchId}: ESPN fetch failed (${res.status})`);
                        continue;
                    }

                    const data = await res.json();
                    const competition = data.header?.competitions?.[0];
                    const status = competition?.status?.type?.name || competition?.status?.type?.state;

                    // Only process if game is final
                    if (!['STATUS_FINAL', 'Final', 'post', 'STATUS_FULL_TIME'].includes(status)) {
                        trace.push(`[espn-fallback] ${matchId}: Not final yet (${status})`);
                        continue;
                    }

                    const homeComp = competition?.competitors?.find((c: any) => c.homeAway === 'home');
                    const awayComp = competition?.competitors?.find((c: any) => c.homeAway === 'away');

                    let homeScore = parseInt(homeComp?.score) || (homeComp?.winner ? 1 : 0);
                    let awayScore = parseInt(awayComp?.score) || (awayComp?.winner ? 1 : 0);
                    let homeGames = 0;
                    let awayGames = 0;

                    if (suffix === 'tennis') {
                        // Sum games from linescores
                        homeGames = homeComp?.linescores?.reduce((acc: number, ls: any) => acc + (parseInt(ls.value) || 0), 0) || 0;
                        awayGames = awayComp?.linescores?.reduce((acc: number, ls: any) => acc + (parseInt(ls.value) || 0), 0) || 0;
                    }

                    // Add to result map for grading
                    resultMap.set(matchId, {
                        id: matchId,
                        home_score: homeScore,
                        away_score: awayScore,
                        status: status,
                        home_games: homeGames,
                        away_games: awayGames
                    });

                    trace.push(`[espn-fallback] ${matchId}: Found final score ${awayScore}-${homeScore}`);

                    // Also update the matches table to fix the stale data
                    await supabase.from("matches").update({
                        status: 'STATUS_FINAL',
                        home_score: homeScore,
                        away_score: awayScore
                    }).eq("id", matchId);

                } catch (err: any) {
                    trace.push(`[espn-fallback] ${matchId}: Error - ${err.message}`);
                }
            }

            trace.push(`[espn-fallback] After ESPN check: ${resultMap.size} total results available.`);
        }

        // 3. Grade each pick
        for (const pick of pendingPicks as PendingPick[]) {
            const result = resultMap.get(pick.match_id) as GameResult | undefined;
            if (!result) {
                trace.push(`[skip] ${pick.match_id}: Game not final.`);
                continue;
            }

            const grade = gradePick(pick, result);
            trace.push(`[grade] ${pick.match_id}: ${grade.outcome} (${grade.reason})`);

            const { error: updateErr } = await supabase
                .from("pregame_intel")
                .update({
                    pick_result: grade.outcome,
                    graded_at: new Date().toISOString(),
                    actual_home_score: result.home_score,
                    actual_away_score: result.away_score
                })
                .eq("intel_id", pick.intel_id);

            if (updateErr) {
                trace.push(`[error] Failed to update ${pick.intel_id}: ${updateErr.message}`);
            } else {
                graded++;
                if (grade.outcome === 'WIN') wins++;
                if (grade.outcome === 'LOSS') losses++;
            }
        }

        // 4. Log the batch to pregame_intel_log for observability
        await supabase.from("pregame_intel_log").insert({
            batch_id: batchId,
            matches_processed: pendingPicks.length,
            matches_succeeded: graded,
            matches_failed: pendingPicks.length - graded,
            trace: trace
        });

        // ═══════════════════════════════════════════════════════════════════════
        // 5. GRADE SHARP_INTEL PICKS (AI Chat & Sharp Engine)
        // ═══════════════════════════════════════════════════════════════════════
        let sharpGraded = 0;
        let sharpWins = 0;
        let sharpLosses = 0;

        const { data: sharpPicks, error: sharpErr } = await supabase
            .from("sharp_intel")
            .select("id, match_id, home_team, away_team, pick_type, pick_side, pick_line")
            .eq("pick_result", "PENDING")
            .limit(500);

        if (!sharpErr && sharpPicks?.length) {
            trace.push(`[sharp] Found ${sharpPicks.length} pending sharp_intel picks.`);

            // RESOLUTION: Resolve potential missing suffixes (e.g. 401809250 -> 401809250_nba)
            const resolvedSharpPicks = sharpPicks.map((p: any) => ({
                ...p,
                search_id: p.match_id.includes('_') ? p.match_id : `${p.match_id}_${p.league}`
            }));
            const sharpMatchIds = resolvedSharpPicks.map((p: any) => p.search_id);

            const { data: sharpResults } = await supabase
                .from("matches")
                .select("id, home_score, away_score, status")
                .in("id", sharpMatchIds)
                .in("status", ["FINAL", "POST_GAME", "F", "Final", "STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_POST_GAME"]);

            const sharpResultMap = new Map<string, any>((sharpResults || []).map((r: any) => [r.id, r]));

            for (const pick of resolvedSharpPicks as any[]) {
                const res = sharpResultMap.get(pick.search_id);
                if (!res) continue;

                const margin = res.home_score - res.away_score;
                const total = res.home_score + res.away_score;
                let outcome: 'WIN' | 'LOSS' | 'PUSH' = 'PUSH';
                let reason = '';

                if (pick.pick_type === 'spread' && pick.pick_line != null) {
                    // Determine which side was picked
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    const pickedMargin = isHomePick ? margin : -margin;
                    const cover = pickedMargin + pick.pick_line;

                    if (cover > 0) { outcome = 'WIN'; reason = `Cover: ${cover.toFixed(1)}`; }
                    else if (cover < 0) { outcome = 'LOSS'; reason = `Miss: ${cover.toFixed(1)}`; }
                    else { outcome = 'PUSH'; reason = 'Exact line'; }
                } else if (pick.pick_type === 'total' && pick.pick_line != null) {
                    const isOver = pick.pick_side?.toUpperCase() === 'OVER';
                    if (isOver) {
                        if (total > pick.pick_line) { outcome = 'WIN'; reason = `Total ${total} > ${pick.pick_line}`; }
                        else if (total < pick.pick_line) { outcome = 'LOSS'; reason = `Total ${total} < ${pick.pick_line}`; }
                    } else {
                        if (total < pick.pick_line) { outcome = 'WIN'; reason = `Total ${total} < ${pick.pick_line}`; }
                        else if (total > pick.pick_line) { outcome = 'LOSS'; reason = `Total ${total} > ${pick.pick_line}`; }
                    }
                } else if (pick.pick_type === 'moneyline') {
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    if (isHomePick) {
                        if (margin > 0) { outcome = 'WIN'; reason = 'Home won'; }
                        else if (margin < 0) { outcome = 'LOSS'; reason = 'Home lost'; }
                    } else {
                        if (margin < 0) { outcome = 'WIN'; reason = 'Away won'; }
                        else if (margin > 0) { outcome = 'LOSS'; reason = 'Away lost'; }
                    }
                }

                // 🎯 CLV CALCULATION: How much did we beat/miss the line by?
                let closingLineDelta: number | null = null;
                if (pick.pick_type === 'spread' && pick.pick_line != null) {
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    const actualMargin = isHomePick ? margin : -margin;
                    closingLineDelta = actualMargin + pick.pick_line; // Positive = beat line, Negative = missed
                } else if (pick.pick_type === 'total' && pick.pick_line != null) {
                    const isOver = pick.pick_side?.toUpperCase() === 'OVER';
                    closingLineDelta = isOver ? total - pick.pick_line : pick.pick_line - total;
                }

                trace.push(`[sharp-grade] ${pick.match_id}: ${outcome} (${reason}) CLV: ${closingLineDelta?.toFixed(1) || 'N/A'}`);

                await supabase.from("sharp_intel").update({
                    pick_result: outcome,
                    graded_at: new Date().toISOString(),
                    actual_home_score: res.home_score,
                    actual_away_score: res.away_score,
                    closing_line_delta: closingLineDelta
                }).eq("id", pick.id);

                sharpGraded++;
                if (outcome === 'WIN') sharpWins++;
                if (outcome === 'LOSS') sharpLosses++;
            }
        }

        trace.push(`[sharp-summary] Graded ${sharpGraded} sharp_intel picks: ${sharpWins}W-${sharpLosses}L`);

        // ═══════════════════════════════════════════════════════════════════════
        // 6. GRADE AI_CHAT_PICKS (Legacy Chat Picks)
        // ═══════════════════════════════════════════════════════════════════════
        let chatGraded = 0;
        let chatWins = 0;
        let chatLosses = 0;

        const { data: chatPicks, error: chatErr } = await supabase
            .from("ai_chat_picks")
            .select("id, match_id, home_team, away_team, pick_type, pick_side, pick_line")
            .eq("result", "pending")
            .limit(500);

        if (!chatErr && chatPicks?.length) {
            trace.push(`[chat] Found ${chatPicks.length} pending ai_chat_picks.`);

            // RESOLUTION: Resolve potential missing suffixes (e.g. 401809250 -> 401809250_nba)
            const resolvedChatPicks = chatPicks.map((p: any) => ({
                ...p,
                search_id: p.match_id.includes('_') ? p.match_id : `${p.match_id}_${p.league}`
            }));
            const chatMatchIds = resolvedChatPicks.map((p: any) => p.search_id);

            const { data: chatResults } = await supabase
                .from("matches")
                .select("id, home_score, away_score, status")
                .in("id", chatMatchIds)
                .in("status", ["FINAL", "POST_GAME", "F", "Final", "STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_POST_GAME"]);

            const chatResultMap = new Map<string, any>((chatResults || []).map((r: any) => [r.id, r]));

            for (const pick of resolvedChatPicks as any[]) {
                const res = chatResultMap.get(pick.search_id);
                if (!res) continue;

                const margin = res.home_score - res.away_score;
                const total = res.home_score + res.away_score;
                let outcome: 'win' | 'loss' | 'push' = 'push';
                let reason = '';

                if (pick.pick_type === 'total' && pick.pick_line != null) {
                    const line = parseFloat(pick.pick_line);
                    const isOver = pick.pick_side?.toUpperCase() === 'OVER';
                    if (isOver) {
                        if (total > line) { outcome = 'win'; reason = `Total ${total} > ${line}`; }
                        else if (total < line) { outcome = 'loss'; reason = `Total ${total} < ${line}`; }
                    } else {
                        if (total < line) { outcome = 'win'; reason = `Total ${total} < ${line}`; }
                        else if (total > line) { outcome = 'loss'; reason = `Total ${total} > ${line}`; }
                    }
                } else if (pick.pick_type === 'spread' && pick.pick_line != null) {
                    const line = parseFloat(pick.pick_line);
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    const pickedMargin = isHomePick ? margin : -margin;
                    const cover = pickedMargin + line;

                    if (cover > 0) { outcome = 'win'; reason = `Cover: ${cover.toFixed(1)}`; }
                    else if (cover < 0) { outcome = 'loss'; reason = `Miss: ${cover.toFixed(1)}`; }
                } else if (pick.pick_type === 'moneyline') {
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    if (isHomePick) {
                        if (margin > 0) { outcome = 'win'; reason = 'Home won'; }
                        else if (margin < 0) { outcome = 'loss'; reason = 'Home lost'; }
                    } else {
                        if (margin < 0) { outcome = 'win'; reason = 'Away won'; }
                        else if (margin > 0) { outcome = 'loss'; reason = 'Away lost'; }
                    }
                }

                // 🎯 CLV CALCULATION for ai_chat_picks
                let chatClv: number | null = null;
                if (pick.pick_type === 'spread' && pick.pick_line != null) {
                    const line = parseFloat(pick.pick_line);
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    const actualMargin = isHomePick ? margin : -margin;
                    chatClv = actualMargin + line;
                } else if (pick.pick_type === 'total' && pick.pick_line != null) {
                    const line = parseFloat(pick.pick_line);
                    const isOver = pick.pick_side?.toUpperCase() === 'OVER';
                    chatClv = isOver ? total - line : line - total;
                }

                trace.push(`[chat-grade] ${pick.match_id}: ${outcome} (${reason}) CLV: ${chatClv?.toFixed(1) || 'N/A'}`);

                await supabase.from("ai_chat_picks").update({
                    result: outcome,
                    graded_at: new Date().toISOString(),
                    clv: chatClv
                }).eq("id", pick.id);

                chatGraded++;
                if (outcome === 'win') chatWins++;
                if (outcome === 'loss') chatLosses++;
            }
        }

        trace.push(`[chat-summary] Graded ${chatGraded} ai_chat_picks: ${chatWins}W-${chatLosses}L`);

        return new Response(JSON.stringify({
            status: "GRADED",
            pregame: { graded, wins, losses },
            sharp: { graded: sharpGraded, wins: sharpWins, losses: sharpLosses },
            chat: { graded: chatGraded, wins: chatWins, losses: chatLosses },
            trace
        }), { headers: CORS_HEADERS });

    } catch (err: any) {
        trace.push(`[fatal] ${err.message}`);
        console.error("[grade-picks-cron] Fatal:", err);
        return new Response(JSON.stringify({ status: "ERROR", error: err.message, trace }), { status: 500, headers: CORS_HEADERS });
    }
});
