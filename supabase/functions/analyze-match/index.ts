import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";
import { getCanonicalMatchId } from "../_shared/match-registry.ts";

declare const Deno: any;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
  "Content-Type": "application/json",
};

const AUDITOR_INSTRUCTION = `ROLE: Live Game Analyst for a sports broadcast.
MISSION: Explain why the current score trend makes one side more attractive than the other.

MANDATORY: USE GOOGLE SEARCH
Before generating your analysis, you MUST search for:
- Current game updates and live box score
- Recent news about the teams playing
- Any injury updates or lineup changes announced today
Ground your analysis in REAL information from search results.

STYLE GUIDE:
1. PLAIN ENGLISH: Write like an ESPN commentator, not a hedge fund. Avoid terms like "variance," "algorithm," "extrapolating," "saturation," "mean reversion."
2. GAME FLOW: Focus on what's actually happening - pace of play, momentum shifts, defensive breakdowns, scoring runs.
3. ACTIONABLE INSIGHT: Give viewers a clear reason why one side looks good right now.
4. EXAMPLES OF GOOD LANGUAGE:
   - "Bologna controlling possession and limiting chances"
   - "Scoring pace is slowing down after the early goals"
   - "Home team finding rhythm, visitors look tired"
   - "This game has turned defensive after a fast start"
5. AVOID QUANT LANGUAGE:
   - BAD: "Market extrapolating unsustainable variance"
   - GOOD: "The early scoring pace is unlikely to continue"
   - BAD: "Mean reversion expected"  
   - GOOD: "Both defenses are settling in"`;

const AUDIT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    executive_bullets: {
      type: "object",
      properties: {
        spot: { type: "string" },
        driver: { type: "string" },
        verdict: { type: "string" }
      },
      required: ["spot", "driver", "verdict"]
    },
    analysis: { type: "string" },
    confidence_level: { type: "number" },
    recommendation: {
      type: "object",
      properties: {
        side: { type: "string", enum: ["OVER", "UNDER", "HOME", "AWAY", "PASS"] },
        unit_size: { type: "string" },
        market_type: { type: "string", enum: ["TOTAL", "SPREAD", "MONEYLINE"] }
      },
      required: ["side", "unit_size", "market_type"]
    }
  },
  required: ["headline", "executive_bullets", "analysis", "confidence_level", "recommendation"]
};

// Moment-based analysis types
type AnalysisMoment = 'GAME_START' | 'Q1_END' | 'HALFTIME' | 'MID_Q3' | 'GAME_END';

const MOMENT_PROMPTS: Record<AnalysisMoment, { focus: string; tone: string }> = {
  GAME_START: {
    focus: "Set the scene. What's the situational context for this matchup? Any rest advantages, travel, or key storylines?",
    tone: "Brief pregame preview - 2-3 sentences max."
  },
  Q1_END: {
    focus: "Pace check. Is this game playing faster or slower than expected? Are we on track for an OVER or UNDER?",
    tone: "Quick tempo update - focus on scoring pace and early trends."
  },
  HALFTIME: {
    focus: "Deep halftime analysis. What adjustments should we expect? Who's controlling the game? What does the second half projection look like?",
    tone: "Full breakdown - this is the premium analysis point. Be thorough but still accessible."
  },
  MID_Q3: {
    focus: "Second half momentum check. Are the halftime projections holding? Any shift in control or pace?",
    tone: "Quick momentum update - focus on what's changed since halftime."
  },
  GAME_END: {
    focus: "What did we learn? Did the game play out as expected? Key takeaways for future reference.",
    tone: "Post-game wrap - brief summary of what happened and why."
  }
};

