/**
 * nba-run-model - Supabase Edge Function
 * 
 * Runs the v3.0 Control Table engine on the latest tick for each live game:
 * - Joins games, ticks, priors, and EPM data
 * - Computes snapshot via computeControlTable
 * - Persists to nba_snapshots
 * - Evaluates triggers and logs decisions to nba_decisions
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: any;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
};

// v3.0 Engine Constants (inline for Edge Function)
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
    EDGE_Z_THRESHOLD: 1.5,
    EARLY_GAME_MINUTES: 6,
    EARLY_GAME_Z_THRESHOLD: 2.0,
    CONFIRMATION_TICKS: 2,
    DECISION_COOLDOWN_SECONDS: 60,
};

// 3-Window Signal System: The 3 moments with highest edge potential
// Based on when market inefficiencies are largest before correction
const SIGNAL_WINDOWS = {
    WINDOW_1: {
        number: 1,
        name: 'Q1_END',
        minElapsed: 10,   // At least 10 min
        maxElapsed: 14,   // No later than 14 min  
        edgeThreshold: 1.5, // Higher threshold early (more variance)
    },
    WINDOW_2: {
        number: 2,
        name: 'HALFTIME',
        minElapsed: 22,   // At least 22 min
        maxElapsed: 26,   // No later than 26 min
        edgeThreshold: 1.2, // Medium threshold
    },
    WINDOW_3: {
        number: 3,
        name: 'Q3_END',
        minElapsed: 34,   // End of Q3
        maxElapsed: 40,   // Through first 2-3 min of Q4 (~8 min remaining)
        edgeThreshold: 1.0,
    },
};

// Utility functions
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const safeDivide = (n: number, d: number, fb = 0) => (d === 0 ? fb : n / d);
const avg = (a: number, b: number) => (a + b) / 2;

// Compute team possessions
function computeTeamPoss(fga: number, tov: number, fta: number, orb: number): number {
    return Math.max(0, fga + tov + 0.44 * fta - orb);
}

// Compute luck gap for a team
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

// Compute foul EV (simplified)
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

// Compute OT EV (simplified)
function computeOtEv(scoreDiff: number, remMin: number): number {
    const diffAbs = Math.abs(scoreDiff);
    if (diffAbs > CONFIG.OT_SCORE_DIFF_THRESHOLD) return 0;
    let prob = 0;
    if (diffAbs === 0 && remMin <= 0.5) prob = 0.4;
    else if (diffAbs <= 2 && remMin <= 1.0) prob = 0.15 - diffAbs * 0.03;
    else if (diffAbs <= 6 && remMin <= 3.0) prob = Math.max(0, 0.10 - diffAbs * 0.015 - remMin * 0.02);
    return clamp(prob * CONFIG.EXPECTED_OT_POINTS, 0, 10);
}

// Main v3.0 engine computation
function computeControlTable(input: any): any {
    // Possessions
    const possHome = computeTeamPoss(
        input.home_fga, input.home_tov, input.home_fta, input.home_orb
    );
    const possAway = computeTeamPoss(
        input.away_fga, input.away_tov, input.away_fta, input.away_orb
    );
    const possLive = (possHome + possAway) / 2;

    // Pace
    const livePace48 = input.elapsed_min > 0
        ? (possLive / input.elapsed_min) * CONFIG.GAME_MINUTES
        : input.pace_pre48;
    const w = clamp(input.elapsed_min / CONFIG.GAME_MINUTES, 0, 1);
    const paceBlend48 = livePace48 * w + input.pace_pre48 * (1 - w);
    const remPoss = (input.rem_min / CONFIG.GAME_MINUTES) * paceBlend48;

    // Anchor PPP
    const anchorPpp = safeDivide(input.close_total / 2, input.pace_pre48, 1.1);

    // Luck gaps
    const luckHome = computeLuckGap(
        input.home_3pa, input.home_3pm, input.home_fga, input.home_fgm,
        input.exp_3p_pct_home, input.exp_2p_pct_home
    );
    const luckAway = computeLuckGap(
        input.away_3pa, input.away_3pm, input.away_fga, input.away_fgm,
        input.exp_3p_pct_away, input.exp_2p_pct_away
    );
    const luckGap = luckHome + luckAway;

    // Structural PPP
    const structPppHome = possHome > 0 ? (input.pts_home + luckHome) / possHome : anchorPpp;
    const structPppAway = possAway > 0 ? (input.pts_away + luckAway) / possAway : anchorPpp;
    const structPpp = avg(structPppHome, structPppAway);

    // Projection PPP
    const projPpp = structPpp * w + anchorPpp * (1 - w);

    // Lineup adjustment
    const homeLineupAdj = (input.sum_epm_home - input.avg_epm_home) / CONFIG.EPM_PER_100_DIVISOR;
    const awayLineupAdj = (input.sum_epm_away - input.avg_epm_away) / CONFIG.EPM_PER_100_DIVISOR;
    const lineupAdjPpp = avg(homeLineupAdj, awayLineupAdj);

    // Raw projection
    const currentScore = input.pts_home + input.pts_away;
    const rawProj = currentScore + remPoss * (projPpp + lineupAdjPpp) * 2;

    // Endgame EV
    const scoreDiff = input.pts_home - input.pts_away;
    const foulEv = computeFoulEv(scoreDiff, input.rem_min);
    const otEv = computeOtEv(scoreDiff, input.rem_min);

    // Model fair
    const modelFair = rawProj + foulEv + otEv;

    // Volatility
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

    // Edge Z
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
        const body = await req.json().catch(() => ({}));
        const { gameId, liveMarketTotal } = body;

        // Fetch latest tick
        let tickQuery = supabase
            .from("nba_ticks")
            .select("*")
            .order("ts", { ascending: false })
            .limit(1);

        if (gameId) {
            tickQuery = tickQuery.eq("game_id", gameId);
        }

        const { data: tick, error: tickError } = await tickQuery.single();
        if (tickError || !tick) {
            return new Response(JSON.stringify({ error: "No tick found", details: tickError }), {
                status: 404,
                headers: CORS_HEADERS,
            });
        }

        // Fetch game data
        const { data: game, error: gameError } = await supabase
            .from("nba_games")
            .select("*")
            .eq("game_id", tick.game_id)
            .single();

        if (gameError || !game) {
            return new Response(JSON.stringify({ error: "Game not found" }), {
                status: 404,
                headers: CORS_HEADERS,
            });
        }

        // Fetch team priors
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

        // Default priors if not found
        const homePriors = homeP || { exp_3p_pct: 0.36, exp_2p_pct: 0.52 };
        const awayPriors = awayP || { exp_3p_pct: 0.36, exp_2p_pct: 0.52 };

        // Compute EPM sums (simplified - would need lineup data for real implementation)
        const sumEpmHome = 0; // TODO: Sum EPM for home on-court players
        const avgEpmHome = 0; // TODO: Average EPM for home roster
        const sumEpmAway = 0;
        const avgEpmAway = 0;

        // Build engine input
        const engineInput = {
            ...tick,
            close_total: game.close_total || 220,
            pace_pre48: game.pace_pre48 || 100,
            exp_3p_pct_home: homePriors.exp_3p_pct,
            exp_2p_pct_home: homePriors.exp_2p_pct,
            exp_3p_pct_away: awayPriors.exp_3p_pct,
            exp_2p_pct_away: awayPriors.exp_2p_pct,
            sum_epm_home: sumEpmHome,
            avg_epm_home: avgEpmHome,
            sum_epm_away: sumEpmAway,
            avg_epm_away: avgEpmAway,
            live_market_total: liveMarketTotal || game.close_total || 220,
        };

        // Compute snapshot
        const snapshot = computeControlTable(engineInput);

        // Persist snapshot
        const snapshotRow = {
            game_id: tick.game_id,
            tick_id: tick.tick_id,
            ts: tick.ts,
            ...snapshot,
            model_total_prediction: snapshot.model_fair, // Alias for UI compatibility
        };

        const { data: savedSnapshot, error: snapError } = await supabase
            .from("nba_snapshots")
            .upsert(snapshotRow, { onConflict: "game_id,tick_id" })
            .select("snapshot_id")
            .single();

        if (snapError) {
            console.error("[nba-run-model] Snapshot error:", snapError);
        }

        // ========================================
        // COMPREHENSIVE DATA LOGGING
        // ========================================

        // Log to model predictions history
        await supabase.from("nba_model_predictions").insert({
            game_id: tick.game_id,
            elapsed_min: tick.elapsed_min,
            current_total: tick.pts_home + tick.pts_away,
            live_market_line: engineInput.live_market_total,
            opening_line: game.close_total || 220,
            anchor_ppp: snapshot.anchor_ppp,
            poss_live: snapshot.poss_live,
            live_pace_48: snapshot.live_pace_48,
            pace_blend_48: snapshot.pace_blend_48,
            rem_poss: snapshot.rem_poss,
            struct_ppp: snapshot.struct_ppp,
            proj_ppp: snapshot.proj_ppp,
            luck_gap: snapshot.luck_gap,
            lineup_adj_ppp: snapshot.lineup_adj_ppp,
            foul_ev: snapshot.foul_ev,
            ot_ev: snapshot.ot_ev,
            vol_std: snapshot.vol_std,
            model_fair: snapshot.model_fair,
            edge_points: snapshot.model_fair - engineInput.live_market_total,
            edge_z: snapshot.edge_z,
        }).then(() => { }).catch(e => console.error("[LOG] model_predictions:", e.message));

        // Log to game state history
        await supabase.from("nba_game_state_history").insert({
            game_id: tick.game_id,
            elapsed_min: tick.elapsed_min,
            pts_home: tick.pts_home,
            pts_away: tick.pts_away,
            home_fgm: tick.home_fgm,
            home_fga: tick.home_fga,
            home_3pm: tick.home_3pm,
            home_3pa: tick.home_3pa,
            home_ftm: tick.home_ftm,
            home_fta: tick.home_fta,
            away_fgm: tick.away_fgm,
            away_fga: tick.away_fga,
            away_3pm: tick.away_3pm,
            away_3pa: tick.away_3pa,
            away_ftm: tick.away_ftm,
            away_fta: tick.away_fta,
            pace_estimate: snapshot.pace_blend_48,
            possessions_elapsed: snapshot.poss_live,
        }).then(() => { }).catch(e => console.error("[LOG] game_state_history:", e.message));

        // ========================================
        // 3-WINDOW SIGNAL SYSTEM
        // Emit actionable signals at key moments
        // ========================================
        let windowSignal = null;
        const elapsed = tick.elapsed_min;

        for (const [key, window] of Object.entries(SIGNAL_WINDOWS)) {
            // Check if we're in this window's time range
            if (elapsed >= window.minElapsed && elapsed <= window.maxElapsed) {
                // Check if signal already exists for this game/window
                const { data: existingSignal } = await supabase
                    .from("nba_window_signals")
                    .select("signal_id")
                    .eq("game_id", tick.game_id)
                    .eq("window_number", window.number)
                    .single();

                // Only emit if no signal exists for this window
                if (!existingSignal) {
                    const absEdge = Math.abs(snapshot.edge_z);
                    const side = absEdge >= window.edgeThreshold
                        ? (snapshot.edge_z > 0 ? "OVER" : "UNDER")
                        : "NO_PLAY";

                    const confidence = absEdge >= 2.0 ? "HIGH"
                        : absEdge >= 1.5 ? "MEDIUM"
                            : "LOW";

                    // Get opening line for movement tracking
                    const { data: openSnap } = await supabase
                        .from("nba_market_snapshots")
                        .select("reference_total")
                        .eq("game_id", tick.game_id)
                        .eq("window_name", "OPEN")
                        .single();

                    // Get previous window's market for delta
                    const prevWindowName = window.number === 1 ? "OPEN"
                        : window.number === 2 ? "Q1_END"
                            : "HALFTIME";

                    const { data: prevSnap } = await supabase
                        .from("nba_market_snapshots")
                        .select("reference_total")
                        .eq("game_id", tick.game_id)
                        .eq("window_name", prevWindowName)
                        .single();

                    const marketAtOpen = openSnap?.reference_total || game.close_total || 220;
                    const marketDeltaSinceOpen = snapshot.live_mkt - marketAtOpen;
                    const marketDeltaSincePrev = prevSnap
                        ? snapshot.live_mkt - prevSnap.reference_total
                        : marketDeltaSinceOpen;

                    // Identify top drivers for AI narration
                    const drivers: string[] = [];
                    if (Math.abs(snapshot.luck_gap) >= 6) {
                        drivers.push(snapshot.luck_gap > 0 ? "SHOOTING_COLD" : "SHOOTING_HOT");
                    }
                    if (snapshot.foul_ev > 3) drivers.push("FOUL_BONUS_COMING");
                    if (snapshot.ot_ev > 2) drivers.push("OT_RISK");
                    if (Math.abs(snapshot.pace_blend_48 - (game.pace_pre48 || 100)) > 5) {
                        drivers.push(snapshot.pace_blend_48 > (game.pace_pre48 || 100) ? "PACE_FAST" : "PACE_SLOW");
                    }

                    windowSignal = {
                        game_id: tick.game_id,
                        window_number: window.number,
                        window_name: window.name,
                        elapsed_min: elapsed,
                        remaining_min: tick.rem_min,
                        current_score_home: tick.pts_home,
                        current_score_away: tick.pts_away,
                        model_fair: snapshot.model_fair,
                        live_market_total: snapshot.live_mkt,
                        edge_z: snapshot.edge_z,
                        signal_side: side,
                        confidence,
                        result: "PENDING",
                        // Market movement (for AI synthesis)
                        market_at_open: marketAtOpen,
                        market_delta_since_open: marketDeltaSinceOpen,
                        market_delta_since_prev: marketDeltaSincePrev,
                        pace_delta_since_open: snapshot.pace_blend_48 - (game.pace_pre48 || 100),
                        drivers,
                    };

                    await supabase.from("nba_window_signals").insert(windowSignal);

                    // Store this window's market snapshot for next window's delta calc
                    await supabase.from("nba_market_snapshots").upsert({
                        game_id: tick.game_id,
                        window_name: window.name,
                        reference_total: snapshot.live_mkt,
                        pace_estimate: snapshot.pace_blend_48,
                    }, { onConflict: "game_id,window_name" });

                    console.log(`[nba-run-model] Window ${window.name} signal: ${side} (${snapshot.edge_z.toFixed(2)}σ) | Δopen: ${marketDeltaSinceOpen.toFixed(1)}`);
                }
                break; // Only emit one signal per tick
            }
        }

        // Evaluate trigger
        const threshold = tick.elapsed_min < CONFIG.EARLY_GAME_MINUTES
            ? CONFIG.EARLY_GAME_Z_THRESHOLD
            : CONFIG.EDGE_Z_THRESHOLD;

        let decision = null;
        if (Math.abs(snapshot.edge_z) >= threshold) {
            // Check for 2-tick confirmation
            const { data: recentSnapshots } = await supabase
                .from("nba_snapshots")
                .select("edge_z")
                .eq("game_id", tick.game_id)
                .order("ts", { ascending: false })
                .limit(CONFIG.CONFIRMATION_TICKS);

            const confirmed = recentSnapshots?.length >= CONFIG.CONFIRMATION_TICKS &&
                recentSnapshots.every((s: any) =>
                    (snapshot.edge_z > 0 && s.edge_z >= threshold) ||
                    (snapshot.edge_z < 0 && s.edge_z <= -threshold)
                );

            if (confirmed) {
                // Check cooldown
                const { data: recentDecision } = await supabase
                    .from("nba_decisions")
                    .select("ts")
                    .eq("game_id", tick.game_id)
                    .order("ts", { ascending: false })
                    .limit(1)
                    .single();

                const cooldownOk = !recentDecision ||
                    (Date.now() - new Date(recentDecision.ts).getTime()) >= CONFIG.DECISION_COOLDOWN_SECONDS * 1000;

                if (cooldownOk) {
                    const side = snapshot.edge_z > 0 ? "OVER" : "UNDER";
                    decision = {
                        game_id: tick.game_id,
                        ts: tick.ts,
                        side,
                        edge_z: snapshot.edge_z,
                        model_fair: snapshot.model_fair,
                        live_mkt: snapshot.live_mkt,
                        reason_codes: [
                            Math.abs(snapshot.edge_z) >= 2.5 ? "EDGE_ELITE" : "EDGE_STANDARD",
                            Math.abs(snapshot.luck_gap) > 6 ? (snapshot.luck_gap > 0 ? "LUCK_COLD" : "LUCK_HOT") : null,
                        ].filter(Boolean),
                        snapshot_id: savedSnapshot?.snapshot_id,
                    };

                    await supabase.from("nba_decisions").insert(decision);
                }
            }
        }

        return new Response(JSON.stringify({
            success: true,
            snapshot,
            snapshotId: savedSnapshot?.snapshot_id,
            decision,
        }), {
            headers: CORS_HEADERS,
        });

    } catch (error: any) {
        console.error("[nba-run-model] Error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: CORS_HEADERS,
        });
    }
});
