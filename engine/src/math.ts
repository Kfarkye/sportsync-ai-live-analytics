/**
 * NBA Live Totals Control Engine v3.0 - Math Utilities
 * Pure functions for common calculations
 */

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Safe division that returns 0 if denominator is 0
 */
export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
    if (denominator === 0 || !Number.isFinite(denominator)) {
        return fallback;
    }
    const result = numerator / denominator;
    return Number.isFinite(result) ? result : fallback;
}

/**
 * Calculate average of two numbers
 */
export function avg(a: number, b: number): number {
    return (a + b) / 2;
}

/**
 * Round to N decimal places
 */
export function roundTo(value: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

/**
 * Check if a number is within a range (inclusive)
 */
export function inRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
}

/**
 * Calculate standard deviation of an array
 */
export function stdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(variance);
}

/**
 * Calculate mean of an array
 */
export function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate median of an array
 */
export function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Calculate weighted average
 */
export function weightedAvg(value1: number, weight1: number, value2: number, weight2: number): number {
    const totalWeight = weight1 + weight2;
    if (totalWeight === 0) return 0;
    return (value1 * weight1 + value2 * weight2) / totalWeight;
}
