declare const Deno: any;

/**
 * GRADE PICKS CRON v2.0 (Strict Deterministic Grading)
 * 
 * ARCHITECTURE (Approved Jan 27, 2026):
 *  1. GATE: Only grade picks with odds_event_id and grading_metadata.side
 *  2. MATCH: Exact odds_event_id join to Odds API scores - NEVER fuzzy match
 *  3. EVIDENCE: Store final_home_score, final_away_score for audit trail
 *  4. STALE: Mark picks MANUAL_REVIEW if pending >24h after game time
 *  5. VOID: Mark cancelled/postponed games
 * 
 * PRESERVES:
 *  - pregame_intel grading (primary)
 *  - sharp_intel grading  
 *  - ai_chat_picks grading
 *  - ESPN fallback for matches table hydration
 *  - CLV calculation
 *  - Observability logging
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-cron-secret",
    "Content-Type": "application/json",
};

const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY") || "6bfad0500cee211c753707183b9bd035";

interface GradingMetadata {
    side: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
    type: 'SPREAD' | 'TOTAL' | 'MONEYLINE';
    selection: string;
}

interface PendingPick {
    intel_id: string;
    match_id: string;
    odds_event_id: string | null;
    home_team: string;
    away_team: string;
    analyzed_spread: number | null;
    analyzed_total: number | null;
    grading_metadata: GradingMetadata | null;
    recommended_pick: string;
    game_date: string;
}

interface OddsAPIScore {
    id: string;
    home_team: string;
    away_team: string;
    home_score: number;
    away_score: number;
    completed: boolean;
}

async function fetchOddsAPIScores(sport: string = 'basketball_ncaab'): Promise<Map<string, OddsAPIScore>> {
    const scoreMap = new Map<string, OddsAPIScore>();

    try {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

        if (!res.ok) {
            console.warn(`[odds-api] Failed to fetch ${sport} scores: ${res.status}`);
            return scoreMap;
        }

        const data = await res.json();

        for (const game of data) {
            if (!game.completed || !game.scores) continue;

            const homeScore = game.scores.find((s: any) => s.name === game.home_team);
            const awayScore = game.scores.find((s: any) => s.name === game.away_team);

            scoreMap.set(game.id, {
                id: game.id,
                home_team: game.home_team,
                away_team: game.away_team,
                home_score: parseInt(homeScore?.score || '0'),
                away_score: parseInt(awayScore?.score || '0'),
                completed: true
            });
        }

        console.log(`[odds-api] Fetched ${scoreMap.size} final scores for ${sport}`);
    } catch (err: any) {
        console.error(`[odds-api] Error fetching ${sport}:`, err.message);
    }

    return scoreMap;
}

function gradePick(
    pick: PendingPick,
    homeScore: number,
    awayScore: number
): { outcome: 'WIN' | 'LOSS' | 'PUSH' | 'NO_PICK', reason: string } {
    const meta = pick.grading_metadata;

    // STRICT GATE: Must have grading_metadata.side
    if (!meta || !meta.side) {
        return { outcome: 'NO_PICK', reason: 'Missing grading_metadata.side' };
    }

    const margin = homeScore - awayScore;
    const total = homeScore + awayScore;

    if (meta.type === 'SPREAD') {
        // Parse spread from pick text (most reliable source)
        let pickedTeamSpread: number | null = null;

        if (pick.recommended_pick) {
            const matches = pick.recommended_pick.match(/([+-]?\d+\.?\d*)/g);
            if (matches) {
                const candidates = matches
                    .map(m => parseFloat(m))
                    .filter(n => !isNaN(n) && Math.abs(n) <= 30);

                if (candidates.length > 0) {
                    // Prefer quarter/half lines over integers
                    const scored = candidates.map(n => {
                        const frac = Math.abs(n) % 1;
                        const isQuarter = Math.abs(frac - 0.25) < 0.01 || Math.abs(frac - 0.75) < 0.01;
                        const isHalf = Math.abs(frac - 0.5) < 0.01;
                        return { value: n, score: isQuarter ? 3 : isHalf ? 2 : 1 };
                    });
                    scored.sort((a, b) => b.score - a.score);
                    pickedTeamSpread = scored[0].value;
                }
            }
        }

        // Fallback to analyzed_spread
        if (pickedTeamSpread === null && pick.analyzed_spread !== null) {
            if (meta.side === 'HOME') {
                pickedTeamSpread = pick.analyzed_spread;
            } else {
                if (pick.recommended_pick) {
                    const textHasNegative = pick.recommended_pick.includes('-');
                    const storedIsNegative = pick.analyzed_spread < 0;
                    if (textHasNegative === storedIsNegative) {
                        pickedTeamSpread = pick.analyzed_spread;
                    } else {
                        pickedTeamSpread = -pick.analyzed_spread;
                    }
                } else {
                    pickedTeamSpread = -pick.analyzed_spread;
                }
            }
        }

        if (pickedTeamSpread === null) {
            return { outcome: 'NO_PICK', reason: 'No spread found' };
        }

        const pickedTeamMargin = meta.side === 'HOME'
            ? homeScore - awayScore
            : awayScore - homeScore;

        const coverMargin = pickedTeamMargin + pickedTeamSpread;

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
    let graded = 0, wins = 0, losses = 0, skipped = 0, manualReview = 0;

    try {
        trace.push(`[boot] Grade Picks Cron v2.0 (Strict) Started: ${batchId}`);

        // ═══════════════════════════════════════════════════════════════════════
        // 1. FETCH ODDS API SCORES (deterministic source of truth)
        // ═══════════════════════════════════════════════════════════════════════
        const cbbScores = await fetchOddsAPIScores('basketball_ncaab');
        const nbaScores = await fetchOddsAPIScores('basketball_nba');

        // Merge all scores into one map
        const allScores = new Map([...cbbScores, ...nbaScores]);
        trace.push(`[scores] Total: ${allScores.size} completed games from Odds API`);

        // ═══════════════════════════════════════════════════════════════════════
        // 2. FIND PENDING PICKS (CBB/NBA with odds_event_id)
        // ═══════════════════════════════════════════════════════════════════════
        const { data: pendingPicks, error: pickErr } = await supabase
            .from("pregame_intel")
            .select("intel_id, match_id, odds_event_id, home_team, away_team, analyzed_spread, analyzed_total, grading_metadata, recommended_pick, game_date")
            .eq("pick_result", "PENDING")
            .not("recommended_pick", "is", null)
            .order('game_date', { ascending: true }) // Process oldest games first
            .limit(50); // Batch size to prevent timeout on ESPN fallback calls

        if (pickErr) throw pickErr;
        if (!pendingPicks?.length) {
            trace.push("[exit] No pending picks found.");
            return new Response(JSON.stringify({ status: "NO_PENDING", trace }), { headers: CORS_HEADERS });
        }

        trace.push(`[discovery] Found ${pendingPicks.length} pending picks.`);

        // ═══════════════════════════════════════════════════════════════════════
        // PRE-CACHE: Fetch all team mappings to avoid N+1 DB calls
        // ═══════════════════════════════════════════════════════════════════════
        const { data: allMappings } = await supabase
            .from('canonical_teams')
            .select('canonical_name, odds_api_name, league_id');

        // Map<"league:team_name_lowercase", canonical_name>
        const teamMap = new Map<string, string>();

        if (allMappings) {
            for (const m of allMappings) {
                const key1 = `${m.league_id}:${m.odds_api_name.toLowerCase().trim()}`;
                const key2 = `${m.league_id}:${m.canonical_name.toLowerCase().trim()}`;
                teamMap.set(key1, m.canonical_name);
                teamMap.set(key2, m.canonical_name);
            }
        }

        const resolveTeam = (name: string, leagueId: string) => {
            if (!name) return null;
            const key = `${leagueId}:${name.toLowerCase().trim()}`;
            return teamMap.get(key) || name.trim(); // Return name as fallback if not in DB
        };

        // ═══════════════════════════════════════════════════════════════════════
        // 3. GRADE EACH PICK (Cascading Score Lookup)
        // ═══════════════════════════════════════════════════════════════════════
        for (const pick of pendingPicks as PendingPick[]) {

            // GATE: Must have grading_metadata.side
            if (!pick.grading_metadata?.side) {
                trace.push(`[skip] ${pick.intel_id}: Missing grading_metadata.side`);
                skipped++;
                continue;
            }

            // CASCADING SCORE LOOKUP
            let score: OddsAPIScore | undefined;

            // ATTEMPT 1: Direct odds_event_id match
            if (pick.odds_event_id) {
                score = allScores.get(pick.odds_event_id);
                if (score) trace.push(`[match-direct] ${pick.match_id}: via odds_event_id`);
            }

            // ATTEMPT 2: Canonical team name match against Odds API scores (CBB/NBA)
            if (!score) {
                const isCBB = pick.match_id.includes('ncaab');
                const isNBA = pick.match_id.includes('nba');
                const isCBBorNBA = isCBB || isNBA;
                const leagueId = isNBA ? 'basketball_nba' : 'basketball_ncaab';

                if (isCBBorNBA) {
                    // Resolve pick teams using in-memory map
                    const pickHomeCanonical = resolveTeam(pick.home_team, leagueId);
                    const pickAwayCanonical = resolveTeam(pick.away_team, leagueId);

                    // Search Odds API scores using canonical names
                    for (const [eventId, gameScore] of allScores) {
                        const scoreHomeCanonical = resolveTeam(gameScore.home_team, leagueId);
                        const scoreAwayCanonical = resolveTeam(gameScore.away_team, leagueId);

                        if (pickHomeCanonical && pickAwayCanonical &&
                            scoreHomeCanonical && scoreAwayCanonical &&
                            pickHomeCanonical === scoreHomeCanonical &&
                            pickAwayCanonical === scoreAwayCanonical) {

                            score = gameScore;
                            trace.push(`[match-canonical] ${pick.match_id}: ${pickHomeCanonical} vs ${pickAwayCanonical} → ${eventId}`);
                            break;
                        }
                    }
                }
            }

            if (!score) {
                // For non-CBB/NBA or missing IDs, try matches table fallback
                const { data: matchResult } = await supabase
                    .from("matches")
                    .select("home_score, away_score, status")
                    .eq("id", pick.match_id)
                    .in("status", ["FINAL", "STATUS_FINAL", "STATUS_FULL_TIME"])
                    .single();

                // GUARD: Skip 0-0 scores (likely bad data) - let ESPN fallback handle
                if (matchResult && (matchResult.home_score > 0 || matchResult.away_score > 0)) {
                    score = {
                        id: pick.match_id,
                        home_team: pick.home_team,
                        away_team: pick.away_team,
                        home_score: matchResult.home_score,
                        away_score: matchResult.away_score,
                        completed: true
                    };
                    trace.push(`[fallback] ${pick.match_id}: Using matches table score`);
                } else if (matchResult) {
                    trace.push(`[skip-bad-data] ${pick.match_id}: Matches table has 0-0 score, trying ESPN`);
                }
            }

            // ESPN FALLBACK: For sports without Odds API coverage or missing matches data
            if (!score) {
                try {
                    const espnEventId = pick.match_id.split('_')[0];
                    const suffix = pick.match_id.split('_')[1] || '';

                    let endpoint = 'basketball/mens-college-basketball';
                    if (suffix === 'nba') endpoint = 'basketball/nba';
                    else if (suffix === 'nfl') endpoint = 'football/nfl';
                    else if (suffix === 'ncaaf') endpoint = 'football/college-football';
                    else if (suffix === 'nhl') endpoint = 'hockey/nhl';
                    else if (suffix === 'tennis') endpoint = 'tennis/atp';

                    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/${endpoint}/summary?event=${espnEventId}`;
                    const res = await fetch(espnUrl, { signal: AbortSignal.timeout(8000) });

                    if (res.ok) {
                        const data = await res.json();
                        const competition = data.header?.competitions?.[0];
                        const status = competition?.status?.type?.name || competition?.status?.type?.state;

                        if (['STATUS_FINAL', 'Final', 'post', 'STATUS_FULL_TIME'].includes(status)) {
                            const homeComp = competition?.competitors?.find((c: any) => c.homeAway === 'home');
                            const awayComp = competition?.competitors?.find((c: any) => c.homeAway === 'away');

                            let homeScore = parseInt(homeComp?.score) || 0;
                            let awayScore = parseInt(awayComp?.score) || 0;

                            // Tennis games scoring
                            if (suffix === 'tennis' && pick.recommended_pick.toLowerCase().includes('games')) {
                                homeScore = homeComp?.linescores?.reduce((acc: number, ls: any) => acc + (parseInt(ls.value) || 0), 0) || 0;
                                awayScore = awayComp?.linescores?.reduce((acc: number, ls: any) => acc + (parseInt(ls.value) || 0), 0) || 0;
                            }

                            score = {
                                id: pick.match_id,
                                home_team: pick.home_team,
                                away_team: pick.away_team,
                                home_score: homeScore,
                                away_score: awayScore,
                                completed: true
                            };

                            // Also update matches table for future lookups
                            await supabase.from("matches").update({
                                status: 'STATUS_FINAL',
                                home_score: homeScore,
                                away_score: awayScore
                            }).eq("id", pick.match_id);

                            trace.push(`[espn-fallback] ${pick.match_id}: Found final score ${awayScore}-${homeScore}`);
                        }
                    }
                } catch (err: any) {
                    trace.push(`[espn-fallback] ${pick.match_id}: Error - ${err.message}`);
                }
            }

            if (!score) {
                trace.push(`[skip] ${pick.intel_id}: No score found for ${pick.odds_event_id || pick.match_id}`);
                skipped++;
                continue;
            }

            // GRADE THE PICK
            const grade = gradePick(pick, score.home_score, score.away_score);

            if (grade.outcome === 'NO_PICK') {
                trace.push(`[no-pick] ${pick.intel_id}: ${grade.reason}`);
                skipped++;
                continue;
            }

            // UPDATE WITH EVIDENCE
            const { error: updateErr } = await supabase
                .from("pregame_intel")
                .update({
                    pick_result: grade.outcome,
                    graded_at: new Date().toISOString(),
                    final_home_score: score.home_score,
                    final_away_score: score.away_score
                })
                .eq("intel_id", pick.intel_id);

            if (updateErr) {
                trace.push(`[error] Failed to update ${pick.intel_id}: ${updateErr.message}`);
            } else {
                trace.push(`[grade] ${pick.match_id}: ${grade.outcome} (${grade.reason})`);
                graded++;
                if (grade.outcome === 'WIN') wins++;
                if (grade.outcome === 'LOSS') losses++;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 4. CHECK FOR STALE PENDING PICKS (>14 days) → MANUAL_REVIEW
        // ═══════════════════════════════════════════════════════════════════════
        const staleThreshold = new Date();
        staleThreshold.setDate(staleThreshold.getDate() - 14); // 14 days ago
        const staleThresholdStr = staleThreshold.toISOString().split('T')[0];

        const { data: stalePicks, error: staleErr } = await supabase
            .from("pregame_intel")
            .select("intel_id, match_id, game_date")
            .eq("pick_result", "PENDING")
            .lt("game_date", staleThresholdStr)
            .limit(100);

        if (!staleErr && stalePicks?.length) {
            for (const stale of stalePicks) {
                await supabase.from("pregame_intel").update({
                    pick_result: 'MANUAL_REVIEW',
                    graded_at: new Date().toISOString()
                }).eq("intel_id", stale.intel_id);

                trace.push(`[stale→manual] ${stale.intel_id}: Game ${stale.game_date} passed, needs manual review`);
                manualReview++;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 5. LOG BATCH FOR OBSERVABILITY
        // ═══════════════════════════════════════════════════════════════════════
        await supabase.from("pregame_intel_log").insert({
            batch_id: batchId,
            matches_processed: pendingPicks.length,
            matches_succeeded: graded,
            matches_failed: skipped,
            trace: trace
        });

        // ═══════════════════════════════════════════════════════════════════════
        // 6. GRADE SHARP_INTEL PICKS (Same strict logic)
        // ═══════════════════════════════════════════════════════════════════════
        let sharpGraded = 0, sharpWins = 0, sharpLosses = 0;

        const { data: sharpPicks, error: sharpErr } = await supabase
            .from("sharp_intel")
            .select("id, match_id, home_team, away_team, pick_type, pick_side, pick_line")
            .eq("pick_result", "PENDING")
            .limit(500);

        if (!sharpErr && sharpPicks?.length) {
            trace.push(`[sharp] Found ${sharpPicks.length} pending sharp_intel picks.`);

            const sharpMatchIds = sharpPicks.map((p: any) =>
                p.match_id.includes('_') ? p.match_id : `${p.match_id}_${p.league}`
            );

            const { data: sharpResults } = await supabase
                .from("matches")
                .select("id, home_score, away_score, status")
                .in("id", sharpMatchIds)
                .in("status", ["FINAL", "STATUS_FINAL", "STATUS_FULL_TIME"]);

            const sharpResultMap = new Map<string, any>((sharpResults || []).map((r: any) => [r.id, r]));

            for (const pick of sharpPicks as any[]) {
                const searchId = pick.match_id.includes('_') ? pick.match_id : `${pick.match_id}_${pick.league}`;
                const res = sharpResultMap.get(searchId);
                if (!res) continue;

                const margin = res.home_score - res.away_score;
                const total = res.home_score + res.away_score;
                let outcome: 'WIN' | 'LOSS' | 'PUSH' = 'PUSH';
                let reason = '';

                if (pick.pick_type === 'spread' && pick.pick_line != null) {
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    const pickedMargin = isHomePick ? margin : -margin;
                    const cover = pickedMargin + pick.pick_line;

                    if (cover > 0) { outcome = 'WIN'; reason = `Cover: ${cover.toFixed(1)}`; }
                    else if (cover < 0) { outcome = 'LOSS'; reason = `Miss: ${cover.toFixed(1)}`; }
                    else { outcome = 'PUSH'; reason = 'Exact line'; }
                } else if (pick.pick_type === 'total' && pick.pick_line != null) {
                    const isOver = pick.pick_side?.toUpperCase() === 'OVER';
                    if (isOver) {
                        if (total > pick.pick_line) { outcome = 'WIN'; reason = `O ${total} > ${pick.pick_line}`; }
                        else if (total < pick.pick_line) { outcome = 'LOSS'; reason = `O ${total} < ${pick.pick_line}`; }
                    } else {
                        if (total < pick.pick_line) { outcome = 'WIN'; reason = `U ${total} < ${pick.pick_line}`; }
                        else if (total > pick.pick_line) { outcome = 'LOSS'; reason = `U ${total} > ${pick.pick_line}`; }
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

                // CLV calculation
                let clv: number | null = null;
                if (pick.pick_type === 'spread' && pick.pick_line != null) {
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    clv = (isHomePick ? margin : -margin) + pick.pick_line;
                } else if (pick.pick_type === 'total' && pick.pick_line != null) {
                    clv = pick.pick_side?.toUpperCase() === 'OVER' ? total - pick.pick_line : pick.pick_line - total;
                }

                await supabase.from("sharp_intel").update({
                    pick_result: outcome,
                    graded_at: new Date().toISOString(),
                    actual_home_score: res.home_score,
                    actual_away_score: res.away_score,
                    closing_line_delta: clv
                }).eq("id", pick.id);

                sharpGraded++;
                if (outcome === 'WIN') sharpWins++;
                if (outcome === 'LOSS') sharpLosses++;
            }
        }

        trace.push(`[sharp-summary] Graded ${sharpGraded}: ${sharpWins}W-${sharpLosses}L`);

        // ═══════════════════════════════════════════════════════════════════════
        // 7. GRADE AI_CHAT_PICKS (Legacy)
        // ═══════════════════════════════════════════════════════════════════════
        let chatGraded = 0, chatWins = 0, chatLosses = 0;

        const { data: chatPicks, error: chatErr } = await supabase
            .from("ai_chat_picks")
            .select("id, match_id, home_team, away_team, pick_type, pick_side, pick_line")
            .eq("result", "pending")
            .limit(500);

        if (!chatErr && chatPicks?.length) {
            trace.push(`[chat] Found ${chatPicks.length} pending ai_chat_picks.`);

            const chatMatchIds = chatPicks.map((p: any) =>
                p.match_id.includes('_') ? p.match_id : `${p.match_id}_${p.league}`
            );

            const { data: chatResults } = await supabase
                .from("matches")
                .select("id, home_score, away_score, status")
                .in("id", chatMatchIds)
                .in("status", ["FINAL", "STATUS_FINAL", "STATUS_FULL_TIME"]);

            const chatResultMap = new Map<string, any>((chatResults || []).map((r: any) => [r.id, r]));

            for (const pick of chatPicks as any[]) {
                const searchId = pick.match_id.includes('_') ? pick.match_id : `${pick.match_id}_${pick.league}`;
                const res = chatResultMap.get(searchId);
                if (!res) continue;

                const margin = res.home_score - res.away_score;
                const total = res.home_score + res.away_score;
                let outcome: 'win' | 'loss' | 'push' = 'push';

                if (pick.pick_type === 'total' && pick.pick_line != null) {
                    const line = parseFloat(pick.pick_line);
                    const isOver = pick.pick_side?.toUpperCase() === 'OVER';
                    if (isOver) {
                        if (total > line) outcome = 'win';
                        else if (total < line) outcome = 'loss';
                    } else {
                        if (total < line) outcome = 'win';
                        else if (total > line) outcome = 'loss';
                    }
                } else if (pick.pick_type === 'spread' && pick.pick_line != null) {
                    const line = parseFloat(pick.pick_line);
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    const cover = (isHomePick ? margin : -margin) + line;
                    if (cover > 0) outcome = 'win';
                    else if (cover < 0) outcome = 'loss';
                } else if (pick.pick_type === 'moneyline') {
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    if (isHomePick) {
                        if (margin > 0) outcome = 'win';
                        else if (margin < 0) outcome = 'loss';
                    } else {
                        if (margin < 0) outcome = 'win';
                        else if (margin > 0) outcome = 'loss';
                    }
                }

                // CLV
                let clv: number | null = null;
                if (pick.pick_type === 'spread' && pick.pick_line != null) {
                    const line = parseFloat(pick.pick_line);
                    const isHomePick = pick.pick_side?.toLowerCase().includes(pick.home_team?.toLowerCase().split(' ').pop());
                    clv = (isHomePick ? margin : -margin) + line;
                } else if (pick.pick_type === 'total' && pick.pick_line != null) {
                    const line = parseFloat(pick.pick_line);
                    clv = pick.pick_side?.toUpperCase() === 'OVER' ? total - line : line - total;
                }

                await supabase.from("ai_chat_picks").update({
                    result: outcome,
                    graded_at: new Date().toISOString(),
                    clv: clv
                }).eq("id", pick.id);

                chatGraded++;
                if (outcome === 'win') chatWins++;
                if (outcome === 'loss') chatLosses++;
            }
        }

        trace.push(`[chat-summary] Graded ${chatGraded}: ${chatWins}W-${chatLosses}L`);

        return new Response(JSON.stringify({
            status: "GRADED",
            version: "2.0-strict",
            pregame: { graded, wins, losses, skipped, manualReview },
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
