
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Configuration
const BATCH_SIZE = 3;
const LOOKAHEAD_HOURS = 24;
const REFRESH_HOURS = 4;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Calculate Time Windows
    const now = new Date();
    const lookahead = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);
    const staleThreshold = new Date(now.getTime() - REFRESH_HOURS * 60 * 60 * 1000).toISOString();

    // 2. Fetch Candidates
    const { data: matchesRaw, error: matchError } = await supabase
      .from("matches")
      .select(`id, league_id, start_time, current_odds, home_team_id, away_team_id, status`)
      .gte("start_time", now.toISOString())
      .lt("start_time", lookahead.toISOString())
      .order("start_time", { ascending: true })
      .limit(100);

    if (matchError) throw matchError;

    const validStatuses = new Set(['scheduled', 'pregame', 'status_scheduled']);
    const matchesFiltered = (matchesRaw || []).filter((m: any) => validStatuses.has(String(m.status || '').toLowerCase())).slice(0, 50);

    if (matchesFiltered.length === 0) {
      return new Response(JSON.stringify({ message: "No upcoming scheduled matches found." }), { headers: corsHeaders });
    }

    const teamIds = new Set<string>();
    matchesFiltered.forEach((m: any) => {
      if (m.home_team_id) teamIds.add(m.home_team_id);
      if (m.away_team_id) teamIds.add(m.away_team_id);
    });

    const { data: teamsData } = await supabase.from('teams').select('id, name').in('id', Array.from(teamIds));
    const teamMap = new Map<string, string>();
    teamsData?.forEach((t: any) => teamMap.set(t.id, t.name));

    const matches = matchesFiltered.map((m: any) => ({
      ...m,
      home_team: { name: teamMap.get(m.home_team_id) || 'Unknown Home' },
      away_team: { name: teamMap.get(m.away_team_id) || 'Unknown Away' }
    }));

    const matchIds = matches.map((m: any) => m.id);
    const { data: existingNews } = await supabase.from("match_news").select("match_id, generated_at").in("match_id", matchIds);
    const newsMap = new Map();
    existingNews?.forEach((n: any) => newsMap.set(n.match_id, n.generated_at));

    const targets = matches.filter((m: any) => {
      const lastGen = newsMap.get(m.id);
      return !lastGen || new Date(lastGen) < new Date(staleThreshold);
    }).slice(0, BATCH_SIZE);

    if (targets.length === 0) {
      return new Response(JSON.stringify({ message: "All upcoming matches have fresh intel." }), { headers: corsHeaders });
    }

    const results = [];

    for (const match of targets) {
      const t0 = performance.now();
      try {
        const homeName = match.home_team?.name || "Home Team";
        const awayName = match.away_team?.name || "Away Team";

        // OPTIMISTIC LOCK
        await supabase.from("match_news").upsert({
          match_id: match.id,
          status: 'ready',
          report: 'PROCESSING_LOCK',
          generated_at: new Date().toISOString()
        }, { onConflict: "match_id" });

        const spread = match.current_odds?.spread || "N/A";
        const total = match.current_odds?.over_under || match.current_odds?.total || "N/A";
        const nowUTC = new Date().toLocaleString('en-US', { timeZone: 'UTC' }) + " UTC";

        const prompt = `
          You are an elite sports betting analyst for "The Drip".
          MATCH: ${awayName} vs ${homeName}
          LEAGUE: ${match.league_id}
          DATE: ${new Date(match.start_time).toLocaleDateString()}
          ODDS: Spread ${spread}, Total ${total}
          CURRENT TIME: ${nowUTC}
          TASK: Perform a grounded Google Search to generate a sharp betting intelligence report.
        `.trim();

        const responseSchema = {
          type: "object",
          properties: {
            report: { type: "string" },
            weather: {
              type: "object",
              properties: {
                temp: { type: "string" },
                condition: { type: "string" },
                wind: { type: "string" },
                humidity: { type: "string" },
                impact: { type: "string" },
              },
            },
            fatigue: {
              type: "object",
              properties: {
                home: {
                  type: "object",
                  properties: {
                    team: { type: "string" },
                    daysRest: { type: "number" },
                    milesTraveled: { type: "number" },
                    fatigueScore: { type: "number" },
                    note: { type: "string" },
                  },
                },
                away: {
                  type: "object",
                  properties: {
                    team: { type: "string" },
                    daysRest: { type: "number" },
                    milesTraveled: { type: "number" },
                    fatigueScore: { type: "number" },
                    note: { type: "string" },
                  },
                },
              },
            },
            officials: {
              type: "object",
              properties: {
                crewName: { type: "string" },
                referee: { type: "string" },
                homeWinPct: { type: "number" },
                overPct: { type: "number" },
                foulsPerGame: { type: "number" },
                bias: { type: "string" },
              },
            },
            keyInjuries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  player: { type: "string" },
                  team: { type: "string" },
                  status: { type: "string" },
                  description: { type: "string" },
                  analysis: { type: "string" },
                },
              }
            },
            bettingFactors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  trend: { type: "string", enum: ["HOME_POSITIVE", "AWAY_POSITIVE", "NEUTRAL"] },
                  confidence: { type: "number" },
                },
              }
            },
            lineMovement: {
              type: "object",
              properties: {
                opening: { type: "string" },
                current: { type: "string" },
                direction: { type: "string" },
                notes: { type: "string" },
              },
            },
          },
          required: ["report", "weather", "fatigue", "keyInjuries", "bettingFactors"],
        };

        const result = await executeAnalyticalQuery(prompt, {
          model: "gemini-2.5-flash",
          tools: [{ googleSearch: {} }],
          responseSchema,
          thinkingBudget: 16000
        });

        const intel = safeJsonParse(result.text);
        if (!intel) throw new Error("AI returned invalid JSON");

        const dbPayload = {
          match_id: match.id,
          report: intel.report ?? "",
          key_injuries: intel.keyInjuries ?? [],
          betting_factors: intel.bettingFactors ?? [],
          line_movement: intel.lineMovement ?? null,
          weather_forecast: intel.weather ?? null,
          fatigue: intel.fatigue ?? null,
          sources: result.groundingUrls,
          status: "ready",
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + REFRESH_HOURS * 60 * 60 * 1000).toISOString(),
        };

        await supabase.from("match_news").upsert(dbPayload, { onConflict: "match_id" });
        results.push({ id: match.id, status: "success", duration_ms: performance.now() - t0 });

      } catch (err: any) {
        results.push({ id: match.id, status: "error", error: err.message });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, details: results }), { headers: corsHeaders });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
});
