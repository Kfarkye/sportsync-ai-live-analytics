/**
 * NBA Live Totals Control Engine v3.0 - Lineup Module
 * EPM-based lineup adjustment calculations
 */

import { CONFIG } from './config';
import { avg } from './math';

/**
 * Calculate lineup adjustment PPP for a single team
 * Lineup_Adj = (SumCurrentEpm - AvgTeamEpm) / 100
 * 
 * EPM is per 100 possessions, so we divide by 100 to get PPP delta.
 * Positive means current lineup is better than team average.
 */
export function computeTeamLineupAdjPpp(
    sumCurrentEpm: number,
    avgTeamEpm: number
): number {
    return (sumCurrentEpm - avgTeamEpm) / CONFIG.EPM_PER_100_DIVISOR;
}

/**
 * Calculate game lineup adjustment PPP (average of both teams)
 */
export function computeGameLineupAdjPpp(
    sumCurrentEpmHome: number,
    avgTeamEpmHome: number,
    sumCurrentEpmAway: number,
    avgTeamEpmAway: number
): number {
    const homeAdj = computeTeamLineupAdjPpp(sumCurrentEpmHome, avgTeamEpmHome);
    const awayAdj = computeTeamLineupAdjPpp(sumCurrentEpmAway, avgTeamEpmAway);
    return avg(homeAdj, awayAdj);
}

/**
 * Calculate raw projection
 * Raw_Proj = Current_Score + Rem_Poss * (Proj_PPP + Lineup_Adj_PPP)
 */
export function computeRawProj(
    currentScore: number,
    remPoss: number,
    projPpp: number,
    lineupAdjPpp: number
): number {
    return currentScore + remPoss * (projPpp + lineupAdjPpp);
}

/**
 * Full lineup bundle
 */
export interface LineupBundle {
    lineupAdjPpp: number;
    rawProj: number;
}

export function computeLineupBundle(
    ptsHome: number,
    ptsAway: number,
    remPoss: number,
    projPpp: number,
    sumCurrentEpmHome: number,
    avgTeamEpmHome: number,
    sumCurrentEpmAway: number,
    avgTeamEpmAway: number
): LineupBundle {
    const lineupAdjPpp = computeGameLineupAdjPpp(
        sumCurrentEpmHome, avgTeamEpmHome,
        sumCurrentEpmAway, avgTeamEpmAway
    );

    const currentScore = ptsHome + ptsAway;
    const rawProj = computeRawProj(currentScore, remPoss, projPpp, lineupAdjPpp);

    return { lineupAdjPpp, rawProj };
}
