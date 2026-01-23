/**
 * NBA Live Totals Control Engine v3.0 - Expectations Module
 * Luck gap and structural PPP calculations
 */

import { TeamBoxLine } from './types';
import { safeDivide, avg } from './math';

/**
 * Calculate expected 3PM for a team
 * Exp_3PM = 3PA * Exp_3P%
 */
export function computeExp3pm(threePA: number, exp3pPct: number): number {
    return threePA * exp3pPct;
}

/**
 * Calculate expected 2PM for a team
 * 2PA = FGA - 3PA
 * 2PM = FGM - 3PM
 * Exp_2PM = 2PA * Exp_2P%
 */
export function computeExp2pm(fga: number, threePA: number, exp2pPct: number): number {
    const twoPA = fga - threePA;
    return twoPA * exp2pPct;
}

/**
 * Calculate luck gap for a team
 * Luck_Gap = 3*(Exp_3PM - Act_3PM) + 2*(Exp_2PM - Act_2PM)
 * 
 * Sign convention: POSITIVE means team shot COLD (expected more than actual)
 * This means their structural efficiency is HIGHER than observed.
 */
export function computeTeamLuckGap(
    box: TeamBoxLine,
    exp3pPct: number,
    exp2pPct: number
): number {
    const exp3pm = computeExp3pm(box.threePA, exp3pPct);
    const act3pm = box.threePM;

    const twoPA = box.fga - box.threePA;
    const twoPM = box.fgm - box.threePM;
    const exp2pm = twoPA * exp2pPct;
    const act2pm = twoPM;

    // 3-point contribution weighted by 3, 2-point by 2
    const luck3 = 3 * (exp3pm - act3pm);
    const luck2 = 2 * (exp2pm - act2pm);

    return luck3 + luck2;
}

/**
 * Calculate total luck gap for the game
 */
export function computeGameLuckGap(
    homeBox: TeamBoxLine,
    awayBox: TeamBoxLine,
    exp3pPctHome: number,
    exp2pPctHome: number,
    exp3pPctAway: number,
    exp2pPctAway: number
): { luckGapHome: number; luckGapAway: number; luckGap: number } {
    const luckGapHome = computeTeamLuckGap(homeBox, exp3pPctHome, exp2pPctHome);
    const luckGapAway = computeTeamLuckGap(awayBox, exp3pPctAway, exp2pPctAway);
    const luckGap = luckGapHome + luckGapAway;

    return { luckGapHome, luckGapAway, luckGap };
}

/**
 * Calculate structural PPP for a team
 * Struct_PPP = (Pts + Luck_Gap) / Poss
 * 
 * This represents what the team's efficiency "should" be based on shot quality,
 * removing variance from made/missed shots.
 */
export function computeTeamStructPpp(
    pts: number,
    luckGap: number,
    poss: number
): number {
    if (poss <= 0) return 0;
    return (pts + luckGap) / poss;
}

/**
 * Calculate game structural PPP (average of both teams)
 */
export function computeGameStructPpp(
    ptsHome: number,
    ptsAway: number,
    luckGapHome: number,
    luckGapAway: number,
    possHome: number,
    possAway: number
): { structPppHome: number; structPppAway: number; structPpp: number } {
    const structPppHome = computeTeamStructPpp(ptsHome, luckGapHome, possHome);
    const structPppAway = computeTeamStructPpp(ptsAway, luckGapAway, possAway);
    const structPpp = avg(structPppHome, structPppAway);

    return { structPppHome, structPppAway, structPpp };
}

/**
 * Calculate anchor PPP from pregame total and pace
 * Anchor_PPP = Close_Total / Pace_Pre_48
 */
export function computeAnchorPpp(closeTotal: number, pacePre48: number): number {
    return safeDivide(closeTotal, pacePre48, 2.0); // Default to ~2.0 PPP if no prior
}

/**
 * Calculate projected PPP (blend of structural and anchor)
 * Proj_PPP = Struct_PPP * w + Anchor_PPP * (1 - w)
 */
export function computeProjPpp(structPpp: number, anchorPpp: number, w: number): number {
    return (structPpp * w) + (anchorPpp * (1 - w));
}

/**
 * Full expectations bundle
 */
export interface ExpectationsBundle {
    anchorPpp: number;
    luckGapHome: number;
    luckGapAway: number;
    luckGap: number;
    structPppHome: number;
    structPppAway: number;
    structPpp: number;
    projPpp: number;
}

export function computeExpectationsBundle(
    ptsHome: number,
    ptsAway: number,
    homeBox: TeamBoxLine,
    awayBox: TeamBoxLine,
    possHome: number,
    possAway: number,
    exp3pPctHome: number,
    exp2pPctHome: number,
    exp3pPctAway: number,
    exp2pPctAway: number,
    closeTotal: number,
    pacePre48: number,
    w: number
): ExpectationsBundle {
    const anchorPpp = computeAnchorPpp(closeTotal, pacePre48);

    const { luckGapHome, luckGapAway, luckGap } = computeGameLuckGap(
        homeBox, awayBox,
        exp3pPctHome, exp2pPctHome,
        exp3pPctAway, exp2pPctAway
    );

    const { structPppHome, structPppAway, structPpp } = computeGameStructPpp(
        ptsHome, ptsAway,
        luckGapHome, luckGapAway,
        possHome, possAway
    );

    const projPpp = computeProjPpp(structPpp, anchorPpp, w);

    return {
        anchorPpp,
        luckGapHome,
        luckGapAway,
        luckGap,
        structPppHome,
        structPppAway,
        structPpp,
        projPpp
    };
}