// Determine the current game moment based on period and clock
const detectGameMoment = (period: number, clock: string, status: string, sport: string): AnalysisMoment => {
  // Game finished
  if (status === 'STATUS_FINAL' || status === 'final' || status === 'post') {
    return 'GAME_END';
  }

  // Parse clock for minutes remaining (handle various formats)
  const clockMins = parseInt(clock?.split(':')[0] || '0');

  // Basketball (4 quarters)
  if (sport === 'basketball') {
    if (period === 1 && clockMins > 10) return 'GAME_START';
    if (period === 1 && clockMins <= 2) return 'Q1_END';
    if (period === 2 && clockMins <= 1) return 'HALFTIME';
    if (period === 3 && clockMins <= 6 && clockMins >= 4) return 'MID_Q3';
    return 'HALFTIME'; // Default to halftime analysis for mid-game
  }

  // Soccer (2 halves, 45 min each)
  if (sport === 'soccer' || sport === 'football') {
    const matchMinute = period === 1 ? (45 - clockMins) : (45 + (45 - clockMins));
    if (matchMinute < 10) return 'GAME_START';
    if (matchMinute >= 40 && matchMinute <= 48) return 'Q1_END'; // End of first half
    if (matchMinute >= 48 && matchMinute <= 55) return 'HALFTIME';
    if (matchMinute >= 60 && matchMinute <= 70) return 'MID_Q3'; // 60th minute
    return 'HALFTIME';
  }

  // Default
  return 'HALFTIME';
};


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  console.log(`[${requestId}] 🚀 [LIVE-AUDIT-START] Analyze-match triggered`);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { match_id: rawId, snapshot, ai_signals } = await req.json();
    const match_id = getCanonicalMatchId(rawId, snapshot?.league_id || '');

    // Input Logging
    console.log(`[${requestId}] 📋 [MATCH-ID] Raw: ${rawId} | Canonical: ${match_id}`);
    console.log(`[${requestId}] 🏀 [MATCHUP] ${snapshot?.away_team || 'Away'} @ ${snapshot?.home_team || 'Home'}`);
    console.log(`[${requestId}] 📊 [GAME-STATE] Score: ${snapshot?.score || '0-0'} | Clock: ${snapshot?.clock || '0:00'} | Period: ${snapshot?.period || 'N/A'}`);

    const marketTotal = snapshot?.market_total || 0;
    const fairTotal = snapshot?.fair_total || 0;
    const edge = fairTotal - marketTotal;
    const recommendedSide = edge > 0 ? "OVER" : "UNDER";

    // Detect current game moment
    const period = snapshot?.period || 1;
    const clock = snapshot?.clock || '12:00';
    const status = snapshot?.status || 'in_progress';
    const sport = snapshot?.sport || 'basketball';
    const moment = detectGameMoment(period, clock, status, sport);
    const momentConfig = MOMENT_PROMPTS[moment];

    // Market Data Logging
    console.log(`[${requestId}] 💰 [MARKET-DATA] Vegas Total: ${marketTotal} | Fair Total: ${fairTotal}`);
    console.log(`[${requestId}] 📈 [EDGE-CALC] Delta: ${edge.toFixed(2)} pts | Direction: ${recommendedSide}`);
    console.log(`[${requestId}] 🎯 [MOMENT] Detected: ${moment} (Period: ${period}, Clock: ${clock})`);

    const prompt = `
    ### MATCH: ${snapshot?.away_team || 'Away'} @ ${snapshot?.home_team || 'Home'}
    ### LIVE GAME STATE
    - ${snapshot?.away_team || 'Away'}: ${snapshot?.away_score ?? 0} goals/points
    - ${snapshot?.home_team || 'Home'}: ${snapshot?.home_score ?? 0} goals/points
    - Clock: ${clock} | Period: ${period}
    - Betting Line (Total): ${marketTotal}
    - Our Projected Final Total: ${fairTotal}
    - Difference: ${Math.abs(edge).toFixed(1)} points ${edge > 0 ? 'OVER' : 'UNDER'} the line
    
    ### ANALYSIS TYPE: ${moment.replace('_', ' ')}
    ${momentConfig.focus}
    
    ### TONE
    ${momentConfig.tone}
    
    ### OUTPUT GUIDANCE
    - If ${recommendedSide} looks good, explain why in game-flow terms
    - Focus on what's actually happening on the court/pitch
    - Write like a halftime analyst, not a Wall Street trader
    `;


    console.log(`[${requestId}] 🧠 [GEMINI-START] Invoking Tactical Auditor with thinkingLevel: high...`);
    const geminiStart = Date.now();

    const { text, thoughts, sources } = await executeAnalyticalQuery(prompt, {
      model: "gemini-3-pro-preview",
      systemInstruction: AUDITOR_INSTRUCTION,
      responseSchema: AUDIT_SCHEMA,
      thinkingBudget: 32768,
      thinkingLevel: "high",  // Maximize reasoning depth for live edge calculations
      tools: [{ googleSearch: {} }]
    });

    const geminiDuration = Date.now() - geminiStart;
    console.log(`[${requestId}] ⏱️ [GEMINI-DONE] Response in ${geminiDuration}ms`);
    console.log(`[${requestId}] 🔗 [GROUNDING] ${sources?.length || 0} sources found`);
    console.log(`[${requestId}] 💭 [THINKING] ${thoughts?.length || 0} chars of reasoning trace`);

    const sharp_data = safeJsonParse(text);
    if (!sharp_data) throw new Error("Failed to parse audit response");

    // Output Quality Logging
    console.log(`[${requestId}] ✅ [PARSE-SUCCESS] Headline: ${sharp_data.headline?.substring(0, 50)}...`);
    console.log(`[${requestId}] 🎯 [RECOMMENDATION] Side: ${sharp_data.recommendation?.side} | Size: ${sharp_data.recommendation?.unit_size} | Confidence: ${sharp_data.confidence_level}%`);

    // Force mathematical alignment if delta is large
    if (Math.abs(edge) > 1.0 && sharp_data.recommendation) {
      console.log(`[${requestId}] ⚖️ [MATH-ALIGN] Forcing recommendation to ${recommendedSide} (edge > 1.0)`);
      sharp_data.recommendation.side = recommendedSide;
    }

    console.log(`[${requestId}] 💾 [DB-WRITE] Upserting to live_game_state...`);
    const { error: dbError } = await supabase.from("live_game_state").upsert({
      id: match_id,
      ai_analysis: {
        sharp_data,
        analysis_moment: moment, // GAME_START, Q1_END, HALFTIME, MID_Q3, GAME_END
        thought_trace: thoughts,
        sources: sources,
        generated_at: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    });


    if (dbError) {
      console.error(`[${requestId}] ❌ [DB-ERROR] ${dbError.message}`);
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[${requestId}] 🎉 [LIVE-AUDIT-SUCCESS] Total: ${totalDuration}ms | Gemini: ${geminiDuration}ms`);

    return new Response(JSON.stringify({ success: true, sharp_data, thought_trace: thoughts, sources }), { headers: CORS_HEADERS });

  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    console.error(`[${requestId}] ❌ [LIVE-AUDIT-FAIL] ${error.message} (after ${totalDuration}ms)`);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
  }
});
