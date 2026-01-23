
/**
 * generate-news - Supabase Edge Function
 * 
 * Purpose: Populates the Qualitative/Narrative columns of 'match_news'.
 * Tools: Gemini 3 with Search Grounding via Shared Utility.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";

declare const Deno: any;

// --- Configuration ---
const GEMINI_MODEL = "gemini-3-flash-preview";
const CACHE_HOURS = 4;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
  "Content-Type": "application/json",
};

// --- Types ---
interface RequestPayload {
  match_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  start_time?: string;
  league?: string;
  odds?: {
    spread?: string;
    total?: string;
  };
}

// --- Main Handler ---

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  try {
    const body: any = await req.json();
    const record = body.record || body.match || body;

    const payload: RequestPayload = {
      match_id: record.match_id || record.id || record.matchId || body.id || body.match_id,
      sport: record.sport_type || record.sport || record.leagueId || "unknown",
      home_team: record.home_team || record.homeTeam?.name || record.homeTeam || "Home",
      away_team: record.away_team || record.awayTeam?.name || record.awayTeam || "Away",
      start_time: record.start_time || record.startTime || record.date || new Date().toISOString(),
      league: record.league || record.league_id || record.leagueId,
      odds: record.odds || record.current_odds || {}
    };

    if (!payload.match_id) throw new Error("Missing match_id");

    try {
      console.log(`[News] Generating report for ${payload.match_id}...`);
      const { data, sources } = await generateNewsReport(payload);

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + CACHE_HOURS);

      const dbPayload = {
        match_id: payload.match_id,
        status: 'ready',
        report: `**${data.headline}**\n\n${data.report_narrative}`,
        key_injuries: data.key_injuries,
        betting_factors: data.betting_factors,
        line_movement: data.line_movement,
        weather_forecast: data.weather,
        fatigue: data.fatigue,
        officials: data.officials,
        sources: sources,
        generated_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString()
      };

      const { error: dbError } = await supabase.from('match_news').upsert(dbPayload, { onConflict: 'match_id' });
      if (dbError) console.error(`[DB] Upsert error:`, dbError.message);

      return new Response(JSON.stringify({
        success: true,
        report: dbPayload.report,
        sources: sources,
        key_injuries: data.key_injuries,
        betting_factors: data.betting_factors,
        line_movement: data.line_movement,
        weather_forecast: data.weather,
        fatigue: data.fatigue,
        officials: data.officials,
        sharp_data: data.prediction
      }), { status: 200, headers: CORS_HEADERS });

    } catch (err: any) {
      console.error(`[News] Failed: ${err.message}`);
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: CORS_HEADERS });
  }
});

function getReportSchema() {
  return {
    type: "object",
    properties: {
      headline: { type: "string" },
      report_narrative: { type: "string" },
      key_injuries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            player: { type: "string" },
            team: { type: "string" },
            status: { type: "string" },
            impact: { type: "string" }
          }
        }
      },
      weather: {
        type: "object",
        properties: {
          condition: { type: "string" },
          temp: { type: "string" },
          wind: { type: "string" },
          location: { type: "string" }
        }
      },
      fatigue: {
        type: "object",
        properties: {
          situation: { type: "string" },
          travel_note: { type: "string" },
          advantage_team: { type: "string" }
        }
      },
      officials: {
        type: "object",
        properties: {
          head_referee: { type: "string" },
          trend_note: { type: "string" }
        },
        nullable: true
      },
      line_movement: {
        type: "object",
        properties: {
          opener: { type: "string" },
          current: { type: "string" },
          direction: { type: "string" },
          explanation: { type: "string" }
        }
      },
      betting_factors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            factor: { type: "string" },
            edge_side: { type: "string" }
          }
        }
      },
      prediction: {
        type: "object",
        properties: {
          projected_score: { type: "string" },
          confidence: { type: "number" },
          lean: { type: "string" }
        }
      }
    },
    required: ["headline", "report_narrative", "key_injuries", "weather", "fatigue", "line_movement", "prediction"]
  };
}

async function generateNewsReport(payload: RequestPayload) {
  const now = new Date().toLocaleString('en-US', { timeZone: 'UTC' }) + " UTC";
  const prompt = `
    ROLE: Senior Sports Beat Writer & Betting Insider.
    TASK: Search for news and generate a detailed game preview report.
    GAME: ${payload.away_team} @ ${payload.home_team} (${payload.sport})
    TODAY'S DATE: ${now}
    
    GROUNDING REQUIREMENTS:
    1. MANDATORY: Search for current news regarding this matchup for the 2025/2026 Season context.
    2. Focus strictly on late-breaking updates.
    
    OUTPUT: Strict JSON matching the schema.
  `;

  const result = await executeAnalyticalQuery(prompt, {
    model: GEMINI_MODEL,
    tools: [{ googleSearch: {} }],
    responseSchema: getReportSchema(),
    temperature: 0.4
  });

  const data = safeJsonParse(result.text);
  return { data, sources: result.groundingUrls };
}
