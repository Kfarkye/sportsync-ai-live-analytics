declare const Deno: any;

/**
 * GRADE PICKS CRON v2.3.1 (Merged Production Release)
 * FEATURES:
 * - Strict Tennis Logic (Sets for ML, Games for Spread/Total)
 * - Sharp Intel Grading (Restored)
 * - AI Chat Grading (Restored)
 * - Stale Pick -> Manual Review (Restored)
 * - Canonical Team Name Matching (Restored)
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

interface ScoreBundle {
    id?: string;
    home_team: string;
    away_team: string;
    homeScore: number;
    awayScore: number;
    homeGames?: number;
    awayGames?: number;
    isTennis: boolean;
    completed: boolean;
}

interface OddsAPIScore {
    id: string;
    home_team: string;
    away_team: string;
    home_score: number;
    away_score: number;
    completed: boolean;
    sport_key: string;
}

async function fetchOddsAPIScores(sport: string): Promise<Map<string, OddsAPIScore>> {
    const scoreMap = new Map<string, OddsAPIScore>();
    try {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return scoreMap;
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
                completed: true,
                sport_key: sport
            });
        }
    } catch (err: any) { console.error(`[odds-api] Error ${sport}:`, err.message); }
    return scoreMap;
}

function normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function alignScoreToPick(pick: PendingPick, score: ScoreBundle): ScoreBundle {
    const pickHome = normalizeName(pick.home_team);
    const scoreHome = normalizeName(score.home_team);
    const scoreAway = normalizeName(score.away_team);

    if (scoreHome.includes(pickHome) || pickHome.includes(scoreHome)) return score;

    if (scoreAway.includes(pickHome) || pickHome.includes(scoreAway)) {
        return {
            ...score,
            home_team: score.away_team,
            away_team: score.home_team,
            homeScore: score.awayScore,
            awayScore: score.homeScore,
            homeGames: score.awayGames,
            awayGames: score.homeGames
        };
    }
    return score;
}

function gradePick(pick: PendingPick, score: ScoreBundle): { outcome: 'WIN' | 'LOSS' | 'PUSH' | 'NO_PICK', reason: string } {
    const meta = pick.grading_metadata;
    if (!meta || !meta.side) return { outcome: 'NO_PICK', reason: 'Missing metadata' };

    let effectiveType = meta.type;
    if (pick.recommended_pick) {
        const txt = pick.recommended_pick.toLowerCase();
        if (txt.includes('moneyline') || txt.includes('ml ')) effectiveType = 'MONEYLINE';
        else if (txt.includes('over ') || txt.includes('under ') || txt.includes('games')) effectiveType = 'TOTAL';
    }

    let homeVal = score.homeScore, awayVal = score.awayScore, metric = 'points/sets';

    if (score.isTennis) {
        if (effectiveType === 'SPREAD' || effectiveType === 'TOTAL') {
            if (score.homeGames !== undefined && score.awayGames !== undefined && (score.homeGames > 0 || score.awayGames > 0)) {
                homeVal = score.homeGames;
                awayVal = score.awayGames;
                metric = 'games';
            } else {
                return { outcome: 'NO_PICK', reason: 'Tennis Spread/Total requires Game counts' };
            }
        }
    }

    const margin = homeVal - awayVal;
    const total = homeVal + awayVal;

    if (effectiveType === 'SPREAD') {
        let pickedTeamSpread: number | null = null;
        if (pick.recommended_pick) {
            const text = pick.recommended_pick.toLowerCase();
            if (text.includes('pk') || text.includes("pick'em") || text.includes('dnb')) pickedTeamSpread = 0;
            else {
                const matches = pick.recommended_pick.match(/([+-]?\d+\.?\d*)/g);
                if (matches) {
                    const limit = score.isTennis ? 50 : 30;
                    const candidates = matches.map(m => parseFloat(m)).filter(n => !isNaN(n) && Math.abs(n) <= limit);
                    if (candidates.length > 0) {
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
        }

        if (pickedTeamSpread === null && pick.analyzed_spread !== null) {
            pickedTeamSpread = meta.side === 'HOME' ? pick.analyzed_spread : (pick.analyzed_spread < 0 ? pick.analyzed_spread : -pick.analyzed_spread);
        }

        if (pickedTeamSpread === null) return { outcome: 'NO_PICK', reason: 'No spread found' };

        const pickedTeamMargin = meta.side === 'HOME' ? margin : -margin;
        const coverMargin = pickedTeamMargin + pickedTeamSpread;

        if (coverMargin > 0) return { outcome: 'WIN', reason: `Cover (${metric})` };
        if (coverMargin < 0) return { outcome: 'LOSS', reason: `Miss (${metric})` };
        return { outcome: 'PUSH', reason: 'Exact line' };
    }

    if (effectiveType === 'TOTAL') {
        const line = pick.analyzed_total;
        if (line == null) return { outcome: 'NO_PICK', reason: 'No total' };
        if (meta.side === 'OVER') {
            if (total > line) return { outcome: 'WIN', reason: `O ${total}` };
            if (total < line) return { outcome: 'LOSS', reason: `O ${total}` };
        } else {
            if (total < line) return { outcome: 'WIN', reason: `U ${total}` };
            if (total > line) return { outcome: 'LOSS', reason: `U ${total}` };
        }
        return { outcome: 'PUSH', reason: 'Exact total' };
    }

    if (effectiveType === 'MONEYLINE') {
        if (margin === 0) return { outcome: 'PUSH', reason: 'Tie' };
        if (meta.side === 'HOME') {
            return margin > 0 ? { outcome: 'WIN', reason: `Home won (${metric})` } : { outcome: 'LOSS', reason: `Home lost (${metric})` };
        } else {
            return margin < 0 ? { outcome: 'WIN', reason: `Away won (${metric})` } : { outcome: 'LOSS', reason: `Away lost (${metric})` };
        }
    }

    return { outcome: 'NO_PICK', reason: 'Unknown bet type' };
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { autoRefreshToken: false, persistSession: false } });

    const batchId = `grade_${Date.now()}`;
    const trace: string[] = [];
    let graded = 0, wins = 0, losses = 0, skipped = 0, manualReview = 0;

    try {
        trace.push(`[boot] Grade Picks Cron v2.3.1 Started: ${batchId}`);

        const sports = ['basketball_ncaab', 'basketball_nba', 'soccer_epl', 'soccer_italy_serie_a', 'soccer_germany_bundesliga', 'soccer_france_ligue_one', 'icehockey_nhl', 'tennis_atp', 'tennis_wta'];

        const allScores = new Map<string, OddsAPIScore>();
        await Promise.all(sports.map(async (sport) => {
            const scores = await fetchOddsAPIScores(sport);
            scores.forEach((val, key) => allScores.set(key, val));
        }));

        const { data: pendingPicks, error: pickErr } = await supabase
            .from("pregame_intel")
            .select("intel_id, match_id, odds_event_id, home_team, away_team, analyzed_spread, analyzed_total, grading_metadata, recommended_pick, game_date")
            .eq("pick_result", "PENDING")
            .not("recommended_pick", "is", null)
            .order('game_date', { ascending: true })
            .limit(100);

        if (pickErr) throw pickErr;
        if (!pendingPicks?.length) return new Response(JSON.stringify({ status: "NO_PENDING", trace }), { headers: CORS_HEADERS });

        const { data: allMappings } = await supabase.from('canonical_teams').select('canonical_name, odds_api_name, league_id');
        const teamMap = new Map<string, string>();
        if (allMappings) {
            for (const m of allMappings) {
                teamMap.set(`${m.league_id}:${m.odds_api_name.toLowerCase().trim()}`, m.canonical_name);
                teamMap.set(`${m.league_id}:${m.canonical_name.toLowerCase().trim()}`, m.canonical_name);
            }
        }
        const resolveTeam = (name: string, leagueId: string) => {
            if (!name) return null;
            return teamMap.get(`${leagueId}:${name.toLowerCase().trim()}`) || name.trim();
        };

        for (const pick of pendingPicks as PendingPick[]) {
            const isTennis = pick.match_id.includes('tennis') || pick.match_id.includes('atp') || pick.match_id.includes('wta');

            if (!pick.grading_metadata?.side) {
                skipped++; continue;
            }

            let scoreBundle: ScoreBundle | null = null;
            let source = 'none';

            if (isTennis) {
                const { data: matchData } = await supabase.from('matches').select('home_score, away_score, extra_data, status').eq('id', pick.match_id).single();
                if (matchData && (matchData.status?.includes('FINAL') || matchData.status?.includes('COMPLETED') || matchData.status === 'post')) {
                    scoreBundle = {
                        home_team: pick.home_team, away_team: pick.away_team,
                        homeScore: matchData.home_score, awayScore: matchData.away_score,
                        homeGames: matchData.extra_data?.home_games_won, awayGames: matchData.extra_data?.away_games_won,
                        isTennis: true, completed: true
                    };
                    source = 'db_tennis';
                }
            }

            if (!scoreBundle && pick.odds_event_id && allScores.has(pick.odds_event_id)) {
                const os = allScores.get(pick.odds_event_id)!;
                scoreBundle = {
                    id: os.id, home_team: os.home_team, away_team: os.away_team,
                    homeScore: os.home_score, awayScore: os.away_score, isTennis, completed: true
                };
                source = 'odds_api_direct';
            }

            if (!scoreBundle && !isTennis) {
                const leagueId = pick.match_id.includes('nba') ? 'basketball_nba' : (pick.match_id.includes('ncaab') ? 'basketball_ncaab' : null);

                if (leagueId) {
                    const pickHome = resolveTeam(pick.home_team, leagueId);
                    const pickAway = resolveTeam(pick.away_team, leagueId);

                    for (const [key, val] of allScores) {
                        if (val.sport_key !== leagueId) continue;
                        const sHome = resolveTeam(val.home_team, leagueId);
                        const sAway = resolveTeam(val.away_team, leagueId);
                        if (pickHome === sHome && pickAway === sAway) {
                            scoreBundle = { home_team: val.home_team, away_team: val.away_team, homeScore: val.home_score, awayScore: val.away_score, isTennis: false, completed: true };
                            source = 'odds_api_canonical';
                            break;
                        }
                    }
                }
            }

            if (!scoreBundle || (isTennis && scoreBundle.homeGames === undefined && pick.grading_metadata.type !== 'MONEYLINE')) {
                try {
                    const espnId = pick.match_id.split('_')[0];
                    let endpoint = '';
                    if (isTennis) endpoint = pick.match_id.includes('wta') ? 'tennis/wta' : 'tennis/atp';
                    else if (pick.match_id.includes('ncaab')) endpoint = 'basketball/mens-college-basketball';
                    else if (pick.match_id.includes('nba')) endpoint = 'basketball/nba';
                    else if (pick.match_id.includes('nhl')) endpoint = 'hockey/nhl';
                    else if (pick.match_id.includes('epl')) endpoint = 'soccer/eng.1';

                    if (endpoint) {
                        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${endpoint}/summary?event=${espnId}`, { signal: AbortSignal.timeout(5000) });
                        if (res.ok) {
                            const data = await res.json();
                            const comp = data.header?.competitions?.[0];
                            const status = comp?.status?.type?.name || comp?.status?.type?.state;
                            if (['STATUS_FINAL', 'Final', 'post', 'STATUS_FULL_TIME'].includes(status)) {
                                const h = comp.competitors.find((c: any) => c.homeAway === 'home');
                                const a = comp.competitors.find((c: any) => c.homeAway === 'away');

                                let hGames = 0, aGames = 0;
                                if (isTennis && h.linescores) {
                                    hGames = h.linescores.reduce((x: number, y: any) => x + (parseInt(y.value) || 0), 0);
                                    aGames = a.linescores.reduce((x: number, y: any) => x + (parseInt(y.value) || 0), 0);
                                }

                                scoreBundle = {
                                    home_team: h.team?.displayName || h.athlete?.displayName,
                                    away_team: a.team?.displayName || a.athlete?.displayName,
                                    homeScore: parseInt(h.score),
                                    awayScore: parseInt(a.score),
                                    homeGames: isTennis ? hGames : undefined,
                                    awayGames: isTennis ? aGames : undefined,
                                    isTennis,
                                    completed: true
                                };
                                source = 'espn_fallback';

                                await supabase.from("matches").update({
                                    status: 'STATUS_FINAL', home_score: scoreBundle.homeScore, away_score: scoreBundle.awayScore,
                                    extra_data: isTennis ? { home_games_won: hGames, away_games_won: aGames } : undefined
                                }).eq("id", pick.match_id);
                            }
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            if (!scoreBundle) {
                skipped++; continue;
            }

            scoreBundle = alignScoreToPick(pick, scoreBundle);
            const result = gradePick(pick, scoreBundle);

            if (result.outcome !== 'NO_PICK') {
                await supabase.from("pregame_intel").update({
                    pick_result: result.outcome,
                    graded_at: new Date().toISOString(),
                    final_home_score: scoreBundle.homeScore,
                    final_away_score: scoreBundle.awayScore
                }).eq("intel_id", pick.intel_id);

                trace.push(`[grade] ${pick.match_id} (${source}): ${result.outcome}`);
                graded++;
                if (result.outcome === 'WIN') wins++;
                if (result.outcome === 'LOSS') losses++;
            } else {
                trace.push(`[skip] ${pick.intel_id}: ${result.reason}`);
                skipped++;
            }
        }

        const staleDate = new Date();
        staleDate.setDate(staleDate.getDate() - 14);
        const staleStr = staleDate.toISOString().split('T')[0];
        const { data: stalePicks } = await supabase.from("pregame_intel").select("intel_id").eq("pick_result", "PENDING").lt("game_date", staleStr).limit(100);

        if (stalePicks?.length) {
            for (const s of stalePicks) {
                await supabase.from("pregame_intel").update({ pick_result: 'MANUAL_REVIEW', graded_at: new Date().toISOString() }).eq("intel_id", s.intel_id);
                manualReview++;
            }
        }

        let sharpGraded = 0;
        const { data: sharpPicks } = await supabase.from("sharp_intel").select("*").eq("pick_result", "PENDING").limit(200);
        if (sharpPicks?.length) {
            const sharpIds = sharpPicks.map((p: any) => p.match_id.includes('_') ? p.match_id : `${p.match_id}_${p.league}`);
            const { data: matches } = await supabase.from("matches").select("id, home_score, away_score, status").in("id", sharpIds).in("status", ["FINAL", "STATUS_FINAL", "STATUS_FULL_TIME", "post"]);
            const matchMap = new Map((matches || []).map((m: any) => [m.id, m]));

            for (const sp of sharpPicks) {
                const mid = sp.match_id.includes('_') ? sp.match_id : `${sp.match_id}_${sp.league}`;
                const m = matchMap.get(mid);
                if (!m) continue;

                let outcome = 'PUSH';
                const margin = m.home_score - m.away_score;
                const total = m.home_score + m.away_score;
                let clv: number | null = null;

                if (sp.pick_type === 'spread' && sp.pick_line != null) {
                    const isHome = sp.pick_side?.toLowerCase().includes(sp.home_team?.toLowerCase().split(' ').pop());
                    const cover = (isHome ? margin : -margin) + sp.pick_line;
                    if (cover > 0) outcome = 'WIN'; else if (cover < 0) outcome = 'LOSS';
                    clv = (isHome ? margin : -margin) + sp.pick_line;
                } else if (sp.pick_type === 'total' && sp.pick_line != null) {
                    const isOver = sp.pick_side?.toUpperCase() === 'OVER';
                    if (isOver) outcome = total > sp.pick_line ? 'WIN' : (total < sp.pick_line ? 'LOSS' : 'PUSH');
                    else outcome = total < sp.pick_line ? 'WIN' : (total > sp.pick_line ? 'LOSS' : 'PUSH');
                    clv = isOver ? total - sp.pick_line : sp.pick_line - total;
                } else if (sp.pick_type === 'moneyline') {
                    const isHome = sp.pick_side?.toLowerCase().includes(sp.home_team?.toLowerCase().split(' ').pop());
                    if (isHome) outcome = margin > 0 ? 'WIN' : (margin < 0 ? 'LOSS' : 'PUSH');
                    else outcome = margin < 0 ? 'WIN' : (margin > 0 ? 'LOSS' : 'PUSH');
                }

                await supabase.from("sharp_intel").update({
                    pick_result: outcome,
                    graded_at: new Date().toISOString(),
                    actual_home_score: m.home_score,
                    actual_away_score: m.away_score,
                    closing_line_delta: clv
                }).eq("id", sp.id);
                sharpGraded++;
            }
        }

        let chatGraded = 0;
        const { data: chatPicks } = await supabase.from("ai_chat_picks").select("*").eq("result", "pending").limit(200);
        if (chatPicks?.length) {
            const ids = chatPicks.map(p => p.match_id.includes('_') ? p.match_id : `${p.match_id}_${p.league}`);
            const { data: mRes } = await supabase.from("matches").select("id, home_score, away_score, status").in("id", ids).in("status", ["FINAL", "STATUS_FINAL", "STATUS_FULL_TIME"]);
            const mMap = new Map(mRes?.map(m => [m.id, m]));

            for (const p of chatPicks) {
                const mid = p.match_id.includes('_') ? p.match_id : `${p.match_id}_${p.league}`;
                const m = mMap.get(mid);
                if (!m) continue;
                let outcome = 'push';
                const margin = m.home_score - m.away_score;
                const total = m.home_score + m.away_score;
                let clv: number | null = null;

                if (p.pick_type === 'spread' && p.pick_line != null) {
                    const line = parseFloat(p.pick_line);
                    const isHome = p.pick_side?.toLowerCase().includes(p.home_team?.toLowerCase().split(' ').pop());
                    const cover = (isHome ? margin : -margin) + line;
                    outcome = cover > 0 ? 'win' : (cover < 0 ? 'loss' : 'push');
                    clv = (isHome ? margin : -margin) + line;
                } else if (p.pick_type === 'total' && p.pick_line != null) {
                    const line = parseFloat(p.pick_line);
                    const isOver = p.pick_side?.toUpperCase() === 'OVER';
                    outcome = isOver ? (total > line ? 'win' : 'loss') : (total < line ? 'win' : 'loss');
                    if (total === line) outcome = 'push';
                    clv = isOver ? total - line : line - total;
                }

                await supabase.from("ai_chat_picks").update({
                    result: outcome,
                    graded_at: new Date().toISOString(),
                    clv: clv
                }).eq("id", p.id);
                chatGraded++;
            }
        }

        await supabase.from("pregame_intel_log").insert({
            batch_id: batchId, matches_processed: pendingPicks.length, matches_succeeded: graded, matches_failed: skipped, trace
        });

        return new Response(JSON.stringify({
            status: "GRADED",
            stats: { pregame: graded, sharp: sharpGraded, chat: chatGraded, manual: manualReview, skipped },
            trace
        }), { headers: CORS_HEADERS });

    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message, trace }), { status: 500, headers: CORS_HEADERS });
    }
});