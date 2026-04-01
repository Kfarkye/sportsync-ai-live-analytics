/**
 * NBA Live Totals Control Engine v3.0 - Backtest/Replay Harness
 * 
 * Replays ticks for a game and recomputes snapshots.
 * Verifies determinism by comparing against stored snapshots.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: any;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
};

// v3.0 Engine Constants (inline)
const CONFIG = {
    GAME_MINUTES: 48,
    FTA_COEFFICIENT: 0.44,
    EPM_PER_100_DIVISOR: 100,
    BASE_STD: 13.0,
    HIGH_3PA_THRESHOLD: 0.40,
    HIGH_3PA_STD_MULTIPLIER: 1.15,
    VOL_STD_MIN: 2.0,
    VOL_STD_MAX: 18.0,
    TIME_SCALAR_MIN: 0.20,
    TIME_SCALAR_MAX: 1.00,
    FOUL_EV_MAX: 14.0,
    FOUL_EV_THRESHOLD_MIN: 4.0,
    OT_SCORE_DIFF_THRESHOLD: 6,
    EXPECTED_OT_POINTS: 11.0,
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const safeDivide = (n: number, d: number, fb = 0) => (d === 0 ? fb : n / d);
const avg = (a: number, b: number) => (a + b) / 2;

function computeTeamPoss(fga: number, tov: number, fta: number, orb: number): number {
    return Math.max(0, fga + tov + 0.44 * fta - orb);
}

function computeLuckGap(
    threePA: number, threePM: number, fga: number, fgm: number,
    exp3pPct: number, exp2pPct: number
): number {
    const exp3pm = threePA * exp3pPct;
    const twoPA = fga - threePA;
    const twoPM = fgm - threePM;
    const exp2pm = twoPA * exp2pPct;
    return 3 * (exp3pm - threePM) + 2 * (exp2pm - twoPM);
}

function computeFoulEv(scoreDiff: number, remMin: number): number {
    if (remMin > CONFIG.FOUL_EV_THRESHOLD_MIN) return 0;
    const diffAbs = Math.abs(scoreDiff);
    if (diffAbs >= 1 && diffAbs <= 8 && remMin <= 2.0) {
        const prob = 0.3 + (2.0 - remMin) * 0.3 + (diffAbs <= 3 ? 0.15 : 0);
        const expPts = 4.0 + (1.0 - remMin) * 6.0;
        return clamp(prob * expPts, 0, CONFIG.FOUL_EV_MAX);
    }
    return 0;
}

function computeOtEv(scoreDiff: number, remMin: number): number {
    const diffAbs = Math.abs(scoreDiff);
    if (diffAbs > CONFIG.OT_SCORE_DIFF_THRESHOLD) return 0;
    let prob = 0;
    if (diffAbs === 0 && remMin <= 0.5) prob = 0.4;
    else if (diffAbs <= 2 && remMin <= 1.0) prob = 0.15 - diffAbs * 0.03;
    else if (diffAbs <= 6 && remMin <= 3.0) prob = Math.max(0, 0.10 - diffAbs * 0.015 - remMin * 0.02);
    return clamp(prob * CONFIG.EXPECTED_OT_POINTS, 0, 10);
}

function computeControlTable(input: any): any {
    const possHome = computeTeamPoss(input.home_fga, input.home_tov, input.home_fta, input.home_orb);
    const possAway = computeTeamPoss(input.away_fga, input.away_tov, input.away_fta, input.away_orb);
    const possLive = (possHome + possAway) / 2;

    const livePace48 = input.elapsed_min > 0
        ? (possLive / input.elapsed_min) * CONFIG.GAME_MINUTES
        : input.pace_pre48;
    const w = clamp(input.elapsed_min / CONFIG.GAME_MINUTES, 0, 1);
    const paceBlend48 = livePace48 * w + input.pace_pre48 * (1 - w);
    const remPoss = (input.rem_min / CONFIG.GAME_MINUTES) * paceBlend48;

    const anchorPpp = safeDivide(input.close_total, input.pace_pre48, 2.0);

    const luckHome = computeLuckGap(
        input.home_3pa, input.home_3pm, input.home_fga, input.home_fgm,
        input.exp_3p_pct_home, input.exp_2p_pct_home
    );
    const luckAway = computeLuckGap(
        input.away_3pa, input.away_3pm, input.away_fga, input.away_fgm,
        input.exp_3p_pct_away, input.exp_2p_pct_away
    );
    const luckGap = luckHome + luckAway;

    const structPppHome = possHome > 0 ? (input.pts_home + luckHome) / possHome : anchorPpp;
    const structPppAway = possAway > 0 ? (input.pts_away + luckAway) / possAway : anchorPpp;
    const structPpp = avg(structPppHome, structPppAway);

    const projPpp = structPpp * w + anchorPpp * (1 - w);

    const homeLineupAdj = (input.sum_epm_home - input.avg_epm_home) / CONFIG.EPM_PER_100_DIVISOR;
    const awayLineupAdj = (input.sum_epm_away - input.avg_epm_away) / CONFIG.EPM_PER_100_DIVISOR;
    const lineupAdjPpp = avg(homeLineupAdj, awayLineupAdj);

    const currentScore = input.pts_home + input.pts_away;
    const rawProj = currentScore + remPoss * (projPpp + lineupAdjPpp);

    const scoreDiff = input.pts_home - input.pts_away;
    const foulEv = computeFoulEv(scoreDiff, input.rem_min);
    const otEv = computeOtEv(scoreDiff, input.rem_min);

    const modelFair = rawProj + foulEv + otEv;

    const threeParateGame = safeDivide(
        input.home_3pa + input.away_3pa,
        input.home_fga + input.away_fga,
        0.35
    );
    let baseStd = CONFIG.BASE_STD;
    if (threeParateGame > CONFIG.HIGH_3PA_THRESHOLD) {
        baseStd *= CONFIG.HIGH_3PA_STD_MULTIPLIER;
    }
    const timeScalar = clamp(Math.sqrt(Math.max(1, remPoss) / 100), CONFIG.TIME_SCALAR_MIN, CONFIG.TIME_SCALAR_MAX);
    const volStd = clamp(baseStd * timeScalar, CONFIG.VOL_STD_MIN, CONFIG.VOL_STD_MAX);

    const edgeZ = safeDivide(modelFair - input.live_market_total, volStd, 0);

    return {
        anchor_ppp: anchorPpp,
        poss_live: possLive,
        live_pace_48: livePace48,
        pace_blend_48: paceBlend48,
        rem_poss: remPoss,
        luck_gap: luckGap,
        struct_ppp: structPpp,
        proj_ppp: projPpp,
        lineup_adj_ppp: lineupAdjPpp,
        raw_proj: rawProj,
        foul_ev: foulEv,
        ot_ev: otEv,
        model_fair: modelFair,
        live_mkt: input.live_market_total,
        edge_z: edgeZ,
        vol_std: volStd,
    };
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: CORS_HEADERS });
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    try {
        const { gameId, verifyAgainstStored = true, tolerance = 0.01 } = await req.json();

        if (!gameId) {
            return new Response(JSON.stringify({ error: "Missing gameId" }), {
                status: 400,
                headers: CORS_HEADERS,
            });
        }

        // Fetch game
        const { data: game, error: gameError } = await supabase
            .from("nba_games")
            .select("*")
            .eq("game_id", gameId)
            .single();

        if (gameError || !game) {
            return new Response(JSON.stringify({ error: "Game not found" }), {
                status: 404,
                headers: CORS_HEADERS,
            });
        }

        // Fetch all ticks in order
        const { data: ticks, error: tickError } = await supabase
            .from("nba_ticks")
            .select("*")
            .eq("game_id", gameId)
            .order("ts", { ascending: true });

        if (tickError || !ticks || ticks.length === 0) {
            return new Response(JSON.stringify({ error: "No ticks found" }), {
                status: 404,
                headers: CORS_HEADERS,
            });
        }

        // Fetch stored snapshots for comparison
        const { data: storedSnapshots } = await supabase
            .from("nba_snapshots")
            .select("*")
            .eq("game_id", gameId)
            .order("ts", { ascending: true });

        const storedMap = new Map(
            (storedSnapshots || []).map((s: any) => [s.tick_id, s])
        );

        // Fetch priors
        const season = game.season || "2024-25";
        const { data: homeP } = await supabase
            .from("nba_team_priors")
            .select("*")
            .eq("season", season)
            .eq("team", game.home_team)
            .single();

        const { data: awayP } = await supabase
            .from("nba_team_priors")
            .select("*")
            .eq("season", season)
            .eq("team", game.away_team)
            .single();

        const homePriors = homeP || { exp_3p_pct: 0.36, exp_2p_pct: 0.52 };
        const awayPriors = awayP || { exp_3p_pct: 0.36, exp_2p_pct: 0.52 };

        // Replay each tick
        const replayResults: any[] = [];
        const mismatches: any[] = [];

        for (const tick of ticks) {
            const engineInput = {
                ...tick,
                close_total: game.close_total || 220,
                pace_pre48: game.pace_pre48 || 100,
                exp_3p_pct_home: homePriors.exp_3p_pct,
                exp_2p_pct_home: homePriors.exp_2p_pct,
                exp_3p_pct_away: awayPriors.exp_3p_pct,
                exp_2p_pct_away: awayPriors.exp_2p_pct,
                sum_epm_home: 0,
                avg_epm_home: 0,
                sum_epm_away: 0,
                avg_epm_away: 0,
                live_market_total: game.close_total || 220,
            };

            const recomputed = computeControlTable(engineInput);

            replayResults.push({
                tickId: tick.tick_id,
                ts: tick.ts,
                ...recomputed,
            });

            // Verify against stored
            if (verifyAgainstStored) {
                const stored = storedMap.get(tick.tick_id);
                if (stored) {
                    const fields = ["model_fair", "edge_z", "rem_poss", "luck_gap", "struct_ppp"];
                    for (const field of fields) {
                        const diff = Math.abs(recomputed[field] - stored[field]);
                        if (diff > tolerance) {
                            mismatches.push({
                                tickId: tick.tick_id,
                                field,
                                stored: stored[field],
                                recomputed: recomputed[field],
                                diff,
                            });
                        }
                    }
                }
            }
        }

        const isDeterministic = mismatches.length === 0;

        return new Response(JSON.stringify({
            success: true,
            gameId,
            tickCount: ticks.length,
            isDeterministic,
            mismatches: mismatches.slice(0, 20), // Limit output
            summary: {
                firstTick: replayResults[0],
                lastTick: replayResults[replayResults.length - 1],
            },
        }), {
            headers: CORS_HEADERS,
        });

    } catch (error: any) {
        console.error("[nba-backtest] Error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: CORS_HEADERS,
        });
    }
});
