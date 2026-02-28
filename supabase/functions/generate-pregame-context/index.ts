
/**
 * GENERATE PREGAME CONTEXT
 * Edge Function that:
 * 1. Fetches upcoming NBA games
 * 2. Calls Gemini 3 with strict JSON schema enforcement via Shared Utility
 * 3. Validates output and stores validated context in nba_pregame_context
 * 
 * Zero stance. Pure intel. Watch tags only.
 */

declare const Deno: any;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";
export { buildMatchDossier } from "../_shared/match-dossier.ts";

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

const PREGAME_CONTEXT_SCHEMA = {
    type: "object",
    properties: {
        injuries: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    team: { type: "string" },
                    player: { type: "string" },
                    status: { type: "string", enum: ["OUT", "DOUBTFUL", "QUESTIONABLE", "PROBABLE", "IN"] },
                    impact: { type: "string", enum: ["USAGE", "DEFENSE", "PACE", "MINUTES", "UNKNOWN"] },
                    note: { type: "string" }
                },
                required: ["team", "player", "status", "impact", "note"]
            }
        },
        travel: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    team: { type: "string" },
                    flag: { type: "string", enum: ["B2B", "3IN4", "4IN6", "TIMEZONE", "ALTITUDE", "REST_ADV"] },
                    note: { type: "string" }
                },
                required: ["team", "flag", "note"]
            }
        },
        market_signals: {
            type: "object",
            properties: {
                sharp: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            signal: { type: "string", enum: ["RLM", "STEAM", "BUYBACK"] },
                            note: { type: "string" }
                        }
                    }
                },
                public: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            signal: { type: "string", enum: ["PUBLIC_HEAVY", "HANDLE_HEAVY"] },
                            note: { type: "string" }
                        }
                    }
                }
            }
        },
        context_notes: {
            type: "array",
            items: { type: "string" }
        }
    },
    required: ["injuries", "travel", "market_signals", "context_notes"]
};

// Forbidden stance tokens (reject if found in notes)
const FORBIDDEN_TOKENS = [
    "lean", "bet", "take the", "play the", "hammer", "smash", "love the", "like the",
    "pick", "lock", "winner", "loser", "fade", "back the", "side with",
    "go with", "recommend", "suggest", "prediction", "predict"
];

function containsForbiddenStance(text: string): boolean {
    const lower = text.toLowerCase();
    return FORBIDDEN_TOKENS.some(token => {
        const regex = new RegExp(`\\b${token}\\b`, 'i');
        return regex.test(lower);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// GEMINI PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

function buildPrompt(homeTeam: string, awayTeam: string, startTime: string): string {
    return `Analyze this matchup for upcoming NBA pregame intel.
    
    MATCHUP: ${awayTeam} @ ${homeTeam}
    GAME TIME: ${startTime}

    RULES:
    1. All notes must be NEUTRAL observations. No predictions. No recommendations.
    2. FORBIDDEN words in any note: lean, bet, take, play, pick, lock, fade, recommend, predict, winner, loser
    3. If you have no data for a section, return an empty array [].
    4. Maximum 5 injuries, 3 travel flags, 3 market signals, 5 context notes.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
};

if (import.meta.main) {
    Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    try {
        // 1. Fetch upcoming NBA games (scheduled, next 24h)
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        const { data: games, error: gErr } = await supabase
            .from("nba_games")
            .select("game_id, home_team, away_team, start_ts")
            .gte("start_ts", now.toISOString())
            .lte("start_ts", tomorrow.toISOString());

        if (gErr) throw gErr;
        if (!games || games.length === 0) {
            return new Response(JSON.stringify({ message: "No upcoming games to process", processed: 0 }), { headers: CORS_HEADERS });
        }

        const results: any[] = [];

        for (const game of games) {
            try {
                const prompt = buildPrompt(game.home_team, game.away_team, game.start_ts);

                const result = await executeAnalyticalQuery(prompt, {
                    model: "gemini-2.5-flash",
                    responseSchema: PREGAME_CONTEXT_SCHEMA,
                    thinkingBudget: 16000
                });

                const parsed = safeJsonParse(result.text);

                if (!parsed) {
                    throw new Error("Invalid JSON from AI");
                }

                // Security check for "stance"
                const allNotes = [
                    ...parsed.injuries.map((i: any) => i.note),
                    ...parsed.travel.map((t: any) => t.note),
                    ...parsed.market_signals.sharp.map((s: any) => s.note),
                    ...parsed.market_signals.public.map((p: any) => p.note),
                    ...parsed.context_notes
                ];

                if (allNotes.some(n => containsForbiddenStance(n))) {
                    throw new Error("Forbidden stance detected in notes");
                }

                // Add metadata
                const validatedContext = {
                    ...parsed,
                    match_id: game.game_id,
                    generated_at: new Date().toISOString(),
                    source: "gemini_cron"
                };

                // Store in DB
                const { error: insertErr } = await supabase
                    .from("nba_pregame_context")
                    .upsert({
                        match_id: game.game_id,
                        generated_at: validatedContext.generated_at,
                        source: validatedContext.source,
                        context_jsonb: validatedContext
                    }, { onConflict: "match_id" });

                if (insertErr) throw insertErr;
                results.push({ game_id: game.game_id, status: "success" });

            } catch (e: any) {
                console.error(`[ContextGen-Fail] ${game.game_id}:`, e.message);
                await supabase.from("nba_pregame_context_debug").insert({
                    match_id: game.game_id,
                    validation_error: e.message
                });
                results.push({ game_id: game.game_id, status: "error", error: e.message });
            }
        }

        return new Response(JSON.stringify({
            processed: games.length,
            results
        }), { headers: CORS_HEADERS });

    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS_HEADERS });
    }
});
}
