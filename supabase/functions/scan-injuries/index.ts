
/**
 * scan-injuries - Supabase Edge Function
 * 
 * Purpose: Scans for the latest league-wide injury reports using Gemini 3 Search Grounding.
 * Unified with Shared Architecture.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Configuration
const DEFAULT_LEAGUES = ["NBA", "NFL", "NHL", "MLB"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let targetLeagues = DEFAULT_LEAGUES;
    try {
      const body = await req.json().catch(() => ({}));
      if (body.league) {
        targetLeagues = [body.league];
      }
    } catch {
      // ignore JSON parse errors, use defaults
    }

    const results = {
      total: targetLeagues.length,
      success: 0,
      failures: 0,
      details: [] as any[]
    };

    const promises = targetLeagues.map(async (league) => {
      try {
        const injuries = await fetchInjuriesForLeague(league);

        if (injuries.length > 0) {
          const todayStr = new Date().toISOString().split('T')[0];
          const payload = injuries.map(i => ({
            sport: league,
            team: i.team,
            player_name: i.player,
            status: i.status || "Questionable",
            report: i.description || i.details || "Recent report",
            source_url: i.source,
            report_date: todayStr
          }));

          const { error } = await supabase
            .from("injury_snapshots")
            .upsert(payload, {
              onConflict: "player_name, team, sport, report_date",
              ignoreDuplicates: false
            });

          if (error) throw error;
          return { league, status: 'success', count: payload.length };
        }
        return { league, status: 'success', count: 0 };

      } catch (err: any) {
        return { league, status: 'error', error: err.message };
      }
    });

    const outcomes = await Promise.all(promises);
    outcomes.forEach(o => {
      results.details.push(o);
      if (o.status === 'success') results.success++;
      else results.failures++;
    });

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

async function fetchInjuriesForLeague(league: string) {
  const prompt = `Search for the latest official injury report for ${league} dated today. 
  Focus on STAR players and key rotations.
  Return a JSON list of players.`;

  const responseSchema = {
    type: "object",
    properties: {
      injuries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            player: { type: "string" },
            team: { type: "string" },
            status: { type: "string" },
            description: { type: "string" },
          },
          required: ["player", "team", "status", "description"]
        }
      }
    },
    required: ["injuries"]
  };

  const result = await executeAnalyticalQuery(prompt, {
    model: "gemini-3-flash-preview",
    tools: [{ googleSearch: {} }],
    responseSchema: responseSchema,
    temperature: 0.2
  });

  const data = safeJsonParse(result.text);
  const primarySource = result.groundingUrls?.[0]?.uri || "";

  return (data?.injuries || []).map((inj: any) => ({
    ...inj,
    source: primarySource
  }));
}
