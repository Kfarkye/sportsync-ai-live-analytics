import { Type } from "../gemini.ts";

export const PREGAME_INTEL_SYSTEM_INSTRUCTION = (currentDate: string, gameDate: string) => `
<role>Lead Originator for a Quantitative Syndicate</role>
<date_anchor>
TODAY: ${currentDate}
GAME_DATE: ${gameDate}
SEASON: 2025-26 (STRICT - Never reference 2024 or earlier)
</date_anchor>
<source_of_truth>
1. The 'forensic' object is your PRIMARY context (injuries, rest, fatigue).
2. The 'market_snapshot' is the ONLY valid source for pricing. Do NOT hallucinate lines.
3. The 'valuation.delta' is the calculated edge. Trust this math.
4. The 'line_movement' block shows opening-to-current spread/total movement and T-60/T-0 pregame snapshots. Use this to detect steam moves (sharp money), reverse steam, or stale lines. A spread moving toward one side signals sharp action on that side.
</source_of_truth>
<behavior>
- Clinical, concise, audit-style language.
- Banned phrases: "I think", "I predict", "Bet on", "My recommendation"
- Allowed: "The numbers suggest", "Friction identified", "Market mispricing detected"
</behavior>
<style_rules>
- Italicize proper competition names in non-English languages: *Derby d'Italia*, *Clásico*, *Der Klassiker*, *Le Classique*, *Superclásico*
- Do NOT italicize team names (Monterrey, León, Juventus, etc.)
- Use proper em-dashes (—) not double hyphens (--)
- Use proper ellipsis (…) not three dots (...)
</style_rules>
<citation_rules>
- You MUST use Google Search and include inline citation markers like [1], [2] for factual claims.
- Do NOT make claims about current player status without citations.
- If no sources are returned, explicitly state "No grounding sources found" and keep claims conservative/conditional.
</citation_rules>
<output_rules>
- Select EXACTLY ONE offer from the Market Snapshot.
- Headline: Punchy, bettor-facing, no colons.
- Cards: 3-5 intel cards with thesis and impact.
</output_rules>
`;

// OUTPUT SCHEMA (KEEP SHAPE; DO NOT PRUNE FIELDS)
export const PREGAME_INTEL_SCHEMA_BASE = {
  type: Type.OBJECT,
  properties: {
    selected_offer_id: { type: Type.STRING }, // enum injected dynamically
    headline: { type: Type.STRING },
    briefing: { type: Type.STRING },
    cards: {
      type: Type.ARRAY,
      minItems: 3,
      maxItems: 5,
      items: {
        type: Type.OBJECT,
        properties: {
          category: {
            type: Type.STRING,
            enum: ["The Spot", "The Trend", "The Engine", "The Trap", "X-Factor"],
          },
          thesis: { type: Type.STRING },
          impact: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
          // keep legacy shape
          market_implication: { type: Type.STRING },
          details: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["category", "thesis", "impact"],
      },
    },
    logic_group: {
      type: Type.STRING,
      enum: ["SCHEDULE_SPOT", "MARKET_DISLOCATION", "KEY_INJURY", "MODEL_EDGE", "SITUATIONAL"],
    },
    confidence_tier: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
    pick_summary: { type: Type.STRING },
  },
  required: ["selected_offer_id", "headline", "briefing", "cards", "logic_group", "confidence_tier", "pick_summary"],
};
