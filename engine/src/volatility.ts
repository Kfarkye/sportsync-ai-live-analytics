/**
 * NBA Live Totals Control Engine v3.0 - Volatility Module
 * Time-decayed volatility and Edge_Z calculations
 */

import { CONFIG } from './config';
import { clamp } from './math';

/**
 * Calculate base volatility standard deviation
 * Adjusts for high 3PA games
 */
export function computeBaseStd(threeParateGame: number): number {
    let baseStd = CONFIG.BASE_STD;

    // High 3PA games have more variance
    if (threeParateGame > CONFIG.HIGH_3PA_THRESHOLD) {
        baseStd *= CONFIG.HIGH_3PA_STD_MULTIPLIER;
    }

    return baseStd;
}

/**
 * Calculate time scalar for volatility decay
 * time_scalar = sqrt(max(1, remPoss) / 100), clamped
 * 
 * As game progresses (remPoss decreases), volatility decreases.
 */
export function computeTimeScalar(remPoss: number): number {
    const normalized = Math.max(1, remPoss) / 100;
    const scalar = Math.sqrt(normalized);
    return clamp(scalar, CONFIG.TIME_SCALAR_MIN, CONFIG.TIME_SCALAR_MAX);
}

/**
 * Calculate volatility standard deviation
 * vol_std = clamp(base_std * time_scalar)
 */
export function computeVolStd(baseStd: number, timeScalar: number): number {
    return clamp(baseStd * timeScalar, CONFIG.VOL_STD_MIN, CONFIG.VOL_STD_MAX);
}

/**
 * Calculate Edge Z-score
 * Edge_Z = (Model_Fair - Live_Mkt) / vol_std
 * 
 * Positive = Model expects more points than market (OVER)
 * Negative = Model expects fewer points than market (UNDER)
 */
export function computeEdgeZ(modelFair: number, liveMarketTotal: number, volStd: number): number {
    if (volStd <= 0) return 0;
    return (modelFair - liveMarketTotal) / volStd;
}

/**
 * Full volatility bundle
 */
export interface VolatilityBundle {
    baseStd: number;
    timeScalar: number;
    volStd: number;
    edgeZ: number;
}

export function computeVolatilityBundle(
    modelFair: number,
    liveMarketTotal: number,
    remPoss: number,
    threeParateGame: number
): VolatilityBundle {
    const baseStd = computeBaseStd(threeParateGame);
    const timeScalar = computeTimeScalar(remPoss);
    const volStd = computeVolStd(baseStd, timeScalar);
    const edgeZ = computeEdgeZ(modelFair, liveMarketTotal, volStd);

    return { baseStd, timeScalar, volStd, edgeZ };
}
