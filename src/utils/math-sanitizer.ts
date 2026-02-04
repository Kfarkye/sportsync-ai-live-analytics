/**
 * v1.6 ZERO-TRUST MATH SANITIZER
 * Hardens inputs against aggressive feed anomalies.
 */

export function sanitizeFloat(
    val: unknown,
    min: number,
    max: number,
    defaultValue: number,
    autoScale: boolean = false
): number {
    try {
        if (val === null || val === undefined) return defaultValue;

        let fVal = typeof val === 'number' ? val : parseFloat(String(val));

        if (!Number.isFinite(fVal)) {
            return defaultValue;
        }

        /**
         * AUTO-SCALING HEURISTIC (v1.6)
         * Detects if a percentage (e.g. 15.0) was sent in a 0-1 range (max <= 1.0)
         * and automatically scales it (e.g. 15.0 -> 0.15).
         */
        if (autoScale && fVal > 1.0 && max <= 1.0) {
            fVal = fVal / 100.0;
        }

        return Math.max(min, Math.min(fVal, max));
    } catch {
        return defaultValue;
    }
}

export function sanitizeInt(
    val: unknown,
    min: number,
    max: number,
    defaultValue: number
): number {
    try {
        if (val === null || val === undefined) return defaultValue;

        // Safely cast "24.0" -> 24
        let fVal = typeof val === 'number' ? val : parseFloat(String(val));

        if (!Number.isFinite(fVal)) {
            return defaultValue;
        }

        const iVal = Math.floor(fVal);
        return Math.max(min, Math.min(iVal, max));
    } catch {
        return defaultValue;
    }
}
