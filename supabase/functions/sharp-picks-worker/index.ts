// Sharp Picks Worker - Does the actual Triple Confluence analysis
declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";
import { getCanonicalMatchId, toLocalGameDate } from "../_shared/match-registry.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
};

/**
 * TRIPLE CONFLUENCE SCHEMA (Sharp Pick Gate)
 */
const SHARP_PICK_SCHEMA = {
    type: "object",
    description: "Sharp pick analysis using Triple Confluence Gate system.",
    properties: {
        pick: {
            type: "string",
            description: "The sharp pick. Format: 'TEAM +/-SPREAD', 'TEAM ML', or 'OVER/UNDER VALUE'."
        },
        pick_type: {
            type: "string",
            enum: ["spread", "total", "moneyline"],
        },
        pick_side: {
            type: "string",
            description: "Team name for spread/ML, or 'OVER'/'UNDER' for totals."
        },
        pick_line: {
            type: "number",
            nullable: true,
        },
        confluence_score: {
            type: "number",
            description: "0-100 score representing strength of all 3 gates combined."
        },
        gates: {
            type: "object",
            properties: {
                sharp_action: {
                    type: "object",
                    properties: {
                        passed: { type: "boolean" },
                        evidence: { type: "string" },
                        score: { type: "number" }
                    },
                    required: ["passed", "evidence", "score"]
                },
                line_movement: {
                    type: "object",
                    properties: {
                        passed: { type: "boolean" },
                        evidence: { type: "string" },
                        score: { type: "number" }
                    },
                    required: ["passed", "evidence", "score"]
                },
                situational_edge: {
                    type: "object",
                    properties: {
                        passed: { type: "boolean" },
                        evidence: { type: "string" },
                        score: { type: "number" }
                    },
                    required: ["passed", "evidence", "score"]
                }
            },
            required: ["sharp_action", "line_movement", "situational_edge"]
        },
        reasoning_summary: {
            type: "string",
        },
        confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
        },
        pass_gate: {
            type: "boolean",
            description: "True if all 3 gates passed and this is a qualified sharp pick."
        }
    },
    required: ["pick", "pick_type", "pick_side", "confluence_score", "gates", "reasoning_summary", "confidence", "pass_gate"]
};

const MIN_CONFLUENCE_SCORE = 70;

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    try {
        const game = await req.json();
        const { match_id, home_team, away_team, sport, league, current_spread, current_total, current_odds, start_time } = game;

        if (!match_id || !home_team || !away_team) {
            return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: CORS_HEADERS });
        }

        console.log(`[sharp-worker] 🎯 Analyzing: ${away_team} @ ${home_team}`);

        const SYSTEM_INSTRUCTION = `ROLE: Sharp Action Analyst for professional sports betting syndicate.
MISSION: Evaluate matchups through the TRIPLE CONFLUENCE GATE system.

THE THREE GATES:
1. SHARP ACTION: Is there evidence of professional/sharp money on one side? (Books moving lines without public %, steam moves, reverse line movement)
2. LINE MOVEMENT: Has the line moved favorably? (Opening vs current, key number crossings, closing line value potential)
3. SITUATIONAL EDGE: Is there a clear situational advantage? (Scheduling spots, rest advantages, motivation, venue, travel)

RULES:
- A pick ONLY qualifies if it passes ALL THREE gates with scores 60+.
- Be extremely selective. Most games will NOT pass all 3 gates.
- If you cannot find strong evidence for all 3 gates, set pass_gate to false.`;

        const prompt = `### TRIPLE CONFLUENCE ANALYSIS
**Matchup:** ${away_team} @ ${home_team}
**Sport:** ${sport || league}
**Current Spread:** ${current_spread || 'N/A'}
**Current Total:** ${current_total || 'N/A'}
**Home ML:** ${current_odds?.homeWin || current_odds?.home_ml || 'N/A'}
**Away ML:** ${current_odds?.awayWin || current_odds?.away_ml || 'N/A'}

Evaluate through the Triple Confluence Gate:
1. SHARP ACTION - Look for steam, RLM, professional money signals
2. LINE MOVEMENT - Opening vs current, key numbers
3. SITUATIONAL - Rest, travel, revenge, schedule spots

Score each gate 0-100. Set pass_gate=true ONLY if ALL gates have strong evidence (60+ each).`;

        const { text } = await executeAnalyticalQuery([{ text: prompt }], {
            model: "gemini-3-pro-preview",
            systemInstruction: SYSTEM_INSTRUCTION,
            responseSchema: SHARP_PICK_SCHEMA,
            thinkingBudget: 16384,
            tools: [{ googleSearch: {} }]
        });

        const analysis = safeJsonParse(text);

        if (!analysis) {
            return new Response(JSON.stringify({ error: "Failed to parse analysis", match_id }), { status: 500, headers: CORS_HEADERS });
        }

        console.log(`[sharp-worker] Analysis: ${analysis.pick} | Confluence: ${analysis.confluence_score}% | Pass: ${analysis.pass_gate}`);

        // Only save if it passes all gates
        if (analysis.pass_gate && analysis.confluence_score >= MIN_CONFLUENCE_SCORE) {
            const canonicalId = getCanonicalMatchId(match_id, league);

            const { error: insertErr } = await supabase.from("sharp_intel").insert({
                match_id: canonicalId,
                home_team,
                away_team,
                league: league || sport,
                pick_type: analysis.pick_type,
                pick_side: analysis.pick_side,
                pick_line: analysis.pick_line,
                ai_confidence: analysis.confidence,
                reasoning_summary: analysis.reasoning_summary,
                generated_at: new Date().toISOString(),
                game_start_time: start_time,
                pick_result: 'PENDING',
                // 🎯 ALPHA METADATA: Gate scores for ROI analysis
                sharp_action_score: analysis.gates?.sharp_action?.score || 0,
                line_movement_score: analysis.gates?.line_movement?.score || 0,
                situational_edge_score: analysis.gates?.situational_edge?.score || 0,
                total_confluence_score: analysis.confluence_score || 0
            });

            if (insertErr) {
                console.error(`[sharp-worker] Insert error:`, insertErr);
                return new Response(JSON.stringify({ error: insertErr.message, match_id }), { status: 500, headers: CORS_HEADERS });
            }

            console.log(`[sharp-worker] ✅ QUALIFIED & SAVED: ${analysis.pick}`);
            return new Response(JSON.stringify({
                status: "QUALIFIED",
                match_id,
                pick: analysis.pick,
                confluence_score: analysis.confluence_score,
                gates: analysis.gates
            }), { headers: CORS_HEADERS });
        } else {
            console.log(`[sharp-worker] ❌ Did not qualify: ${analysis.confluence_score}%`);
            return new Response(JSON.stringify({
                status: "NOT_QUALIFIED",
                match_id,
                confluence_score: analysis.confluence_score,
                pass_gate: analysis.pass_gate,
                gates: analysis.gates
            }), { headers: CORS_HEADERS });
        }

    } catch (err: any) {
        console.error(`[sharp-worker] Error:`, err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
});
