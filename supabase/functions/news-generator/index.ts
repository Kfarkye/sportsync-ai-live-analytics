
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { GoogleGenAI } from "npm:@google/genai";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // 1. Handle CORS Preflight (Browser Check)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKeySource = Deno.env.get("GEMINI_API_KEY") ? "GEMINI_API_KEY" :
      Deno.env.get("API_KEY") ? "API_KEY" :
        Deno.env.get("VITE_GEMINI_API_KEY") ? "VITE_GEMINI_API_KEY" :
          Deno.env.get("VITE_API_KEY") ? "VITE_API_KEY" : null;

    const apiKey = apiKeySource ? Deno.env.get(apiKeySource) : null;

    if (apiKeySource && apiKey) {
      console.log(`[NewsGen] Key resolution: Resolved via ${apiKeySource} (${apiKey.substring(0, 6)}...)`);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!apiKey || !supabaseUrl || !supabaseKey) {
      throw new Error("Server configuration missing (API Keys).");
    }

    // 2. Parse Payload
    let body;
    try {
      body = await req.json();
    } catch (e) {
      throw new Error("Invalid request body. Expected JSON.");
    }

    // Robust match extraction - handle multiple formats
    const match = body.match || body.record || body;
    const matchId = match?.id || match?.match_id || match?.matchId || body?.id || body?.match_id;

    if (!matchId) {
      console.error("[NewsGen] Payload received:", JSON.stringify(body));
      throw new Error("Missing match ID. Expected 'match.id', 'match_id', or 'id' in payload.");
    }

    // Normalize the match object
    const normalizedMatch = {
      id: matchId,
      homeTeam: match?.homeTeam?.name || match?.homeTeam || match?.home_team || "Home",
      awayTeam: match?.awayTeam?.name || match?.awayTeam || match?.away_team || "Away",
      leagueId: match?.leagueId || match?.league_id || match?.league || "Unknown",
      startTime: match?.startTime || match?.start_time || new Date().toISOString(),
      odds: match?.odds || match?.current_odds || {}
    };

    console.log(`[NewsGen] Starting analysis for ${normalizedMatch.homeTeam} vs ${normalizedMatch.awayTeam} (${normalizedMatch.id})`);

    // 3. Initialize Clients
    const supabase = createClient(supabaseUrl, supabaseKey);
    const ai = new GoogleGenAI({ apiKey });

    // 4. Construct Prompt with Sport-Specific Context
    const sportContext: Record<string, string> = {
      'basketball_nba': 'NBA Basketball. Use: PPG, RPG, APG, FG%, 3PT%, pace, paint points, turnovers.',
      'basketball_ncaab': 'College Basketball (NCAAB). Use: PPG, RPG, APG, FG%, 3PT%, tempo, rebounding margin.',
      'hockey_nhl': 'NHL Hockey. Use: G/G, GA/G, Power Play %, Penalty Kill %, save %, xG.',
      'football_nfl': 'NFL Football. Use: PPG, YPG, rushing yards, passing yards, turnover margin, red zone %.',
      'baseball_mlb': 'MLB Baseball. Use: runs/game, ERA, WHIP, batting avg, OPS, bullpen ERA.'
    };
    const sport = sportContext[normalizedMatch.leagueId] || 'Use sport-appropriate statistics.';

    const prompt = `
    ROLE: Chief Strategy Officer (Apple/Google style). 
    Generate an INTERNAL INTELLIGENCE REPORT.
    
    MATCH: ${normalizedMatch.awayTeam} vs ${normalizedMatch.homeTeam}
    SPORT: ${sport}
    
    CRITICAL: Use ONLY statistics and terminology appropriate for this sport.
    
    TONE: Clinical. Minimalist. Data-driven. "Pristine".
    NO narrative fluff. NO filler words. Use sentence fragments if efficient.

    TASK:
    Analyze form, splits, and sharp money.
    
    OUTPUT JSON:
    {
        "home_form": "String. ${normalizedMatch.homeTeam} identity. KEY STATS only using correct sport terminology.",
        "away_form": "String. ${normalizedMatch.awayTeam} identity. KEY STATS only using correct sport terminology.",
        "betting_splits": "String. Sharp Action Signal. (e.g. '65% Public on Team. Line moved -130 -> -125. Reverse Line Movement detected.')",
        "key_trend": "String. One dominant historical trend relevant to this sport.",
        "analysis": "String. The Verdict. 2 paragraphs.
        Para 1: The Mismatch (Why X beats Y).
        Para 2: The Closing Argument (Win Condition).
        Style: High-level executive briefing.",
        "keyInjuries": [ { "player": "string", "team": "string", "status": "string", "description": "string" } ],
        "bettingFactors": [ { "title": "string", "description": "string", "trend": "HOME_POSITIVE" | "AWAY_POSITIVE" | "NEUTRAL" } ],
        "weather": { "temp": "string", "condition": "string", "wind": "string", "humidity": "string" },
        "fatigue": { "home": { "daysRest": number, "note": "string" }, "away": { "daysRest": number, "note": "string" } }
    }
    `;

    // 5. Generate Content
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        tools: [{ googleSearch: {} }],
        generationConfig: {
          responseMimeType: "application/json"
        },
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "high"
        }
      }
    });

    const textOutput = response.text || "{}";

    // 6. Robust JSON Extraction
    let cleanedText = textOutput.replace(/```json/g, "").replace(/```/g, "").trim();

    // Advanced Brace Balancer to extract strictly the FIRST valid JSON object
    // This solves the issue where the AI returns duplicated output (e.g. {...}\n{...})
    const firstOpen = cleanedText.indexOf('{');
    if (firstOpen === -1) {
      console.error("No JSON start brace found in:", cleanedText);
      throw new Error("Invalid AI Response: No JSON");
    }

    let balance = 0;
    let extractEnd = -1;
    for (let i = firstOpen; i < cleanedText.length; i++) {
      const char = cleanedText[i];
      if (char === '{') {
        balance++;
      } else if (char === '}') {
        balance--;
        if (balance === 0) {
          extractEnd = i;
          break;
        }
      }
    }

    if (extractEnd !== -1) {
      cleanedText = cleanedText.substring(firstOpen, extractEnd + 1);
    }

    let structuredReport;
    try {
      structuredReport = JSON.parse(cleanedText);
    } catch (e) {
      console.error("[NewsGen] JSON Parse Error:", cleanedText);
      structuredReport = {
        analysis: "Analysis generated but formatting failed.",
        home_form: "N/A",
        away_form: "N/A",
        betting_splits: "N/A",
        key_trend: "N/A",
        keyInjuries: [],
        bettingFactors: []
      };
    }

    // Combined Report for Text Column (Legacy) + Structured Data
    // We will store the STRINGIFIED JSON in the 'report' column to allow the frontend to parse it.
    // This is a "Hack" to avoid DB migration, but efficient.
    const finalReportString = JSON.stringify(structuredReport);

    // 7. Extract Sources
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.filter((c: any) => c.web?.uri)
      .map((c: any) => ({ title: c.web.title || "Source", url: c.web.uri })) || [];

    // 8. Save to Database
    const { error: dbError } = await supabase.from("match_news").upsert({
      match_id: normalizedMatch.id,
      report: finalReportString,
      key_injuries: structuredReport.keyInjuries || [],
      betting_factors: structuredReport.bettingFactors || [],
      weather_forecast: structuredReport.weather || null,
      fatigue: structuredReport.fatigue || null,
      sources: sources,
      status: "ready",
      generated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString() // 4 hours
    }, { onConflict: "match_id" });

    if (dbError) {
      throw new Error(`Database Error: ${dbError.message}`);
    }

    // 9. Success Response
    return new Response(JSON.stringify({ success: true, data: structuredReport }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error: any) {
    console.error("[NewsGen] Fatal Error:", error.message);

    // Return structured error
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
