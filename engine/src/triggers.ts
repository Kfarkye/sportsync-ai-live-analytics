/**
 * NBA Live Totals Control Engine v3.0 - Triggers Module
 * Decision logic with confirmation, cooldown, and safety gates
 */

import { CONFIG } from './config';
import { ControlTableOutput, TriggerState, DecisionOutput, DecisionSide } from './types';

/**
 * Check if we're in early game period (requires higher threshold)
 */
export function isEarlyGame(elapsedMin: number): boolean {
    return elapsedMin < CONFIG.EARLY_GAME_MINUTES;
}

/**
 * Get required Edge_Z threshold for current game state
 */
export function getRequiredThreshold(elapsedMin: number): number {
    if (isEarlyGame(elapsedMin)) {
        return CONFIG.EARLY_GAME_Z_THRESHOLD;
    }
    return CONFIG.EDGE_Z_THRESHOLD;
}

/**
 * Determine raw signal direction from Edge_Z
 */
export function getRawSignal(edgeZ: number, threshold: number): DecisionSide {
    if (edgeZ >= threshold) return 'OVER';
    if (edgeZ <= -threshold) return 'UNDER';
    return 'PASS';
}

/**
 * Check if cooldown period has elapsed since last decision
 */
export function isCooldownElapsed(
    lastDecisionTs: Date | null,
    currentTs: Date
): boolean {
    if (!lastDecisionTs) return true;

    const elapsedMs = currentTs.getTime() - lastDecisionTs.getTime();
    const cooldownMs = CONFIG.DECISION_COOLDOWN_SECONDS * 1000;

    return elapsedMs >= cooldownMs;
}

/**
 * Check if Edge_Z has grown enough to override cooldown
 */
export function shouldOverrideCooldown(
    currentEdgeZ: number,
    lastDecisionSide: DecisionSide | null,
    threshold: number
): boolean {
    if (!lastDecisionSide || lastDecisionSide === 'PASS') return false;

    // Check if edge has grown materially in the same direction
    if (lastDecisionSide === 'OVER' && currentEdgeZ >= threshold + CONFIG.COOLDOWN_OVERRIDE_DELTA) {
        return true;
    }
    if (lastDecisionSide === 'UNDER' && currentEdgeZ <= -(threshold + CONFIG.COOLDOWN_OVERRIDE_DELTA)) {
        return true;
    }

    return false;
}

/**
 * Update confirmation state based on current edge
 */
export function updateConfirmationState(
    state: TriggerState,
    rawSignal: DecisionSide
): TriggerState {
    const newState = { ...state };

    if (rawSignal === 'OVER') {
        newState.consecutiveOverTicks++;
        newState.consecutiveUnderTicks = 0;
    } else if (rawSignal === 'UNDER') {
        newState.consecutiveUnderTicks++;
        newState.consecutiveOverTicks = 0;
    } else {
        // PASS resets both
        newState.consecutiveOverTicks = 0;
        newState.consecutiveUnderTicks = 0;
    }

    return newState;
}

/**
 * Check if confirmation requirement is met
 */
export function isConfirmed(state: TriggerState, side: DecisionSide): boolean {
    if (side === 'OVER') {
        return state.consecutiveOverTicks >= CONFIG.CONFIRMATION_TICKS;
    }
    if (side === 'UNDER') {
        return state.consecutiveUnderTicks >= CONFIG.CONFIRMATION_TICKS;
    }
    return false;
}

/**
 * Generate reason codes for decision
 */
export function generateReasonCodes(
    output: ControlTableOutput,
    elapsedMin: number,
    side: DecisionSide
): string[] {
    const codes: string[] = [];

    // Edge strength
    const absZ = Math.abs(output.edgeZ);
    if (absZ >= 2.5) codes.push('EDGE_ELITE');
    else if (absZ >= 2.0) codes.push('EDGE_STRONG');
    else if (absZ >= 1.5) codes.push('EDGE_STANDARD');

    // Luck impact
    if (Math.abs(output.luckGap) > 6) {
        codes.push(output.luckGap > 0 ? 'LUCK_COLD' : 'LUCK_HOT');
    }

    // Pace impact
    if (output.livePace48 > output.paceBlend48 * 1.05) codes.push('PACE_HIGH');
    if (output.livePace48 < output.paceBlend48 * 0.95) codes.push('PACE_LOW');

    // Endgame factors
    if (output.foulEv > 2) codes.push('FOUL_SCENARIO');
    if (output.otEv > 1) codes.push('OT_RISK');

    // Lineup impact
    if (Math.abs(output.lineupAdjPpp) > 0.03) {
        codes.push(output.lineupAdjPpp > 0 ? 'LINEUP_STRONG' : 'LINEUP_WEAK');
    }

    // 3PA volatility
    if (output.threeParateGame > CONFIG.HIGH_3PA_THRESHOLD) {
        codes.push('HIGH_3PA_VOL');
    }

    // Game phase
    if (isEarlyGame(elapsedMin)) codes.push('EARLY_GAME');

    return codes;
}

/**
 * Evaluate trigger decision
 * Main entry point for trigger logic
 */
export function evaluateTrigger(
    output: ControlTableOutput,
    elapsedMin: number,
    currentTs: Date,
    state: TriggerState,
    liveMarketTotal: number
): { decision: DecisionOutput; newState: TriggerState } {
    const threshold = getRequiredThreshold(elapsedMin);
    const rawSignal = getRawSignal(output.edgeZ, threshold);

    // Update confirmation state
    const newState = updateConfirmationState(state, rawSignal);

    // Base decision
    const decision: DecisionOutput = {
        side: rawSignal,
        edgeZ: output.edgeZ,
        modelFair: output.modelFair,
        liveMkt: liveMarketTotal,
        reasonCodes: [],
        shouldFire: false
    };

    // Check if we should fire
    if (rawSignal !== 'PASS') {
        // Must be confirmed
        if (!isConfirmed(newState, rawSignal)) {
            decision.reasonCodes.push('AWAITING_CONFIRMATION');
            return { decision, newState };
        }

        // Check cooldown
        const cooldownOk = isCooldownElapsed(state.lastDecisionTs, currentTs);
        const overrideOk = shouldOverrideCooldown(output.edgeZ, state.lastDecisionSide, threshold);

        if (!cooldownOk && !overrideOk) {
            decision.reasonCodes.push('COOLDOWN_ACTIVE');
            return { decision, newState };
        }

        // All checks passed - fire!
        decision.shouldFire = true;
        decision.reasonCodes = generateReasonCodes(output, elapsedMin, rawSignal);

        // Update state with fired decision
        newState.lastDecisionTs = currentTs;
        newState.lastDecisionSide = rawSignal;
    }

    return { decision, newState };
}

/**
 * Create initial trigger state
 */
export function createInitialTriggerState(): TriggerState {
    return {
        consecutiveOverTicks: 0,
        consecutiveUnderTicks: 0,
        lastDecisionTs: null,
        lastDecisionSide: null
    };
}
