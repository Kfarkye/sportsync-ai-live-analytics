/**
 * NBA Live Totals Control Engine v3.0 - Possessions Module
 * Canonical possession calculations (unit-coherent: pace per 48)
 */

import { CONFIG } from './config';
import { TeamBoxLine } from './types';
import { safeDivide, clamp } from './math';

/**
 * Calculate team possessions using the standard formula:
 * Poss = FGA + TOV + 0.44*FTA - ORB
 */
export function computeTeamPossessions(box: TeamBoxLine): number {
    const poss = box.fga + box.tov + (CONFIG.FTA_COEFFICIENT * box.fta) - box.orb;
    return Math.max(0, poss); // Possessions cannot be negative
}

/**
 * Calculate game possessions (average of both teams)
 */
export function computeGamePossessions(homeBox: TeamBoxLine, awayBox: TeamBoxLine): number {
    const possHome = computeTeamPossessions(homeBox);
    const possAway = computeTeamPossessions(awayBox);
    return (possHome + possAway) / 2;
}

/**
 * Calculate live pace per 48 minutes
 * Live_Pace_48 = (Poss_live / elapsed_min) * 48
 */
export function computeLivePace48(possLive: number, elapsedMin: number): number {
    if (elapsedMin <= 0) return 0;
    return (possLive / elapsedMin) * CONFIG.GAME_MINUTES;
}

/**
 * Calculate pace blend weight
 * w = elapsed / 48, clamped [0, 1]
 */
export function computeBlendWeight(elapsedMin: number): number {
    return clamp(elapsedMin / CONFIG.GAME_MINUTES, 0, 1);
}

/**
 * Calculate blended pace (live vs pregame prior)
 * Pace_Blend_48 = Live_Pace_48 * w + pacePre48 * (1 - w)
 */
export function computePaceBlend48(livePace48: number, pacePre48: number, w: number): number {
    return (livePace48 * w) + (pacePre48 * (1 - w));
}

/**
 * Calculate remaining possessions
 * Rem_Poss = (rem_min / 48) * Pace_Blend_48
 */
export function computeRemPoss(remMin: number, paceBlend48: number): number {
    return (remMin / CONFIG.GAME_MINUTES) * paceBlend48;
}

/**
 * Calculate 3PA rate for the game
 */
export function compute3paRateGame(homeBox: TeamBoxLine, awayBox: TeamBoxLine): number {
    const total3pa = homeBox.threePA + awayBox.threePA;
    const totalFga = homeBox.fga + awayBox.fga;
    return safeDivide(total3pa, totalFga, 0);
}

/**
 * Full possessions calculation bundle
 */
export interface PossessionsBundle {
    possHome: number;
    possAway: number;
    possLive: number;
    livePace48: number;
    paceBlend48: number;
    remPoss: number;
    w: number;
    threeParateGame: number;
}

export function computePossessionsBundle(
    homeBox: TeamBoxLine,
    awayBox: TeamBoxLine,
    elapsedMin: number,
    remMin: number,
    pacePre48: number
): PossessionsBundle {
    const possHome = computeTeamPossessions(homeBox);
    const possAway = computeTeamPossessions(awayBox);
    const possLive = (possHome + possAway) / 2;

    const livePace48 = computeLivePace48(possLive, elapsedMin);
    const w = computeBlendWeight(elapsedMin);
    const paceBlend48 = computePaceBlend48(livePace48, pacePre48, w);
    const remPoss = computeRemPoss(remMin, paceBlend48);
    const threeParateGame = compute3paRateGame(homeBox, awayBox);

    return {
        possHome,
        possAway,
        possLive,
        livePace48,
        paceBlend48,
        remPoss,
        w,
        threeParateGame
    };
}
