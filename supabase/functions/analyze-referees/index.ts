
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";

const GEMINI_MODEL = "gemini-2.5-flash";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const { task, date, game } = await req.json();

    if (task === 'fetch_daily_schedule') {
      const result = await fetchDailySchedule(date);
      return new Response(JSON.stringify(result), { headers: CORS_HEADERS });
    }

    if (task === 'analyze_impact') {
      const result = await analyzeImpact(game);
      return new Response(JSON.stringify(result), { headers: CORS_HEADERS });
    }

    throw new Error("Invalid task");

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
});

async function fetchDailySchedule(date: string) {
  const searchPrompt = `Conduct a deep search for the OFFICIAL NBA Referee Assignments for ${date}.
  Look for "NBA Officiating Assignments" on official.nba.com or reliable sources.
  Find the schedule and officiating crews for ALL games today.
  For each game extract: Home & Away Teams, Time (ET), and Referees (Crew Chief, Referee, Umpire).`;

  const result = await executeAnalyticalQuery(searchPrompt, {
    model: GEMINI_MODEL,
    tools: [{ googleSearch: {} }],
    responseSchema: {
      type: "object",
      properties: {
        games: {
          type: "array",
          items: {
            type: "object",
            properties: {
              homeTeam: { type: "string" },
              awayTeam: { type: "string" },
              time: { type: "string" },
              referees: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" } }
                }
              }
            }
          }
        }
      }
    }
  });

  return { ...safeJsonParse(result.text), rawText: result.text, sources: result.groundingUrls };
}

async function analyzeImpact(game: any) {
  const crew = game.referees?.map((r: any) => r.name).join(", ") || "Unknown";
  const searchPrompt = `Analyze the NBA officiating impact for ${game.awayTeam} @ ${game.homeTeam}.
  Confirmed Crew: ${crew}.
  Search for these referees' 2024-25 betting stats (Home Win %, Foul rate, O/U tendency).
  Compare their calling style to these teams' playstyles.
  Calculate a bias score (-10 to 10) and over/under tendency (-10 to 10).`;

  const result = await executeAnalyticalQuery(searchPrompt, {
    model: GEMINI_MODEL,
    tools: [{ googleSearch: {} }],
    responseSchema: {
      type: "object",
      properties: {
        crewName: { type: "string" },
        biasScore: { type: "number" },
        overUnderTendency: { type: "number" },
        homeTeamCompatibility: { type: "number" },
        awayTeamCompatibility: { type: "number" },
        matchupNotes: { type: "string" },
        keyInsights: { type: "array", items: { type: "string" } },
        recommendation: { type: "string" },
        confidence: { type: "number" }
      }
    }
  });

  return { ...safeJsonParse(result.text), sources: result.groundingUrls };
}
