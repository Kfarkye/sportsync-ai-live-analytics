/**
 * NBA Live Totals Control Engine v3.0 - Control Table (Core Engine)
 * Deterministic computation of all v3.0 model outputs
 * 
 * This is the heart of the system. All inputs and outputs are strictly typed.
 * No side effects. Pure function. Fully replayable.
 */

import { ControlTableInput, ControlTableOutput } from './types';
import { computePossessionsBundle } from './possessions';
import { computeExpectationsBundle } from './expectations';
import { computeLineupBundle } from './lineup';
import { computeEndgameBundle } from './endgame';
import { computeVolatilityBundle } from './volatility';

/**
 * Compute the full v3.0 Control Table
 * 
 * This function takes canonical inputs and produces a deterministic output.
 * Every intermediate value is computed in order with proper unit handling.
 */
export function computeControlTable(input: ControlTableInput): ControlTableOutput {
    // ============================================================================
    // 1. POSSESSIONS + PACE
    // ============================================================================
    const possBundle = computePossessionsBundle(
        input.homeBox,
        input.awayBox,
        input.elapsedMin,
        input.remMin,
        input.pacePre48
    );

    // ============================================================================
    // 2. LUCK + STRUCTURAL PPP
    // ============================================================================
    const expBundle = computeExpectationsBundle(
        input.ptsHome,
        input.ptsAway,
        input.homeBox,
        input.awayBox,
        possBundle.possHome,
        possBundle.possAway,
        input.exp3pPctHome,
        input.exp2pPctHome,
        input.exp3pPctAway,
        input.exp2pPctAway,
        input.mktAnchorTotal,
        input.pacePre48,
        possBundle.w
    );

    // ============================================================================
    // 3. LINEUP ADJUSTMENT + RAW PROJECTION
    // ============================================================================
    const lineupBundle = computeLineupBundle(
        input.ptsHome,
        input.ptsAway,
        possBundle.remPoss,
        expBundle.projPpp,
        input.sumCurrentEpmHome,
        input.avgTeamEpmHome,
        input.sumCurrentEpmAway,
        input.avgTeamEpmAway
    );

    // ============================================================================
    // 4. ENDGAME EV (FOUL + OT)
    // ============================================================================
    const endgameBundle = computeEndgameBundle(
        lineupBundle.rawProj,
        input.ptsHome,
        input.ptsAway,
        input.remMin,
        input.timeoutsHome,
        input.timeoutsAway,
        input.inBonusHome,
        input.inBonusAway
    );

    // ============================================================================
    // 5. VOLATILITY + EDGE_Z
    // ============================================================================
    const volBundle = computeVolatilityBundle(
        endgameBundle.modelFair,
        input.liveMarketTotal,
        possBundle.remPoss,
        possBundle.threeParateGame
    );

    // ============================================================================
    // 6. ASSEMBLE OUTPUT
    // ============================================================================
    return {
        // Anchor
        anchorPpp: expBundle.anchorPpp,

        // Possessions
        possHome: possBundle.possHome,
        possAway: possBundle.possAway,
        possLive: possBundle.possLive,
        livePace48: possBundle.livePace48,
        paceBlend48: possBundle.paceBlend48,
        remPoss: possBundle.remPoss,

        // Luck
        luckGapHome: expBundle.luckGapHome,
        luckGapAway: expBundle.luckGapAway,
        luckGap: expBundle.luckGap,

        // Structural
        structPppHome: expBundle.structPppHome,
        structPppAway: expBundle.structPppAway,
        structPpp: expBundle.structPpp,

        // Projection
        projPpp: expBundle.projPpp,
        lineupAdjPpp: lineupBundle.lineupAdjPpp,
        rawProj: lineupBundle.rawProj,

        // Endgame
        foulEv: endgameBundle.foulEv,
        otEv: endgameBundle.otEv,

        // Final
        modelFair: endgameBundle.modelFair,
        edgeZ: volBundle.edgeZ,
        volStd: volBundle.volStd,

        // Diagnostics
        w: possBundle.w,
        threeParateGame: possBundle.threeParateGame
    };
}

/**
 * Validate control table input for sanity
 */
export function validateControlTableInput(input: ControlTableInput): string[] {
    const errors: string[] = [];

    if (input.elapsedMin < 0) errors.push('elapsedMin cannot be negative');
    if (input.remMin < 0) errors.push('remMin cannot be negative');
    if (input.elapsedMin + input.remMin > 53) errors.push('elapsedMin + remMin exceeds max game length');
    if (input.ptsHome < 0) errors.push('ptsHome cannot be negative');
    if (input.ptsAway < 0) errors.push('ptsAway cannot be negative');
    if (input.pacePre48 <= 0) errors.push('pacePre48 must be positive');
    if (input.mktAnchorTotal <= 0) errors.push('mktAnchorTotal must be positive');
    if (input.liveMarketTotal <= 0) errors.push('liveMarketTotal must be positive');

    // Box stats validation
    const validateBox = (box: { fga: number; fgm: number; threePA: number; threePM: number; fta: number; ftm: number; tov: number; orb: number }, name: string) => {
        if (box.fgm > box.fga) errors.push(`${name}: fgm cannot exceed fga`);
        if (box.threePM > box.threePA) errors.push(`${name}: threePM cannot exceed threePA`);
        if (box.ftm > box.fta) errors.push(`${name}: ftm cannot exceed fta`);
        if (box.threePA > box.fga) errors.push(`${name}: threePA cannot exceed fga`);
        if (box.fga < 0 || box.fgm < 0 || box.threePA < 0 || box.threePM < 0 ||
            box.fta < 0 || box.ftm < 0 || box.tov < 0 || box.orb < 0) {
            errors.push(`${name}: all stats must be non-negative`);
        }
    };

    validateBox(input.homeBox, 'homeBox');
    validateBox(input.awayBox, 'awayBox');

    return errors;
}
