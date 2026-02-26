/**
 * betSlipSchema.ts
 * Production-grade Zod schemas for AI bet slip extraction.
 *
 * Architecture:
 * ├─ AIParsedLegSchema  — what we ask the AI to extract (NO IDs)
 * ├─ AIParsedSlipSchema — the full slip from AI
 * ├─ AppBetLeg          — frontend type (with server-injected UUID)
 * └─ AppBetSlip         — frontend slip (with server-injected UUIDs)
 *
 * CRITICAL: We never ask the LLM to generate UUIDs. LLMs hallucinate
 * sequential or fake UUIDs. IDs are injected server-side via crypto.randomUUID().
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// §1  AI EXTRACTION SCHEMA (What we send to Gemini Vision)
// ═══════════════════════════════════════════════════════════════════════════

export const AIParsedLegSchema = z.object({
    /** Player name or team name, e.g., "Zion Williamson" or "Pelicans" */
    entity_name: z.string().describe("e.g., 'Zion Williamson' or 'Pelicans'"),

    /** Market type classification */
    market_type: z.enum(['moneyline', 'spread', 'total', 'player_prop']),

    /**
     * The numerical line for the bet (e.g., -6.5 for spread, 24.5 for prop).
     * z.coerce forces strings like "-6.5" into numbers, preventing AI validation crashes.
     * Null for moneyline bets.
     */
    line: z.coerce.number().nullable().describe("e.g., -6.5 or 24.5. Null if moneyline"),

    /**
     * Direction for spread/total bets.
     * "over" / "under" for totals and player props.
     * "home" / "away" for spreads. Null for moneyline.
     */
    direction: z.enum(['over', 'under', 'home', 'away']).nullable()
        .describe("Bet direction. Null for moneyline."),

    /**
     * American odds, e.g., -110 or +150.
     * z.coerce handles AI returning strings like "-110" instead of -110.
     */
    odds: z.coerce.number().describe("American odds, e.g., -110 or 150"),

    // ─── Production Safeguards ───
    /** AI self-assessment of extraction accuracy (0-100) */
    confidence_score: z.coerce.number().min(0).max(100)
        .describe("AI confidence in this extraction, 0-100"),

    /** True if image is blurry, cropped, or odds are hard to read */
    needs_review: z.boolean()
        .describe("True if image is blurry, cropped, or odds are hard to read"),
});

export const AIParsedSlipSchema = z.object({
    /** Detected sportsbook from UI chrome/branding */
    sportsbook: z.enum(['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'Unknown']),

    /** Wager type if detectable */
    wager_type: z.enum(['straight', 'parlay', 'sgp', 'round_robin', 'unknown'])
        .default('unknown')
        .describe("Detected wager type from slip layout"),

    /** Total stake in dollars, null if not visible */
    total_stake: z.coerce.number().nullable(),

    /** Total potential payout in dollars, null if not visible */
    total_payout: z.coerce.number().nullable(),

    /** Individual legs extracted from the slip */
    legs: z.array(AIParsedLegSchema).min(1),
});

// ═══════════════════════════════════════════════════════════════════════════
// §2  APP-FACING TYPES (With server-injected IDs)
// ═══════════════════════════════════════════════════════════════════════════

/** A single bet leg with a reliable server-generated UUID */
export type AppBetLeg = z.infer<typeof AIParsedLegSchema> & {
    id: string;
    /** Optional: resolved match_id from your database */
    match_id?: string;
    /** Live status once tracking begins */
    live_status?: 'pending' | 'winning' | 'losing' | 'won' | 'lost' | 'push';
    /** Current live value for props (e.g., 18 of 24.5 pts) */
    current_value?: number;
};

/** The full bet slip with server-injected IDs on all legs */
export type AppBetSlip = Omit<z.infer<typeof AIParsedSlipSchema>, 'legs'> & {
    id: string;
    legs: AppBetLeg[];
    /** ISO timestamp of when this slip was parsed */
    parsed_at: string;
    /** Whether all legs have been user-verified */
    verified: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════
// §3  PURE MATH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert American odds to implied probability.
 * Handles both positive (+150) and negative (-110) odds.
 */
export function americanToImpliedProbability(odds: number): number {
    if (odds === 0) return 0;
    if (odds > 0) return 100 / (odds + 100);
    return Math.abs(odds) / (Math.abs(odds) + 100);
}

/**
 * Convert American odds to decimal odds.
 */
export function americanToDecimal(odds: number): number {
    if (odds === 0) return 1;
    if (odds > 0) return (odds / 100) + 1;
    return (100 / Math.abs(odds)) + 1;
}

/**
 * Calculate the fair value of a parlay given individual leg probabilities.
 * Returns the no-vig probability of all legs hitting.
 */
export function parlayFairProbability(legOdds: number[]): number {
    return legOdds.reduce((acc, odds) => acc * americanToImpliedProbability(odds), 1);
}

/**
 * Calculate whether a cash-out offer is above or below fair value.
 * Returns: positive = book is offering MORE than fair value (take it),
 *          negative = book is offering LESS (hold or hedge).
 */
export function cashOutEdge(
    cashOutOffer: number,
    originalStake: number,
    remainingLegOdds: number[]
): number {
    const remainingProb = parlayFairProbability(remainingLegOdds);
    const fairValue = originalStake * remainingLegOdds.reduce(
        (acc, odds) => acc * americanToDecimal(odds), 1
    ) * remainingProb;
    return ((cashOutOffer - fairValue) / fairValue) * 100;
}
