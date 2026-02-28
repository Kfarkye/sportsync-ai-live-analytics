// fetch-starting-goalies
// Uses Gemini Grounded Web Search to find confirmed/projected starting goalies for NHL games
// Runs as a cron job to populate the starting_goalies table

// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI } from "npm:@google/genai";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─────────────────────────────────────────────────────────────────
// GOALIE RESEARCH PROMPT
// ─────────────────────────────────────────────────────────────────
const GOALIE_SEARCH_PROMPT = `You are an elite NHL starting goalie research engine.

Your task: Find the CONFIRMED or PROJECTED starting goalies for today's NHL games.

=== RESEARCH SOURCES (Priority Order) ===
1. **DailyFaceoff.com** - The gold standard for NHL starting goalies
2. **LeftWingLock.com** - Secondary confirmation source
3. **Team beat reporters on X/Twitter** - Breaking news
4. **ESPN NHL** - Official injury/lineup reports

=== FOR EACH GOALIE, FIND ===
1. **Name** (full name)
2. **Status**: "confirmed" (team announced), "projected" (expected), or "unannounced"
3. **Stats**: GAA, Save %, Record (W-L-OTL)
4. **Depth**: Is this the starter, backup, or 3rd-string emergency goalie?
5. **Reasoning**: Why is this goalie starting? (rest, hot streak, back-to-back, injury to G1/G2?)
6. **Betting Insight**: Any edge? (e.g., "Backup goalie starting 2nd game of back-to-back")

=== OUTPUT FORMAT (JSON) ===
{
    "matchups": [
        {
            "away_team": "Ottawa Senators",
            "home_team": "Washington Capitals",
            "away_goalie": {
                "name": "Anton Forsberg",
                "status": "projected",
                "is_starter": false,
                "depth": "3rd-string",
                "gaa": 3.45,
                "savePercentage": 0.891,
                "wins": 2, "losses": 5, "otl": 1,
                "reasoning": "Sogaard (starter) and Ullmark (backup) both injured. Emergency start.",
                "bettingInsight": "HIGH IMPACT: 3rd-string goalie making rare start. Target overs."
            },
            "home_goalie": {
                "name": "Charlie Lindgren",
                "status": "confirmed",
                "is_starter": false,
                "depth": "backup",
                "gaa": 2.85,
                "savePercentage": 0.910,
                "wins": 8, "losses": 4, "otl": 1,
                "reasoning": "Thompson (starter) rested after NYE game. Back-to-back management.",
                "bettingInsight": "Backup goalie due to back-to-back. Check Thompson's career B2B stats."
            },
            "source": "DailyFaceoff"
        }
    ]
}

CRITICAL: Only return valid JSON. No markdown, no explanations outside JSON.`;

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fix: Use GoogleGenAI with process.env.API_KEY as per guidelines
    const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY') || '' });

    // Use Gemini 3 Flash for fast, accurate goalie lookups with grounded search
    const modelName = 'gemini-2.5-flash';

    try {
        const startTime = Date.now();
        console.log('[fetch-starting-goalies] 🏒 Starting goalie research...');

        // 1. Get today's NHL games
        const today = new Date();
        const gameDate = today.toISOString().split('T')[0];

        const { data: nhlGames, error: gamesError } = await supabase
            .from('matches')
            .select('id, home_team, away_team, start_time')
            .eq('league_id', 'nhl')
            .gte('start_time', `${gameDate}T00:00:00`)
            .lte('start_time', `${gameDate}T23:59:59`);

        if (gamesError) throw gamesError;

        if (!nhlGames || nhlGames.length === 0) {
            console.log('[fetch-starting-goalies] No NHL games today');
            return new Response(JSON.stringify({ message: 'No NHL games today' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        console.log(`[fetch-starting-goalies] 📅 Found ${nhlGames.length} NHL games for ${gameDate}`);

        // 2. Build search query for all games
        const gameList = nhlGames.map(g => `${g.away_team} at ${g.home_team}`).join(', ');

        const searchPrompt = `${GOALIE_SEARCH_PROMPT}

TODAY'S GAMES TO RESEARCH (${gameDate}):
${gameList}

Search DailyFaceoff, LeftWingLock, and team sources for confirmed starting goalies.`;

        // 3. Execute grounded search
        console.log('[fetch-starting-goalies] 🔍 Executing Gemini grounded search...');

        const result = await ai.models.generateContent({
            model: modelName,
            contents: [{ role: 'user', parts: [{ text: searchPrompt }] }],
            config: {
                tools: [{ googleSearch: {} }],
                generationConfig: {
                    temperature: 0.1,
                },
                thinkingConfig: {
                    includeThoughts: true,
                    thinkingLevel: "high"
                }
            }
        });

        // Fix: Use result.text property
        const responseText = result.text || '';
        console.log('[fetch-starting-goalies] 📥 Got response, parsing...');

        // 4. Parse response
        let parsed: any;
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            console.error('[fetch-starting-goalies] Parse error:', parseError);
            return new Response(JSON.stringify({ error: 'Failed to parse goalie data' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // 5. Upsert to database
        let upserted = 0;
        for (const matchup of (parsed.matchups || [])) {
            // Find matching game
            const game = nhlGames.find((g: any) =>
                g.home_team?.toLowerCase().includes(matchup.home_team?.split(' ').pop()?.toLowerCase() || '') ||
                matchup.home_team?.toLowerCase().includes(g.home_team?.split(' ').pop()?.toLowerCase() || '')
            );

            if (!game) {
                console.warn(`[fetch-starting-goalies] Could not match: ${matchup.away_team} @ ${matchup.home_team}`);
                continue;
            }

            const homeGoalie = matchup.home_goalie || {};
            const awayGoalie = matchup.away_goalie || {};

            const record = {
                match_id: game.id,
                game_date: gameDate,

                home_goalie_name: homeGoalie.name || 'Unannounced',
                home_status: homeGoalie.status || 'unannounced',
                home_stats: {
                    gaa: homeGoalie.gaa,
                    savePercentage: homeGoalie.savePercentage,
                    wins: homeGoalie.wins,
                    losses: homeGoalie.losses,
                    otl: homeGoalie.otl,
                    reasoning: homeGoalie.reasoning,
                    bettingInsight: homeGoalie.bettingInsight,
                    depth: homeGoalie.depth
                },
                home_source: matchup.source || 'Gemini Search',

                away_goalie_name: awayGoalie.name || 'Unannounced',
                away_status: awayGoalie.status || 'unannounced',
                away_stats: {
                    gaa: awayGoalie.gaa,
                    savePercentage: awayGoalie.savePercentage,
                    wins: awayGoalie.wins,
                    losses: awayGoalie.losses,
                    otl: awayGoalie.otl,
                    reasoning: awayGoalie.reasoning,
                    bettingInsight: awayGoalie.bettingInsight,
                    depth: awayGoalie.depth
                },
                away_source: matchup.source || 'Gemini Search',

                confidence_score: homeGoalie.status === 'confirmed' && awayGoalie.status === 'confirmed' ? 95 : 75,
                last_updated: new Date().toISOString()
            };

            const { error: upsertError } = await supabase
                .from('starting_goalies')
                .upsert(record, { onConflict: 'match_id,game_date' });

            if (upsertError) {
                console.error(`[fetch-starting-goalies] Upsert error for ${game.id}:`, upsertError);
            } else {
                upserted++;
                console.log(`[fetch-starting-goalies] ✅ ${awayGoalie.name || '?'} vs ${homeGoalie.name || '?'} saved`);
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[fetch-starting-goalies] 🏁 Complete: ${upserted}/${nhlGames.length} games updated in ${(duration / 1000).toFixed(1)}s`);

        return new Response(JSON.stringify({
            success: true,
            games: nhlGames.length,
            upserted,
            duration_ms: duration
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (err: any) {
        console.error('[fetch-starting-goalies] Error:', err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
