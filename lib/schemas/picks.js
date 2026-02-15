
import { z } from 'zod';

/**
 * BettingPickSchema
 * 
 * Strict Zod schema for validating AI-extracted betting picks.
 * This schema enforces domain-specific constraints (enums, types)
 * to ensure zero-garbage data enters the persistent storage.
 */
export const BettingPickSchema = z.object({
    /**
     * The primary action recommendation.
     * PASS: No bet recommended
     * BET: A specific bet is recommended
     * FADE: specifically recommending against a public sentiment (implies a bet on the other side, but usually treated as a BET contextually)
     */
    verdict: z.enum(['PASS', 'BET', 'FADE']).describe('The recommendation action. Use PASS if no clear bet is advised.'),

    /**
     * The type of wager.
     * spread: Point spread (e.g. -3.5, +7)
     * moneyline: Straight up win
     * total: Over/Under score
     * prop: Player or Team prop (future expansion)
     */
    pick_type: z.enum(['spread', 'moneyline', 'total', 'prop']).nullable().describe(
        'Type of bet. spread for handicaps, moneyline for win/loss, total for over/under.'
    ),

    /**
     * The entity being bet on.
     * CRITICAL: Use extracted game context to valid this.
     * For totals, usually null or can be "Over"/"Under" if mapped widely, but ideally formatted in pick_direction.
     */
    pick_team: z.string().nullable().describe(
        'The EXACT team name being bet on. Must match one of the teams in the game context. For Totals, return null.'
    ),

    /**
     * The direction of the bet.
     * For Spreads/ML: 'home' or 'away' relative to the match.
     * For Totals: 'over' or 'under'.
     */
    pick_direction: z.enum(['home', 'away', 'over', 'under']).nullable().describe(
        'The specific side of the bet. "home"/"away" for team bets, "over"/"under" for totals.'
    ),

    /**
     * The numerical line associated with the bet.
     * For Moneyline: usually null (or the odds if interpreted as line, but usually null).
     * For Spread: The handicap (e.g. -4.5).
     * For Total: The score threshold (e.g. 212.5).
     */
    pick_line: z.number().nullable().describe(
        'The numeric line or spread. e.g. -3.5, 220.5. Null for Moneyline.'
    ),

    /**
     * AI Confidence assesment.
     */
    confidence: z.enum(['low', 'medium', 'high']).describe(
        'Confidence level of the pick based on analysis confluence.'
    ),

    /**
     * Concise summary of why the pick was made.
     */
    reasoning_summary: z.string().max(300).describe(
        'A 1-2 sentence summary of the "edge" or core reason for this specific pick.'
    ),

    /**
     * Factors contributing to the edge.
     */
    edge_factors: z.array(z.string()).optional().describe(
        'Key factors (e.g. "Rest Advantage", "Key Injury") that support the verdict.'
    )
});

/**
 * BettingPicksArraySchema
 *
 * Wrapper for multi-pick extraction. The LLM returns an array of picks
 * when the analysis contains multiple VERDICT lines.
 */
export const BettingPicksArraySchema = z.object({
    picks: z.array(BettingPickSchema).describe(
        'Array of ALL betting picks found in the analysis. One entry per VERDICT line.'
    )
});
