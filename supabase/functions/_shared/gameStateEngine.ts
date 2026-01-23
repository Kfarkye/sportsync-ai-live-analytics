
// =============================================================================
// SHARED GAME STATE ENGINE (Deno-Compatible)
// =============================================================================

import {
    Sport,
    AISignals,
    SystemState,
    ExtendedMatch,
    TeamEfficiencyMatrix,
    FairTotalResult,
    FairTotalActive,
    PregameConstraints,
    OddsSnapshot,
} from "./types.ts";

import { SYSTEM_GATES } from "./gates.ts";
import {
    getElapsedSeconds,
    getRemainingSeconds,
    calculateGameProgress,
    isFinalLikeClock,
    isCollegeBasketball
} from "./engine/time.ts";
import {
    clamp,
    safeDiv,
    isBasketball,
    isFootball,
    parseStatNumber,
    calculateBlowoutState,
    computePitchingWHIP,
} from "./engine/utils.ts";

import { calculateHockeyFairTotal, calculateHockeyEfficiency } from "./engine/physics/hockey.ts";
import { calculateBasketballEfficiency, calculateBasketballFairTotal } from "./engine/physics/basketball.ts";
import { calculateFootballEfficiency, calculateFootballFairTotal } from "./engine/physics/football.ts";
import { calculateBaseballEfficiency, calculateBaseballFairTotal } from "./engine/physics/baseball.ts";
import { calculateSoccerEfficiency, calculateSoccerFairTotal } from "./engine/physics/soccer.ts";

import {
    calculateLiabilityInertia,
    calculateEdgeEnvironment,
    getMarketBlueprint,
    calculateNFLTotalOverride,
    getCanonicalOdds,
    getRegimeMultiplier
} from "./engine/market.ts";
import { calculatePregameConstraints } from "./engine/signals/pregame.ts";

function getWeather(match: ExtendedMatch): any {
    return (match as any).weather_info || (match as any).weather_forecast;
}

function calculateEfficiencyMatrix(match: ExtendedMatch, odds: OddsSnapshot): TeamEfficiencyMatrix {
    if (isBasketball(match.sport)) {
        return calculateBasketballEfficiency(match);
    }
    if (match.sport === Sport.HOCKEY) {
        return calculateHockeyEfficiency(match, odds);
    }
    if (isFootball(match.sport)) {
        return calculateFootballEfficiency(match);
    }
    if (match.sport === Sport.BASEBALL) {
        return calculateBaseballEfficiency(match);
    }
    if (match.sport === Sport.SOCCER) {
        return calculateSoccerEfficiency(match);
    }
    return { sport_type: "GENERIC", home: { pace: 0 }, away: { pace: 0 }, context: "STANDARD" };
}

