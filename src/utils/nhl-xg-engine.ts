/**
 * LIVE NHL xG ENGINE (Production Grade)
 * 
 * Logic Verified: SOG-Calibration, Market Anchoring, Shell Detection.
 * 
 */

// ============================================================================
// 1. CONFIGURATION (Tunable Constants)
// ============================================================================

export const XG_CONFIG = {
    // BASE RATES (SOG-Calibrated for 2024-25 NHL Avg ~9.5%)
    BASE_RATES: {
        ES: 0.092, // Even Strength
        PP: 0.145, // Power Play
        SH: 0.120, // Short Handed (High danger breakaways)
    },

    // FORCE MULTIPLIERS (Contextual Adjustments)
    MULTIPLIERS: {
        BREAKAWAY: 2.50, // Text-tagged high danger
        REBOUND: 1.60,   // Shots within 3s of previous shot
        TIP: 1.50,       // Deflections
        SLAP_ES: 0.65,   // Low % point shots
    },

    // DEFENSIVE SHELL (Patch for "Gap: Defensive Structure")
    // Applied in Period 3 (>40m) when score diff exists
    SHELL: {
        LEADING_TEAM: 0.80,  // "Turtle" penalty: Leading team kills their own offense
        TRAILING_TEAM: 0.90, // "Perimeter" penalty: Trailing team forced to outside
        START_MINUTE: 45.0,  // Activation time
    },

    // CONSTANTS
    REBOUND_WINDOW: 3.0,   // Seconds to consider a shot a rebound
    SHOT_HARD_CAP: 0.75,   // Max xG for any single event
    MIN_EVENTS_TRUST: 15,  // Shots needed to fully trust live rate over pre-game line

    // LATE GAME OVERRIDES
    OVERRIDES: {
        TIED_DECAY: 0.75, // "Loser Point" Lull (<8 mins left)
        EN_1G: 0.85,      // Empty Net (+1 diff)
        EN_2G: 0.45,      // Empty Net (+2 diff)
    }
} as const;

// ============================================================================
// 2. TYPES
// ============================================================================

export type GameState = "ES" | "PP" | "SH" | string;
export type GoalieTier = "ELITE" | "AVG" | "WEAK";

export interface ShotEvent {
    id: string;
    minuteMark: number;     // 0.0 to 60.0
    state: GameState;
    shotText: string;
    isHomeTeam: boolean;
    isTrailing: boolean;
    isLeading: boolean;
}

export interface ProjectionResult {
    currentTotal: number;
    projectedTotal: number;
    confidence: number;
    activeOverrides: string[];
    debug: {
        marketBaseline: number;
        liveRate: number;
        blendedRate: number;
    };
}

// ============================================================================
// 3. HELPER FUNCTIONS
// ============================================================================

const RE_BREAKAWAY = /\b(breakaway|penalty shot)\b/i;
const RE_TIP = /\b(tip|deflection|deflected)\b/i;
const RE_SLAP = /\bslap shot\b/i;

/** 
 * Patch for "Gap: Goalie Quality" 
 * ELITE: Hellebuyck/Shesterkin (~.925+)
 * WEAK: Backups/Slumping Starters (<.890)
 */
export function getGoalieScalar(tier: GoalieTier): number {
    if (tier === "ELITE") return 0.92;
    if (tier === "WEAK") return 1.12;
    return 1.00;
}

