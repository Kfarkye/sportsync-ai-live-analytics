import { OddsSnapshot, ExtendedMatch, TeamEfficiencyMatrix, FairTotalActive } from "../../types.ts";
import { SYSTEM_GATES } from "../../gates.ts";
import { getElapsedSeconds, isCollegeBasketball } from "../time.ts";
import { clamp, lerp, safeDiv, getBasketballPossessions } from "../utils.ts";

/**
 * Calculates efficiency metrics and preserves the 'Prior' (Base Pace)
 * for use in downstream regression logic.
 */
export function calculateBasketballEfficiency(match: ExtendedMatch): TeamEfficiencyMatrix & { basePace: number } {
    const home = match.homeTeamStats;
    const away = match.awayTeamStats;

    const isNCAAB = isCollegeBasketball(match);
    const targetMins = isNCAAB ? 40 : 48;

    // MIT TWEAK: Use 0.5 min floor to prevent "Minute 0" singularities 
    // without artificially halving stats in the first minute.
    const elapsedSeconds = getElapsedSeconds(match);
    const elapsedMins = Math.max(elapsedSeconds / 60, 0.5);

    // 1. Establish Baseline Pace (The Bayesian Prior)
    // NBA: ~100 per team. NCAAB: ~68 per team.
    let basePace = isNCAAB ? SYSTEM_GATES.NCAAB.BASELINE_PACE : 100.2; // Updated to 2024 NBA average

    if (isNCAAB) {
        // Safe optional chaining access for potentially dirty data feeds
        const hPace = (match.homeTeam as any).pace || (match.homeTeam as any).metrics?.pace;
        const aPace = (match.awayTeam as any).pace || (match.awayTeam as any).metrics?.pace;

        if (hPace && aPace) {
            basePace = (hPace + aPace) / 2;
        }
    }

    // 2. Calculate Observed Pace (The Likelihood)
    const hPoss = getBasketballPossessions(home);
    const aPoss = getBasketballPossessions(away);

    // Standardize: (Home + Away) / 2 smooths out stat-keeping variance
    const totalPoss = (hPoss + aPoss) / 2;

    // Extrapolate: (Possessions / Elapsed) * FullGame
    const rawObsPace = (totalPoss / elapsedMins) * targetMins;

    // 3. Trust Weighting (Bayesian Update)
    // We trust the observed pace linearly as time passes.
    // Reaches 100% confidence at 25% of game duration (end of Q1).
    const trustWeight = clamp(elapsedMins / (targetMins * 0.25), 0, 1);

    const minPace = isNCAAB ? SYSTEM_GATES.NCAAB.MIN_PACE : 75;
    const maxPace = isNCAAB ? SYSTEM_GATES.NCAAB.MAX_PACE : 135;

    // Clamp observed pace to realistic bounds to filter data glitches
    const obsPace = clamp(rawObsPace, minPace, maxPace);

    // 4. Blend Prior and Likelihood
    const pace = lerp(basePace, obsPace, trustWeight);

    return {
        sport_type: "BASKETBALL",
        home: {
            ortg: Number((safeDiv(match.homeScore, hPoss) * 100).toFixed(1)),
            pace: Number(pace.toFixed(1)),
            efg: 0.5
        },
        away: {
            ortg: Number((safeDiv(match.awayScore, aPoss) * 100).toFixed(1)),
            pace: Number(pace.toFixed(1)),
            efg: 0.5
        },
        context: `${pace.toFixed(1)} PACE`,
        basePace: basePace // Passing this through is critical for the "Apples-to-Apples" Open Total check
    };
}

/**
 * Drop-in replacement for the brake logic.
 * Fix: Brake triggers on YOUR move being significant (anti-runaway).
 * Fix: Window extends to 75% of game (covering Q3 kill zone).
 * Fix: Uses passed-in anchorTotal for single source of truth.
 */
function applyConvergenceBrake(args: {
    rawFair: number;
    currentPts: number;
    elapsedMins: number;
    targetMins: number;
    odds: OddsSnapshot;
    regime: FairTotalActive["regime"];
    anchorTotal: number;
}): { rawFair: number; regime: FairTotalActive["regime"]; debug: any } {
    const { rawFair, elapsedMins, targetMins, odds, anchorTotal } = args;

    // If we have no valid lines at all, we cannot brake.
    if (!(anchorTotal > 0 && odds.cur.total > 0)) {
        return { rawFair, regime: args.regime, debug: { applied: false, reason: "missing_totals" } };
    }

    const yourMove = Math.abs(rawFair - anchorTotal);
    const bookMove = Math.abs(odds.cur.total - anchorTotal);

    // Ratio: How much more aggressive are we than the book?
    // Use max(bookMove, 1) to prevent division by zero or massive ratios on static lines
    const moveRatio = safeDiv(yourMove, Math.max(bookMove, 1));

    // FIX: Brake window is 75% of the game (36 mins NBA, 30 mins NCAAB)
    // This ensures we catch "runaway" extrapolations during the Q3 efficiency stabilization phase.
    const inBrakeWindow = elapsedMins <= (targetMins * 0.75);

    // Trigger when YOU are materially off anchor (>= 6pts) and faster than market (> 1.5x)
    const trigger = inBrakeWindow && yourMove >= 6 && moveRatio > 1.5;

    if (!trigger) {
        return {
            rawFair,
            regime: args.regime,
            debug: { applied: false, yourMove, bookMove, moveRatio, anchorTotal, inBrakeWindow },
        };
    }

    // Brake factor grows with ratio. Cap at 0.5 so you still have edge.
    // Strength boost if bookMove is also meaningfully moving (confirms signal is "real").
    const ratioFactor = clamp((moveRatio - 1.5) / 1.5, 0, 0.5); // 1.5->0 ... 3.0->0.5
    const confirmBoost = clamp(bookMove / 8, 0, 0.15); // up to +0.15 if book moved ~8+
    const brakeFactor = clamp(ratioFactor + confirmBoost, 0, 0.55);

    const braked = lerp(rawFair, odds.cur.total, brakeFactor);

    return {
        rawFair: braked,
        regime: brakeFactor > 0.1 ? "REGRESSED" : args.regime,
        debug: { applied: true, yourMove, bookMove, moveRatio, brakeFactor, anchorTotal },
    };
}

