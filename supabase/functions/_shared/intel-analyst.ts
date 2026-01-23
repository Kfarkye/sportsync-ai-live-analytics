// _shared/intel-analyst.ts
// SOTA Intel Analyst Helper
// Purpose: Generates high-fidelity professional summaries for betting dashboards.

declare const Deno: any;
import { executeAnalyticalQuery } from "./gemini.ts";

export interface MatchupContext {
    home_team: string;
    away_team: string;
    home_context: {
        injury_impact: number;
        situation: string;
        rest_days: number;
        ats_last_10: number;
        injury_notes: string;
    };
    away_context: {
        injury_impact: number;
        situation: string;
        rest_days: number;
        ats_last_10: number;
        injury_notes: string;
    };
}

/**
 * analyzeMatchup - SOTA Summary Generator
 * Ported from user's Gemini 3 Flash pattern but unified with repo SDK.
 */
export const analyzeMatchup = async (matchup: MatchupContext) => {
    const prompt = `
        Analyze this NBA 2025-26 matchup context:
        
        Match: ${matchup.away_team} @ ${matchup.home_team}
        
        Home Context (${matchup.home_team}):
        - Injury Impact: ${matchup.home_context.injury_impact}/10
        - Situation: ${matchup.home_context.situation} (${matchup.home_context.rest_days} days rest)
        - ATS Last 10: ${(matchup.home_context.ats_last_10 * 100).toFixed(0)}%
        - Injury Notes: ${matchup.home_context.injury_notes}
        
        Away Context (${matchup.away_team}):
        - Injury Impact: ${matchup.away_context.injury_impact}/10
        - Situation: ${matchup.away_context.situation} (${matchup.away_context.rest_days} days rest)
        - ATS Last 10: ${(matchup.away_context.ats_last_10 * 100).toFixed(0)}%
        - Injury Notes: ${matchup.away_context.injury_notes}
        
        Provide a professional "Pro Intel" summary including:
        1. Key Tactical Edge (Rest, Injury, or Trend)
        2. Projected Momentum Verdict
        3. One 'X-Factor' to watch.
        Keep it concise and punchy for a high-stakes betting dashboard.
    `;

    try {
        const { text } = await executeAnalyticalQuery(prompt, {
            model: "gemini-3-flash-preview",
            temperature: 0.7,
            thinkingBudget: 2048, // Flash doesn't need much thinking for summary tasks
            tools: [] // Fast generation, no search needed as context is provided
        });

        return text;
    } catch (error: any) {
        console.error("Gemini Analysis Error:", error.message);
        return "Intelligence offline. Check manual metrics.";
    }
};