export function calculatePerShotXG(
    ev: ShotEvent,
    prevEv: ShotEvent | null,
    oppGoalieTier: GoalieTier
): number {
    const { BASE_RATES, MULTIPLIERS, SHELL, REBOUND_WINDOW, SHOT_HARD_CAP } = XG_CONFIG;

    // 1. Base Rate Selection
    let xg: number = BASE_RATES.ES;
    const state = (ev.state || "").toUpperCase();
    if (state === "PP") xg = BASE_RATES.PP;
    if (state === "SH") xg = BASE_RATES.SH;

    // 2. Goalie Adjustment
    xg *= getGoalieScalar(oppGoalieTier);

    // 3. Text & Time Enhancements
    let isRebound = false;

    // A. Breakaway (Text)
    if (RE_BREAKAWAY.test(ev.shotText)) {
        xg *= MULTIPLIERS.BREAKAWAY;
    }
    // B. Rebound (Time + Team Identity)
    else if (prevEv && ev.isHomeTeam === prevEv.isHomeTeam) {
        const timeDiffSec = (ev.minuteMark - prevEv.minuteMark) * 60;
        if (timeDiffSec > 0 && timeDiffSec <= REBOUND_WINDOW) {
            xg *= MULTIPLIERS.REBOUND;
            isRebound = true;
        }
    }

    // C. Tip/Slap (Text)
    if (!isRebound && RE_TIP.test(ev.shotText)) {
        xg *= MULTIPLIERS.TIP;
    } else if (state === "ES" && RE_SLAP.test(ev.shotText)) {
        xg *= MULTIPLIERS.SLAP_ES;
    }

    // 4. Defensive Shell Logic (Period 3)
    if (ev.minuteMark > SHELL.START_MINUTE) {
        if (ev.isLeading) {
            xg *= SHELL.LEADING_TEAM; // Penalty for turtling
        } else if (ev.isTrailing) {
            xg *= SHELL.TRAILING_TEAM; // Penalty for perimeter forcing
        }
    }

    return Math.min(xg, SHOT_HARD_CAP);
}

// ============================================================================
// 4. MAIN PROJECTION ENGINE
// ============================================================================

export function projectLiveTotal(
    events: ShotEvent[],
    currentHomeGoals: number,
    currentAwayGoals: number,
    minutesElapsed: number,
    preGameTotal: number = 6.5, // CRITICAL: Market Anchor
    homeGoalie: GoalieTier = "AVG",
    awayGoalie: GoalieTier = "AVG"
): ProjectionResult {

    const { MIN_EVENTS_TRUST, OVERRIDES } = XG_CONFIG;
    const activeOverrides: string[] = [];

    // 1. ESTABLISH BASELINE (The "Sharp" Fix)
    // We anchor to the pre-game total to avoid early-game hallucinations.
    const marketBaselineRate = (preGameTotal || 6.5) / 60.0;

    // 2. ACCUMULATE LIVE xG
    let xgBanked = 0;
    let prevEvent: ShotEvent | null = null;

    // Ensure events are chronological for rebound logic
    const sortedEvents = [...events].sort((a, b) => a.minuteMark - b.minuteMark);

    for (const ev of sortedEvents) {
        const oppGoalie = ev.isHomeTeam ? awayGoalie : homeGoalie;
        const val = calculatePerShotXG(ev, prevEvent, oppGoalie);
        xgBanked += val;
        prevEvent = ev;
    }

    // 3. REGRESSION (TRUST CURVE)
    const safeElapsed = Math.max(minutesElapsed, 0.1);
    const observedRate = xgBanked / safeElapsed;

    // We trust live data more as sample size (n events) grows
    const rawWeight = sortedEvents.length / MIN_EVENTS_TRUST;
    // Floor trust at 15% so we never completely ignore a hot start
    const weight = Math.max(0.15, Math.min(1.0, rawWeight));

    const blendedRate = (observedRate * weight) + (marketBaselineRate * (1.0 - weight));

    // 4. PROJECT REMAINDER
    const minutesRemaining = Math.max(0, 60.0 - minutesElapsed);
    let futureXG = blendedRate * minutesRemaining;

    // 5. LATE GAME OVERRIDES
    const scoreDiff = Math.abs(currentHomeGoals - currentAwayGoals);
    const isTied = scoreDiff === 0;

    // A. Tied Game Decay ("Loser Point")
    if (minutesRemaining < 8.0 && isTied) {
        futureXG *= OVERRIDES.TIED_DECAY;
        activeOverrides.push("TIED_DECAY");
    }

    // B. Empty Net Injection
    if (minutesRemaining < 2.5 && !isTied) {
        if (scoreDiff === 1) {
            futureXG += OVERRIDES.EN_1G;
            activeOverrides.push("EN_1G");
        } else if (scoreDiff === 2) {
            futureXG += OVERRIDES.EN_2G;
            activeOverrides.push("EN_2G");
        }
    }

    return {
        currentTotal: currentHomeGoals + currentAwayGoals,
        projectedTotal: Number((currentHomeGoals + currentAwayGoals + futureXG).toFixed(2)),
        confidence: Number(weight.toFixed(2)),
        activeOverrides,
        debug: {
            marketBaseline: Number(marketBaselineRate.toFixed(3)),
            liveRate: Number(observedRate.toFixed(3)),
            blendedRate: Number(blendedRate.toFixed(3)),
        }
    };
}
