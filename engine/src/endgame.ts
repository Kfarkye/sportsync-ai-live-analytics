/**
 * NBA Live Totals Control Engine v3.0 - Endgame Module
 * Foul EV and OT EV calculations
 */

import { CONFIG } from './config';
import { clamp } from './math';

/**
 * Estimate probability of intentional fouling scenario
 * Based on score differential, remaining time, and bonus state
 */
export function computeFoulProbability(
    scoreDiff: number,
    remMin: number,
    timeoutsTrailing: number,
    inBonusLeading: boolean
): number {
    // No foul scenarios if too much time left
    if (remMin > CONFIG.FOUL_EV_THRESHOLD_MIN) return 0;

    // Adjust for score differential (higher diff = more certain fouling)
    const diffAbs = Math.abs(scoreDiff);

    // Close game (1-8 points) with little time = high foul probability
    if (diffAbs >= 1 && diffAbs <= 8 && remMin <= 2.0) {
        // Trailing team with timeouts and leading team in bonus = more fouls
        let prob = 0.3 + (2.0 - remMin) * 0.3; // Base 30-90%

        if (timeoutsTrailing > 0) prob += 0.1;
        if (inBonusLeading) prob += 0.1;

        // Tighter games = more fouling
        if (diffAbs <= 3) prob += 0.15;

        return clamp(prob, 0, 0.95);
    }

    // Moderate deficit (9-15 points) with very little time
    if (diffAbs >= 9 && diffAbs <= 15 && remMin <= 1.0) {
        return 0.4 + (1.0 - remMin) * 0.3;
    }

    return 0;
}

/**
 * Estimate expected points from fouling scenario
 * Based on empirical foul scenarios (1-4 extra points typical)
 */
export function computeExpectedFoulPoints(
    scoreDiff: number,
    remMin: number
): number {
    const diffAbs = Math.abs(scoreDiff);

    // Very close games = more back-and-forth fouling
    if (diffAbs <= 3 && remMin <= 1.0) {
        return 4.0 + (1.0 - remMin) * 6.0; // 4-10 points
    }

    // Moderate games
    if (diffAbs <= 6 && remMin <= 2.0) {
        return 2.0 + (2.0 - remMin) * 3.0; // 2-8 points
    }

    return 1.0 + remMin * 0.5;
}

/**
 * Calculate Foul EV
 * Foul_EV = Prob_Foul * Expected_Foul_Pts, bounded
 */
export function computeFoulEv(
    scoreDiff: number,
    remMin: number,
    timeoutsHome?: number,
    timeoutsAway?: number,
    inBonusHome?: boolean,
    inBonusAway?: boolean
): number {
    // Determine trailing team's timeouts and leading team's bonus
    const homeLeading = scoreDiff > 0;
    const timeoutsTrailing = homeLeading
        ? (timeoutsAway ?? 0)
        : (timeoutsHome ?? 0);
    const inBonusLeading = homeLeading
        ? (inBonusAway ?? false)
        : (inBonusHome ?? false);

    const prob = computeFoulProbability(scoreDiff, remMin, timeoutsTrailing, inBonusLeading);
    const expPts = computeExpectedFoulPoints(scoreDiff, remMin);

    const foulEv = prob * expPts;
    return clamp(foulEv, CONFIG.FOUL_EV_MIN, CONFIG.FOUL_EV_MAX);
}

/**
 * Estimate probability of overtime
 * Based on score differential and remaining time
 */
export function computeOtProbability(
    scoreDiff: number,
    remMin: number
): number {
    const diffAbs = Math.abs(scoreDiff);

    // OT only possible in very close games
    if (diffAbs > CONFIG.OT_SCORE_DIFF_THRESHOLD) return 0;

    // Very late game with tied score
    if (diffAbs === 0 && remMin <= 0.5) {
        return 0.40; // 40% chance of OT if tied with 30s left
    }

    // 1-2 point game late
    if (diffAbs <= 2 && remMin <= 1.0) {
        return 0.15 - (diffAbs * 0.03);
    }

    // 3-6 point game with some time
    if (diffAbs <= 6 && remMin <= 3.0) {
        return Math.max(0, 0.10 - (diffAbs * 0.015) - (remMin * 0.02));
    }

    return 0;
}

/**
 * Calculate OT EV
 * OT_EV = Prob_OT * Expected_OT_Pts, bounded
 */
export function computeOtEv(
    scoreDiff: number,
    remMin: number
): number {
    const prob = computeOtProbability(scoreDiff, remMin);
    const otEv = prob * CONFIG.EXPECTED_OT_POINTS;
    return clamp(otEv, CONFIG.OT_EV_MIN, CONFIG.OT_EV_MAX);
}

/**
 * Calculate Model Fair value
 * Model_Fair = Raw_Proj + Foul_EV + OT_EV
 */
export function computeModelFair(
    rawProj: number,
    foulEv: number,
    otEv: number
): number {
    return rawProj + foulEv + otEv;
}

/**
 * Full endgame bundle
 */
export interface EndgameBundle {
    foulEv: number;
    otEv: number;
    modelFair: number;
}

export function computeEndgameBundle(
    rawProj: number,
    ptsHome: number,
    ptsAway: number,
    remMin: number,
    timeoutsHome?: number,
    timeoutsAway?: number,
    inBonusHome?: boolean,
    inBonusAway?: boolean
): EndgameBundle {
    const scoreDiff = ptsHome - ptsAway;

    const foulEv = computeFoulEv(
        scoreDiff, remMin,
        timeoutsHome, timeoutsAway,
        inBonusHome, inBonusAway
    );

    const otEv = computeOtEv(scoreDiff, remMin);
    const modelFair = computeModelFair(rawProj, foulEv, otEv);

    return { foulEv, otEv, modelFair };
}
