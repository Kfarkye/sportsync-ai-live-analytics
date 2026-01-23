/**
 * NBA Live Totals Control Engine v3.0 - Sanity Module
 * Tick validation and monotonicity guards
 */

import { CONFIG } from './config';
import { TickInput, TeamBoxLine } from './types';
import { computeTeamPossessions } from './possessions';

export interface SanityResult {
    isValid: boolean;
    shouldFreeze: boolean;
    freezeUntil: Date | null;
    errors: string[];
    warnings: string[];
}

/**
 * Validate that a tick is monotonic with respect to the previous tick
 */
export function validateMonotonicity(
    currentTick: TickInput,
    previousTick: TickInput | null
): SanityResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!previousTick) {
        return { isValid: true, shouldFreeze: false, freezeUntil: null, errors: [], warnings: [] };
    }

    // Score cannot decrease
    const totalScoreCurrent = currentTick.ptsHome + currentTick.ptsAway;
    const totalScorePrevious = previousTick.ptsHome + previousTick.ptsAway;

    if (totalScoreCurrent < totalScorePrevious) {
        errors.push(`Score decreased: ${totalScorePrevious} -> ${totalScoreCurrent}`);
    }

    // Elapsed time cannot decrease
    if (currentTick.elapsedMin < previousTick.elapsedMin) {
        errors.push(`Elapsed time decreased: ${previousTick.elapsedMin} -> ${currentTick.elapsedMin}`);
    }

    // Possessions cannot decrease
    const possCurrentHome = computeTeamPossessions(currentTick.homeBox);
    const possCurrentAway = computeTeamPossessions(currentTick.awayBox);
    const possPrevHome = computeTeamPossessions(previousTick.homeBox);
    const possPrevAway = computeTeamPossessions(previousTick.awayBox);

    if (possCurrentHome < possPrevHome - 0.5) { // Small tolerance for rounding
        warnings.push(`Home possessions decreased: ${possPrevHome} -> ${possCurrentHome}`);
    }
    if (possCurrentAway < possPrevAway - 0.5) {
        warnings.push(`Away possessions decreased: ${possPrevAway} -> ${possCurrentAway}`);
    }

    // Large score jump without time advance
    const scoreDelta = totalScoreCurrent - totalScorePrevious;
    const timeDelta = currentTick.elapsedMin - previousTick.elapsedMin;

    if (scoreDelta > CONFIG.MAX_SCORE_DELTA_PER_TICK && timeDelta < 0.5) {
        errors.push(`Large score jump (${scoreDelta}) without time advance - possible stat correction`);
    }

    // Determine if we should freeze
    const shouldFreeze = errors.length > 0;
    const freezeUntil = shouldFreeze
        ? new Date(Date.now() + CONFIG.SANITY_FREEZE_SECONDS * 1000)
        : null;

    return {
        isValid: errors.length === 0,
        shouldFreeze,
        freezeUntil,
        errors,
        warnings
    };
}

/**
 * Validate box stats are reasonable
 */
export function validateBoxStats(box: TeamBoxLine, teamName: string): string[] {
    const errors: string[] = [];

    // Made cannot exceed attempted
    if (box.fgm > box.fga) errors.push(`${teamName}: FGM (${box.fgm}) > FGA (${box.fga})`);
    if (box.threePM > box.threePA) errors.push(`${teamName}: 3PM (${box.threePM}) > 3PA (${box.threePA})`);
    if (box.ftm > box.fta) errors.push(`${teamName}: FTM (${box.ftm}) > FTA (${box.fta})`);

    // 3PA cannot exceed FGA
    if (box.threePA > box.fga) errors.push(`${teamName}: 3PA (${box.threePA}) > FGA (${box.fga})`);

    // All stats must be non-negative
    if (box.fga < 0) errors.push(`${teamName}: negative FGA`);
    if (box.fgm < 0) errors.push(`${teamName}: negative FGM`);
    if (box.threePA < 0) errors.push(`${teamName}: negative 3PA`);
    if (box.threePM < 0) errors.push(`${teamName}: negative 3PM`);
    if (box.fta < 0) errors.push(`${teamName}: negative FTA`);
    if (box.ftm < 0) errors.push(`${teamName}: negative FTM`);
    if (box.tov < 0) errors.push(`${teamName}: negative TOV`);
    if (box.orb < 0) errors.push(`${teamName}: negative ORB`);

    // Sanity checks on magnitude
    if (box.fga > 120) errors.push(`${teamName}: FGA (${box.fga}) exceeds reasonable max`);
    if (box.tov > 40) errors.push(`${teamName}: TOV (${box.tov}) exceeds reasonable max`);

    return errors;
}

/**
 * Full tick validation
 */
export function validateTick(
    tick: TickInput,
    previousTick: TickInput | null
): SanityResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate box stats
    errors.push(...validateBoxStats(tick.homeBox, 'Home'));
    errors.push(...validateBoxStats(tick.awayBox, 'Away'));

    // Validate time
    if (tick.elapsedMin < 0) errors.push('Negative elapsed time');
    if (tick.remMin < 0) errors.push('Negative remaining time');
    if (tick.elapsedMin + tick.remMin > 53) warnings.push('Total time exceeds max game length (likely OT)');

    // Validate scores
    if (tick.ptsHome < 0) errors.push('Negative home score');
    if (tick.ptsAway < 0) errors.push('Negative away score');

    // Validate score consistency with box stats
    const expectedPtsHome = computeExpectedPoints(tick.homeBox);
    const expectedPtsAway = computeExpectedPoints(tick.awayBox);

    // Allow some tolerance for and-ones, goaltending, etc.
    if (Math.abs(tick.ptsHome - expectedPtsHome) > 3) {
        warnings.push(`Home score (${tick.ptsHome}) diverges from expected (${expectedPtsHome})`);
    }
    if (Math.abs(tick.ptsAway - expectedPtsAway) > 3) {
        warnings.push(`Away score (${tick.ptsAway}) diverges from expected (${expectedPtsAway})`);
    }

    // Check monotonicity
    const monoResult = validateMonotonicity(tick, previousTick);
    errors.push(...monoResult.errors);
    warnings.push(...monoResult.warnings);

    const shouldFreeze = errors.length > 0 || monoResult.shouldFreeze;
    const freezeUntil = shouldFreeze
        ? new Date(Date.now() + CONFIG.SANITY_FREEZE_SECONDS * 1000)
        : null;

    return {
        isValid: errors.length === 0,
        shouldFreeze,
        freezeUntil,
        errors,
        warnings
    };
}

/**
 * Compute expected points from box stats
 * Points = 3*3PM + 2*(FGM-3PM) + 1*FTM = 3PM + 2*FGM + FTM
 */
function computeExpectedPoints(box: TeamBoxLine): number {
    const twoPM = box.fgm - box.threePM;
    return 3 * box.threePM + 2 * twoPM + box.ftm;
}

/**
 * Check if model has enough data to be valid
 */
export function hasMinimumData(tick: TickInput): boolean {
    const possHome = computeTeamPossessions(tick.homeBox);
    const possAway = computeTeamPossessions(tick.awayBox);
    const possLive = (possHome + possAway) / 2;

    return possLive >= CONFIG.MIN_POSSESSIONS_THRESHOLD;
}
