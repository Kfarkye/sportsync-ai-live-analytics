/**
 * NBA Live Totals Control Engine v3.0 - Configuration
 * All tunable parameters in one place
 */

export const CONFIG = {
    // ============================================================================
    // ENGINE CONSTANTS
    // ============================================================================

    /** Minutes in an NBA game (regulation) */
    GAME_MINUTES: 48,

    /** FTA coefficient for possessions formula */
    FTA_COEFFICIENT: 0.44,

    // ============================================================================
    // EXPECTATION CLAMPS (regressed priors)
    // ============================================================================

    /** 3P% clamp range */
    EXP_3P_PCT_MIN: 0.28,
    EXP_3P_PCT_MAX: 0.44,

    /** 2P% clamp range */
    EXP_2P_PCT_MIN: 0.44,
    EXP_2P_PCT_MAX: 0.62,

    // ============================================================================
    // VOLATILITY PARAMETERS
    // ============================================================================

    /** Base volatility standard deviation */
    BASE_STD: 13.0,

    /** Multiplier for high 3PA games (>40% 3PA rate) */
    HIGH_3PA_THRESHOLD: 0.40,
    HIGH_3PA_STD_MULTIPLIER: 1.15,

    /** Vol std floor and ceiling */
    VOL_STD_MIN: 2.0,
    VOL_STD_MAX: 18.0,

    /** Time scalar clamps */
    TIME_SCALAR_MIN: 0.20,
    TIME_SCALAR_MAX: 1.00,

    // ============================================================================
    // ENDGAME EV PARAMETERS
    // ============================================================================

    /** Foul EV bounds */
    FOUL_EV_MAX: 14.0,
    FOUL_EV_MIN: 0.0,

    /** OT EV bounds */
    OT_EV_MAX: 10.0,
    OT_EV_MIN: 0.0,

    /** When to start applying foul EV (remaining minutes) */
    FOUL_EV_THRESHOLD_MIN: 4.0,

    /** Score differential threshold for OT probability */
    OT_SCORE_DIFF_THRESHOLD: 6,

    /** Average OT scoring (empirical ~10-12 points total) */
    EXPECTED_OT_POINTS: 11.0,

    // ============================================================================
    // TRIGGER THRESHOLDS
    // ============================================================================

    /** Standard Edge_Z threshold for firing */
    EDGE_Z_THRESHOLD: 1.5,

    /** Early game (first N minutes) requires higher Z */
    EARLY_GAME_MINUTES: 6,
    EARLY_GAME_Z_THRESHOLD: 2.0,

    /** Minimum consecutive ticks required for confirmation */
    CONFIRMATION_TICKS: 2,

    /** Cooldown between decisions (seconds) */
    DECISION_COOLDOWN_SECONDS: 60,

    /** Large Edge_Z growth to override cooldown */
    COOLDOWN_OVERRIDE_DELTA: 0.5,

    // ============================================================================
    // SANITY GUARDS
    // ============================================================================

    /** Maximum score change per tick before freeze */
    MAX_SCORE_DELTA_PER_TICK: 12,

    /** Freeze duration after sanity violation (seconds) */
    SANITY_FREEZE_SECONDS: 60,

    /** Minimum possessions before model is valid */
    MIN_POSSESSIONS_THRESHOLD: 5,

    // ============================================================================
    // EPM SCALING
    // ============================================================================

    /** EPM is per 100 possessions; divide by 100 to get PPP delta */
    EPM_PER_100_DIVISOR: 100,

    // ============================================================================
    // CALIBRATION DEFAULTS
    // ============================================================================

    /** Default calibration adjustments */
    DEFAULT_CALIBRATION: {
        baseStd: 13.0,
        highThreePaMultiplier: 1.15,
        earlyGameZThreshold: 2.0,
        foulEvMultiplier: 1.0,
        otEvMultiplier: 1.0,
        pppOffsetByBucket: {} as Record<string, number>
    }
} as const;

export type ConfigType = typeof CONFIG;