export function calculateBasketballFairTotal(
    match: ExtendedMatch,
    odds: OddsSnapshot,
    efficiency: any,
    timeRem: number,
    currentPts: number
): { fairTotal: number; regime: string; sd: number; pushRisk: boolean; flags: any } {

    const pace = efficiency.home.pace;
    const isNCAAB = isCollegeBasketball(match);
    const targetMins = isNCAAB ? 40 : 48;
    const elapsedMins = Math.max((targetMins * 60 - timeRem) / 60, 0.5);
    const possRem = (pace / targetMins) * (timeRem / 60);

    // 0. Establish Single Source of Truth for "Base Line"
    // Use Open Total if available; fallback to Current Total if late add/missing open.
    const anchorTotal = (odds.open?.total || 0) > 0 ? odds.open.total : odds.cur.total;

    // 1. Efficiency Audit
    const marketPPP = safeDiv(odds.cur.total, pace);

    // MIT TWEAK: Decoupling. 
    // We calculate Observed PPP using ACTUAL possessions, not Implied possessions.
    const hPoss = getBasketballPossessions(match.homeTeamStats);
    const aPoss = getBasketballPossessions(match.awayTeamStats);
    const actualPoss = Math.max((hPoss + aPoss) / 2, 1);

    // Filter early noise: Trust market implicitly for first 2 minutes
    const obsPPP = elapsedMins < 2.0 ? marketPPP : safeDiv(currentPts, actualPoss);

    // 2. Trust Weighting (Linear)
    // We simply transition from Market Expectation to Real Reality over time.
    const trustWeight = clamp(elapsedMins / (targetMins * 0.6), 0, 1);

    // NO REGRESSION ANCHOR. Pure blend.
    const blendedPPP = lerp(marketPPP, obsPPP, trustWeight);

    let projRemaining = possRem * blendedPPP;
    let regime: FairTotalActive["regime"] = "NORMAL";

    // ---------------------------------------------------------
    // 3. Game State Adjustments (Dynamic Gates)
    // ---------------------------------------------------------
    const diff = Math.abs(match.homeScore - match.awayScore);

    // FIX: Select the correct constants based on league
    const gates = isNCAAB ? SYSTEM_GATES.NCAAB : SYSTEM_GATES.NBA;

    const flags: any = {
        blowout: diff > gates.BLOWOUT_DIFF && elapsedMins > (targetMins * 0.6),
        foul_trouble: false,
        endgame: elapsedMins > gates.ENDGAME_START_MIN && diff <= 6
    };

    if (flags.blowout) {
        projRemaining *= gates.BLOWOUT_SCALAR; // Dynamic Scalar
        regime = "BLOWOUT";
    }
    if (flags.endgame) {
        projRemaining += gates.ENDGAME_ADDER; // Dynamic Adder
        regime = "CHAOS";
    }

    let rawFair = currentPts + projRemaining;

    // ---------------------------------------------------------
    // 4. THE CONVERGENCE BRAKE
    // ---------------------------------------------------------
    const brakeResult = applyConvergenceBrake({
        rawFair,
        currentPts,
        elapsedMins,
        targetMins,
        odds,
        regime,
        anchorTotal // Pass the single source of truth
    });

    rawFair = brakeResult.rawFair;
    regime = brakeResult.regime;
    flags.brake = brakeResult.debug;
    // ---------------------------------------------------------

    // 5. Volatility Caps (Secondary Guardrails)
    let cap = 300;

    // FIX: Use anchorTotal so this runs even if Open Total is missing
    if (anchorTotal > 0) {
        if (elapsedMins < 6) cap = anchorTotal + 28;
        else if (elapsedMins < 12) cap = anchorTotal + 35;
    }

    let fairTotal = Math.min(rawFair, cap);
    fairTotal = Math.max(currentPts, fairTotal);

    return {
        fairTotal,
        regime,
        sd: -1,
        pushRisk: false,
        flags
    };
}
