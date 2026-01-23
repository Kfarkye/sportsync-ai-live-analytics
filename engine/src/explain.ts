/**
 * NBA Live Totals Control Engine v3.0 - Explain Module
 * Driver identification and risk tagging for the WhyPanel
 */

import { ControlTableOutput } from './types';
import { CONFIG } from './config';

export type TopDriver =
    | 'LUCK_GAP'
    | 'LINEUP_ADJ'
    | 'FOUL_EV'
    | 'OT_EV'
    | 'PACE_DEVIATION'
    | 'STRUCTURAL_PPP'
    | 'NEUTRAL';

export type RiskTag =
    | 'HIGH_3PA_VOL'
    | 'FOUL_WINDOW'
    | 'BENCH_UNIT'
    | 'EARLY_GAME'
    | 'LOW_POSS'
    | 'NONE';

export interface WhyPanelData {
    anchorTotal: number;
    modelFair: number;
    edgeZ: number;
    topDriver: TopDriver;
    topDriverValue: number;
    riskTag: RiskTag;
    riskNote: string;
}

/**
 * Identify the top driver of the edge
 * Which component is contributing most to the deviation?
 */
export function identifyTopDriver(output: ControlTableOutput): { driver: TopDriver; value: number } {
    const drivers: Array<{ driver: TopDriver; value: number; impact: number }> = [];

    // Luck gap impact (converted to points via remPoss)
    const luckImpact = Math.abs(output.luckGap) * (output.remPoss / output.paceBlend48);
    drivers.push({ driver: 'LUCK_GAP', value: output.luckGap, impact: luckImpact });

    // Lineup adjustment impact (multiplied by remPoss)
    const lineupImpact = Math.abs(output.lineupAdjPpp * output.remPoss);
    drivers.push({ driver: 'LINEUP_ADJ', value: output.lineupAdjPpp, impact: lineupImpact });

    // Foul EV (direct points)
    drivers.push({ driver: 'FOUL_EV', value: output.foulEv, impact: output.foulEv });

    // OT EV (direct points)
    drivers.push({ driver: 'OT_EV', value: output.otEv, impact: output.otEv });

    // Pace deviation impact
    const paceDeviation = output.livePace48 - output.paceBlend48;
    const paceImpact = Math.abs(paceDeviation * (48 - (48 * output.w)) / 48);
    drivers.push({ driver: 'PACE_DEVIATION', value: paceDeviation, impact: paceImpact });

    // Sort by impact and return top
    drivers.sort((a, b) => b.impact - a.impact);

    const top = drivers[0];
    if (top.impact < 0.5) {
        return { driver: 'NEUTRAL', value: 0 };
    }

    return { driver: top.driver, value: top.value };
}

/**
 * Identify relevant risk tag
 */
export function identifyRiskTag(
    output: ControlTableOutput,
    elapsedMin: number
): { tag: RiskTag; note: string } {
    // Check for high 3PA volatility
    if (output.threeParateGame > CONFIG.HIGH_3PA_THRESHOLD) {
        return {
            tag: 'HIGH_3PA_VOL',
            note: `Game has ${(output.threeParateGame * 100).toFixed(0)}% 3PA rate - elevated variance`
        };
    }

    // Check for foul window
    if (output.foulEv > 3) {
        return {
            tag: 'FOUL_WINDOW',
            note: `Late game foul scenario likely - ${output.foulEv.toFixed(1)} pts expected`
        };
    }

    // Check for early game
    if (elapsedMin < CONFIG.EARLY_GAME_MINUTES) {
        return {
            tag: 'EARLY_GAME',
            note: `Only ${elapsedMin.toFixed(1)} min elapsed - higher threshold required`
        };
    }

    // Check for low possessions data
    if (output.possLive < CONFIG.MIN_POSSESSIONS_THRESHOLD * 2) {
        return {
            tag: 'LOW_POSS',
            note: `Limited possession data (${output.possLive.toFixed(1)}) - model less certain`
        };
    }

    // Check for bench unit (negative lineup adjustment)
    if (output.lineupAdjPpp < -0.03) {
        return {
            tag: 'BENCH_UNIT',
            note: `Current lineups ${(output.lineupAdjPpp * 100).toFixed(1)} PPP below team average`
        };
    }

    return { tag: 'NONE', note: 'No elevated risk factors' };
}

/**
 * Generate WhyPanel data
 */
export function generateWhyPanel(
    output: ControlTableOutput,
    anchorTotal: number,
    elapsedMin: number
): WhyPanelData {
    const { driver, value } = identifyTopDriver(output);
    const { tag, note } = identifyRiskTag(output, elapsedMin);

    return {
        anchorTotal,
        modelFair: output.modelFair,
        edgeZ: output.edgeZ,
        topDriver: driver,
        topDriverValue: value,
        riskTag: tag,
        riskNote: note
    };
}

/**
 * Format driver for display
 */
export function formatDriver(driver: TopDriver, value: number): string {
    switch (driver) {
        case 'LUCK_GAP':
            return value > 0
                ? `Cold shooting: +${value.toFixed(1)} pts expected to revert`
                : `Hot shooting: ${value.toFixed(1)} pts expected to revert`;
        case 'LINEUP_ADJ':
            return value > 0
                ? `Strong lineup: +${(value * 100).toFixed(1)} PPP vs team avg`
                : `Weak lineup: ${(value * 100).toFixed(1)} PPP vs team avg`;
        case 'FOUL_EV':
            return `Foul scenario: +${value.toFixed(1)} pts expected`;
        case 'OT_EV':
            return `OT probability: +${value.toFixed(1)} pts expected`;
        case 'PACE_DEVIATION':
            return value > 0
                ? `Pace running high: +${value.toFixed(1)} vs blend`
                : `Pace running low: ${value.toFixed(1)} vs blend`;
        case 'STRUCTURAL_PPP':
            return `Structural efficiency deviation`;
        default:
            return 'No dominant driver';
    }
}
