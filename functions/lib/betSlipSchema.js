// functions/lib/betSlipSchema.js
// JS port of lib/schemas/betSlipSchema.ts (stripped TypeScript types)

import { z } from 'zod';

export const AIParsedLegSchema = z.object({
    entity_name: z.string().describe("e.g., 'Zion Williamson' or 'Pelicans'"),
    market_type: z.enum(['moneyline', 'spread', 'total', 'player_prop']),
    line: z.coerce.number().nullable().describe("e.g., -6.5 or 24.5. Null if moneyline"),
    direction: z.enum(['over', 'under', 'home', 'away']).nullable()
        .describe("Bet direction. Null for moneyline."),
    odds: z.coerce.number().describe("American odds, e.g., -110 or 150"),
    confidence_score: z.coerce.number().min(0).max(100)
        .describe("AI confidence in this extraction, 0-100"),
    needs_review: z.boolean()
        .describe("True if image is blurry, cropped, or odds are hard to read"),
});

export const AIParsedSlipSchema = z.object({
    sportsbook: z.enum(['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'Unknown']),
    wager_type: z.enum(['straight', 'parlay', 'sgp', 'round_robin', 'unknown'])
        .default('unknown')
        .describe("Detected wager type from slip layout"),
    total_stake: z.coerce.number().nullable(),
    total_payout: z.coerce.number().nullable(),
    legs: z.array(AIParsedLegSchema).min(1),
});
