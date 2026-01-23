
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";

declare const Deno: any;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req: any) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        // 1. Fetch Today's Schedule (Prioritize NFL > NBA > MLB > NHL)
        let targetMatch = null;
        let targetLeague = null;
        let targetSport = null;

        const LEAGUE_PRIORITY = [
            { s: 'football', l: 'nfl' },
            { s: 'basketball', l: 'nba' },
            { s: 'baseball', l: 'mlb' },
            { s: 'hockey', l: 'nhl' },
            { s: 'basketball', l: 'mens-college-basketball' }
        ];

        for (const { s, l } of LEAGUE_PRIORITY) {
            const res = await fetch(`${ESPN_BASE_URL}/${s}/${l}/scoreboard?limit=25`);
            if (!res.ok) continue;
            const data = await res.json();

            const games = (data.events || []).filter((e: any) => e.status?.type?.state === 'pre');

            if (games.length > 0) {
                const nationalGame = games.find((g: any) =>
                    g.competitions?.[0]?.broadcasts?.some((b: any) =>
                        ['ESPN', 'TNT', 'ABC', 'NBC', 'CBS', 'FOX', 'Prime Video'].includes(b.names?.[0])
                    )
                );
                targetMatch = nationalGame || games[0];
                targetLeague = l;
                targetSport = s;
                break;
            }
        }

        if (!targetMatch) {
            return new Response(JSON.stringify({ message: "No suitable upcoming games found today." }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        // 2. Fetch Extended Summary
        const summaryUrl = `${ESPN_BASE_URL}/${targetSport}/${targetLeague}/summary?event=${targetMatch.id}`;
        const summaryRes = await fetch(summaryUrl);
        const summaryData = await summaryRes.json();

        const competition = targetMatch.competitions[0];
        const homeTeam = competition.competitors.find((c: any) => c.homeAway === 'home').team;
        const awayTeam = competition.competitors.find((c: any) => c.homeAway === 'away').team;
        const odds = competition.odds?.[0] || {};

        // 3. Prompt Gemini via Shared Utility
        const prompt = `
        Analyze this matchup for the "Play of the Day" Thesis.
        Match: ${awayTeam.displayName} vs ${homeTeam.displayName}
        League: ${targetLeague.toUpperCase()}
        Odds: ${odds.details || 'N/A'} (O/U: ${odds.overUnder || 'N/A'})
        
        Context:
        - Analyze the betting edge (Spread, Total, or Moneyline).
        - Look for injuries, streaks, or motivational spots.
        - Provide a clear, sharp "Thesis" on why a specific bet is the best play.
    `;

        const responseSchema = {
            type: "object",
            properties: {
                summary: { type: "string", description: "A compelling narrative paragraph explaining the edge." },
                keyFactors: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            description: { type: "string" },
                            impact: { type: "string", enum: ['high', 'medium', 'low'] }
                        }
                    }
                },
                recommendedPlays: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            label: { type: "string", description: "The Pick (e.g. Chiefs -3)" },
                            odds: { type: "string", description: "e.g. -110" },
                            edgePercentage: { type: "number", description: "Calculated edge (e.g. 4.5)" }
                        }
                    }
                }
            },
            required: ["summary", "keyFactors", "recommendedPlays"]
        };

        const result = await executeAnalyticalQuery(prompt, {
            model: 'gemini-3-pro-preview',
            responseSchema,
            temperature: 0.2
        });

        const thesisContent = safeJsonParse(result.text);
        if (!thesisContent) throw new Error("AI returned invalid JSON structure");

        // 4. Store in Supabase
        const today = new Date().toISOString().split('T')[0];
        const { error } = await supabase.from('daily_thesis').upsert({
            date: today,
            match_id: targetMatch.id,
            headline: `${awayTeam.shortDisplayName} @ ${homeTeam.shortDisplayName}`,
            content: thesisContent
        }, { onConflict: 'date' });

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, match: targetMatch.name, thesis: thesisContent }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error: any) {
        console.error("[ThesisGen-Fault]", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});