function calculateFairTotalBySport(match: ExtendedMatch, odds: OddsSnapshot, efficiency: TeamEfficiencyMatrix, pregame: PregameConstraints): FairTotalResult {
    try {
        const isNCAAB = isCollegeBasketball(match);
        const timeRem = getRemainingSeconds(match);
        const currentPts = (match.homeScore || 0) + (match.awayScore || 0);
        const totalTime = isBasketball(match.sport) ? (isNCAAB ? 2400 : 2880) : 3600;

        const timeFactor = Math.sqrt(Math.max(0.1, timeRem) / totalTime);
        let sd = Math.max(0.15, 1.0 * timeFactor);

        if (isFinalLikeClock(match.displayClock, match.status as string)) return { status: "NO_BET", reason: "Game Final" };
        if (odds.cur.total <= 0) return { status: "NO_BET", reason: "Critical: Total is Invalid" };

        let fairTotal = currentPts;
        let regime: FairTotalActive["regime"] = "NORMAL";
        let pushRisk = false;

        if (calculateBlowoutState(match, timeRem)) {
            regime = "BLOWOUT";
            sd = 2.5;
        }

        let varianceFlags: any = undefined;

        if (efficiency.sport_type === "HOCKEY") {
            const hky = calculateHockeyFairTotal(match, efficiency, pregame, timeRem, currentPts, regime === "BLOWOUT" ? "BLOWOUT" : "NORMAL");
            fairTotal = hky.fairTotal;
            regime = hky.regime as any;
            sd = hky.sd;
            varianceFlags = hky.flags;
        }
        else if (efficiency.sport_type === "BASKETBALL") {
            const bsk = calculateBasketballFairTotal(match, odds, efficiency, timeRem, currentPts);
            fairTotal = bsk.fairTotal;
            regime = bsk.regime as any;
            const targetMins = isCollegeBasketball(match) ? 40 : 48;
            const elapsedMins = (targetMins * 60 - timeRem) / 60;
            const rangeWidth = Math.max(4, 9 - (elapsedMins / 10));
            sd = rangeWidth / 1.5;

            return {
                status: "ACTIVE",
                fair_total: Number(fairTotal.toFixed(2)),
                p10: Number((fairTotal - rangeWidth).toFixed(2)),
                p90: Number((fairTotal + rangeWidth).toFixed(2)),
                variance_sd: Number(sd.toFixed(2)),
                regime,
                pace_multiplier: regime === "BLOWOUT" ? 0.9 : 1.0,
                range_band: {
                    low: Number((fairTotal - rangeWidth).toFixed(1)),
                    high: Number((fairTotal + rangeWidth).toFixed(1))
                },
                variance_flags: bsk.flags
            };
        }
        else if (efficiency.sport_type === "FOOTBALL") {
            const fb = calculateFootballFairTotal(match, odds, efficiency, timeRem, currentPts, timeFactor);
            fairTotal = fb.fairTotal;
            regime = fb.regime as any;
            sd = fb.sd;
            pushRisk = fb.pushRisk;
        }
        else if (efficiency.sport_type === "BASEBALL") {
            const bb = calculateBaseballFairTotal(match, odds, efficiency, timeRem, currentPts);
            if (bb.status === "NO_BET") return { status: "NO_BET", reason: (bb.reason as any) || "Game Final" };
            fairTotal = bb.fairTotal;
            regime = bb.regime as any;
            sd = bb.sd;
        }
        else if (efficiency.sport_type === "SOCCER") {
            const sc = calculateSoccerFairTotal(match, odds, efficiency, timeRem, currentPts);
            fairTotal = sc.fairTotal;
            regime = sc.regime as any;
            sd = 0.5; // Lower SD for soccer
        }
        else {
            const rate = safeDiv(odds.cur.total, 3600);
            fairTotal = currentPts + (timeRem * rate);
        }

        return {
            status: "ACTIVE",
            fair_total: Number(fairTotal.toFixed(2)),
            p10: Number((fairTotal - (1.5 * sd)).toFixed(2)),
            p90: Number((fairTotal + (1.5 * sd)).toFixed(2)),
            variance_sd: Number(sd.toFixed(2)),
            regime,
            pace_multiplier: regime === "BLOWOUT" ? 0.9 : 1.0,
            push_risk: pushRisk,
            variance_flags: varianceFlags
        };

    } catch (e) {
        return { status: "NO_BET", reason: "Calculation Error" };
    }
}

function calculatePhase(match: any): string {
    const clock = (match.displayClock || "").toUpperCase();
    if (clock === "FINAL" || clock === "F" || clock === "FT") return "FINAL";
    if (getElapsedSeconds(match as ExtendedMatch) > 0) return "LIVE";
    if (match.sport === Sport.BASEBALL && (match.period || 0) >= 1) return "LIVE";
    return "PRE";
}

function calculateNewsAdjustment(match: ExtendedMatch): number {
    if ((match as any).venue?.is_indoor) return 0;
    if (!isFootball(match.sport)) return 0;

    const w = getWeather(match);
    if (w && parseStatNumber(w.wind_speed) > SYSTEM_GATES.WIND_THRESHOLD_MPH) return SYSTEM_GATES.WIND_IMPACT_POINTS;
    return 0;
}

