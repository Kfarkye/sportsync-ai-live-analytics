// ingest-team-tempo/index.ts
// Daily ATS/Tempo Data Refresh using Gemini + Google Search Grounding
// Cron: 6 AM ET daily

import { createClient } from "jsr:@supabase/supabase-js@2";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";

declare const Deno: any;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEAM_TEMPO_SCHEMA = {
    type: "object",
    properties: {
        teams: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    team: { type: "string" },
                    pace: { type: "number" },
                    ortg: { type: "number" },
                    drtg: { type: "number" },
                    net_rtg: { type: "number" },
                    ats_record: { type: "string" },
                    ats_l10: { type: "string" },
                    over_record: { type: "number" },
                    under_record: { type: "number" }
                }
            }
        }
    }
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        console.log("[Ingest-Team-Tempo] Starting data refresh...");

        // Use Gemini with Google Search Grounding to fetch latest data
        const prompt = `You are a sports data analyst. Research and compile the CURRENT 2025-26 NBA season statistics for all 30 teams.

For each team, provide:
- team: Full team name (e.g., "Los Angeles Lakers")
- pace: Possessions per 48 minutes
- ortg: Offensive Rating (points per 100 possessions)
- drtg: Defensive Rating (points allowed per 100 possessions)
- net_rtg: Net Rating (ORTG - DRTG)
- ats_record: Against The Spread record (e.g., "25-20-1")
- ats_l10: ATS record last 10 games (e.g., "6-4-0")
- over_record: Games that went OVER the total
- under_record: Games that went UNDER the total

Use today's date as the reference. Cross-reference ESPN, Basketball Reference, and TeamRankings for accuracy.

Output ONLY a valid JSON object with a "teams" array containing all 30 teams.`;

        const result = await executeAnalyticalQuery(prompt, {
            model: 'gemini-3-pro-preview',
            responseSchema: TEAM_TEMPO_SCHEMA,
            temperature: 0.1
        });

        const parsed = safeJsonParse(result.rawText);

        if (!parsed?.teams || !Array.isArray(parsed.teams)) {
            throw new Error("Failed to parse team data from Gemini response");
        }

        console.log(`[Ingest-Team-Tempo] Parsed ${parsed.teams.length} teams`);

        // Upsert to team_tempo table
        let successCount = 0;
        for (const team of parsed.teams) {
            const { error } = await supabase
                .from('team_tempo')
                .upsert({
                    team: team.team,
                    pace: team.pace,
                    ortg: team.ortg,
                    drtg: team.drtg,
                    net_rtg: team.net_rtg,
                    ats_record: team.ats_record,
                    ats_l10: team.ats_l10,
                    over_record: team.over_record,
                    under_record: team.under_record,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'team' });

            if (!error) successCount++;
        }

        console.log(`[Ingest-Team-Tempo] Updated ${successCount}/${parsed.teams.length} teams`);

        return new Response(JSON.stringify({
            success: true,
            teams_updated: successCount,
            sources: result.sources?.length || 0
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

    } catch (error: any) {
        console.error("[Ingest-Team-Tempo] Error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
});