export const computeAISignals = (match: any): AISignals => {
    const extMatch = match as ExtendedMatch;
    const odds = getCanonicalOdds(match);
    const progress = calculateGameProgress(extMatch);
    const phase = calculatePhase(match);

    const efficiency = calculateEfficiencyMatrix(extMatch, odds);
    const pregame = calculatePregameConstraints(extMatch);

    const fair = calculateFairTotalBySport(extMatch, odds, efficiency, pregame);

    const isFinished = isFinalLikeClock(match.displayClock, match.status as string);
    const isActive = fair.status === "ACTIVE" && !isFinished;

    // DATA INTEGRITY GATE: Stale state detection (period=0 with non-zero scores)
    const currentTotal = (match.homeScore ?? 0) + (match.awayScore ?? 0);
    const isStaleState = (match.period === 0 || match.period === undefined) && currentTotal > 0;
    if (isStaleState) {
        console.warn(`[INTEGRITY] Stale state detected: period=${match.period} but score=${currentTotal}`);
    }

    const epaSRS = (efficiency.sport_type === "FOOTBALL") ? ((efficiency as any).home.srs || 0) : 0;
    const newsAdjustment = calculateNewsAdjustment(extMatch);
    const edgeEnv = calculateEdgeEnvironment(extMatch, odds, progress);
    const inertia = calculateLiabilityInertia(extMatch, odds);
    const nflOverride = calculateNFLTotalOverride(extMatch, odds, progress, epaSRS);

    const elapsedSecs = getElapsedSeconds(extMatch);
    const elapsedMins = Math.max(1, elapsedSecs / 60);
    // currentTotal already declared above for stale state check
    const isNCAAB_PPM = isCollegeBasketball(match);
    const gameTotalMins = match.sport === Sport.SOCCER ? 90 : (isBasketball(match.sport) ? (isNCAAB_PPM ? 40 : 48) : 60);

    const rawObsPPM = currentTotal / elapsedMins;

    // FIX: Ensure fair_total is NEVER below already-scored points
    if (isActive && fair.fair_total < currentTotal) {
        console.warn(`[INTEGRITY] fair_total ${fair.fair_total} < currentTotal ${currentTotal}. Flooring.`);
        fair.fair_total = currentTotal;
    }

    // IMPOSSIBLE UNDER GATE: If current total >= market total, UNDER is impossible.
    // We force Edge to 0 to prevent "Play" or "Lean" states on dead numbers.
    const isImpossibleUnder = isActive && currentTotal >= odds.cur.total;

    const modelTotal = isActive ? fair.fair_total : odds.cur.total;
    const modelPPM = modelTotal / gameTotalMins;

    const regimes: string[] = nflOverride.active
        ? ["NFL_TOTAL_FLOOR_OVERSHOOT"]
        : (edgeEnv.tags as any[]);

    if (isActive) {
        if (fair.regime !== "NORMAL") regimes.push(fair.regime);
        fair.fair_total += newsAdjustment;
        if (fair.push_risk) regimes.push("KEY_NUMBER_PUSH_RISK");
    }

    const edgePoints = (isActive && !isImpossibleUnder) ? Math.abs(fair.fair_total - odds.cur.total) : 0;

    let actionThreshold = 2.0;
    if (match.sport === Sport.HOCKEY) actionThreshold = 0.65;
    else if (isBasketball(match.sport) && !isNCAAB_PPM) actionThreshold = SYSTEM_GATES.NBA.ACTIONABLE_EDGE;

    const isHighUncertainty = isActive && fair.variance_flags && (
        fair.variance_flags.blowout || fair.variance_flags.foul_trouble || fair.variance_flags.endgame || fair.variance_flags.power_play_decay
    );

    if (isHighUncertainty) actionThreshold = 6.0;

    const LEAN_THRESHOLD = isHighUncertainty ? 3.0 : 1.0;

    let edgeState: 'PLAY' | 'LEAN' | 'NEUTRAL' = 'NEUTRAL';
    if (edgePoints >= actionThreshold) edgeState = 'PLAY';
    else if (edgePoints >= LEAN_THRESHOLD) edgeState = 'LEAN';
    else edgeState = 'NEUTRAL';

    const baseEdge = isActive ? Math.abs((fair.fair_total - odds.cur.total) / (odds.cur.total || 1)) : 0;

    const ppmDelta = rawObsPPM - modelPPM;
    const isComputerGroupTrigger = isActive && Math.abs(ppmDelta / (modelPPM || 1)) > 0.12 && progress > 0.2;
    if (isComputerGroupTrigger) {
        regimes.push("COMPUTER_GROUP_REACTIVE");
    }

    let isPaceHallucination = false;
    if (isBasketball(match.sport) && rawObsPPM > 10) isPaceHallucination = true;
    if (isFootball(match.sport) && rawObsPPM > 6) isPaceHallucination = true;
    if (match.sport === Sport.HOCKEY && rawObsPPM > 4) isPaceHallucination = true;

    let finalSystemState: SystemState = (isActive && edgeState !== 'NEUTRAL') ? "ACTIVE" : "SILENT";
    let integrityReason = undefined;

    // FIX: Suppress PLAY on stale state (period=0 + score > 0)
    if (isStaleState) {
        finalSystemState = "SILENT";
        integrityReason = "STALE_GAME_STATE: period=0 with non-zero score";
        regimes.push("STALE_STATE");
    }

    if (isPaceHallucination) {
        finalSystemState = "SILENT";
        integrityReason = "CRITICAL: Impossible Pace Detected (Clock Error)";
        regimes.push("DATA_INTEGRITY_FAILURE");
    }

    const pCode = (match.sport === Sport.BASEBALL && (match.period || 0) > 9) ? "XTRA" : `P${match.period || 0}`;
    const patternHash = `${String(match.sport).toUpperCase()}:${regimes[0] || "NONE"}:${pCode}`;

    let paceLabel: any = "NORMAL";
    if (efficiency.sport_type === "BASKETBALL") {
        const pace = efficiency.home.pace;
        if (isCollegeBasketball(match)) {
            paceLabel = pace > 74 ? "FAST" : pace < 64 ? "SLOW" : "NORMAL";
        } else {
            paceLabel = pace > 102 ? "FAST" : pace < 94 ? "SLOW" : "NORMAL";
        }
    }

    const w = getWeather(extMatch);
    const isWindy = w ? parseStatNumber(w.wind_speed) > SYSTEM_GATES.WIND_THRESHOLD_MPH : false;

    let marketLean: 'OVER' | 'UNDER' | 'NEUTRAL' = 'NEUTRAL';
    let signalLabel = "NEUTRAL READ";

    if (isActive) {
        const delta = fair.fair_total - odds.cur.total;
        if (edgeState !== 'NEUTRAL' && !isPaceHallucination) {
            if (delta > 0.45) marketLean = 'OVER';
            else if (delta < -0.45) marketLean = 'UNDER';
            else if (delta > 0) marketLean = 'OVER';
            else if (delta < 0) marketLean = 'UNDER';
        }

        if (isPaceHallucination) {
            signalLabel = "DATA INTEGRITY ERROR";
            marketLean = 'NEUTRAL';
        } else if (edgeState === 'PLAY') {
            if (isComputerGroupTrigger) signalLabel = "COMPUTER GROUP ACTION";
            else if (baseEdge > 0.07) signalLabel = "SHARP BUY";
            else signalLabel = "ACTIONABLE PLAY";
        } else if (edgeState === 'LEAN') {
            signalLabel = "OBSERVATIONAL LEAN";
        } else {
            signalLabel = "LIVE READ";
            marketLean = 'NEUTRAL';
        }
    }

    const remainingSecs = getRemainingSeconds(extMatch);
    const remainingMins = Math.max(0, remainingSecs / 60);

    const trace: string[] = [];
    trace.push(`Phase: ${phase}, Progress: ${progress.toFixed(2)}`);
    trace.push(`Sport: ${match.sport}, Efficiency Type: ${efficiency.sport_type}`);
    if (isActive) {
        trace.push(`Fair Total Logic: ${fair.fair_total.toFixed(2)} (vs Market ${odds.cur.total.toFixed(1)})`);
        trace.push(`Regime: ${fair.regime}`);
        if (fair.variance_flags) trace.push(`Variance Flags: ${JSON.stringify(fair.variance_flags)}`);
    } else {
        const reason = (fair as any).reason || 'Unknown';
        trace.push(`Fair Total Logic: INACTIVE (Reason: ${reason})`);
    }

    if (edgePoints > 0) trace.push(`Edge: ${edgePoints.toFixed(1)} points (${edgeState})`);
    if (isPaceHallucination) trace.push(`Integrity Check FAILED: ${integrityReason}`);
    if (isComputerGroupTrigger) trace.push(`Computer Group Trigger: PPM Delta ${ppmDelta.toFixed(3)}`);
    if (nflOverride.active) trace.push(`NFL Total Override Active: SRS ${epaSRS}`);

    const signals: AISignals = {
        system_state: finalSystemState,
        dislocation_total_pct: baseEdge,
        market_total: odds.cur.total,
        deterministic_fair_total: isActive ? fair.fair_total : undefined,
        deterministic_regime: isActive ? fair.regime : undefined,
        edge_state: edgeState,
        edge_points: Number(edgePoints.toFixed(1)),
        ppm: {
            observed: Number(rawObsPPM.toFixed(3)),
            projected: Number(modelPPM.toFixed(3)),
            delta: Number((rawObsPPM - (odds.cur.total / gameTotalMins)).toFixed(3)),
            implied_total: Number((odds.cur.total || 0).toFixed(1))
        },
        context: {
            elapsed_mins: Number(elapsedMins.toFixed(1)),
            remaining_mins: Number(remainingMins.toFixed(1)),
            current_score: `${match.awayScore ?? 0}-${match.homeScore ?? 0}`,
            period: match.period || 1,
            clock: match.displayClock || '—'
        },
        narrative: {
            pace_context: paceLabel,
            market_lean: isImpossibleUnder ? 'NEUTRAL' : marketLean,
            signal_label: isImpossibleUnder ? 'MARKET CAPPED' : signalLabel,
        },
        debug_trace: trace
    };

    signals.blueprint = getMarketBlueprint(match, signals);
    return signals;
}
