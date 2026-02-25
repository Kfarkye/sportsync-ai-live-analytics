// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

import { createClient } from "@supabase/supabase-js";
import { executeStreamingAnalyticalQuery, executeAnalyticalQuery, executeEmbeddingQuery, safeJsonParse } from "../_shared/gemini.ts";
import { getActiveModel, getFallbackModel, ModelConfig } from "../_shared/model-registry.ts";
import { LLMRequest } from "../_shared/llm-adapter.ts";
import { executeGPT52StreamingQuery } from "../_shared/openai.ts";
import { americanToImplied, devig2Way } from "../_shared/oddsUtils.ts";


const CONFIG = {
  TIMEOUT_MS: 55000, // 55s - leaves 5s grace before Edge Function hard limit
  DEADLINE_GRACE_MS: 3000 // Time reserved for cleanup/persistence
};

// Strict Schema for Picks (Shared by Gemini & GPT-5.2)
const BETTING_PICK_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          match_id: { type: "string" }, // Should match context provided
          home_team: { type: "string" },
          away_team: { type: "string" },
          pick_type: { type: "string", enum: ["spread", "total", "moneyline"] },
          pick_side: { type: "string" }, // 'HOME', 'AWAY', 'OVER', 'UNDER'
          pick_line: { type: ["number", "null"] },
          pick_odds: { type: "integer" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reasoning: { type: "string" }
        },
        required: ["match_id", "pick_type", "pick_side", "confidence", "reasoning"],
        additionalProperties: false
      }
    }
  },
  required: ["picks"],
  additionalProperties: false
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-timeout, x-trace-id, baggage, sentry-trace, priority",
  "Access-Control-Max-Age": "86400",
};

// ═══════════════════════════════════════════════════════════════════════════
// 🧠 SOTA PHASE DETECTION: Prevents "Offseason" Hallucination
// ═══════════════════════════════════════════════════════════════════════════
const getMarketPhase = (match: any): string => {
  if (!match) return "UNKNOWN - VERIFY EXTERNAL";

  // 1. Trust the status if it exists
  const status = (match.status || match.game_status || "").toUpperCase();
  if (status.includes("IN_PROGRESS") || status.includes("LIVE") || status.includes("HALFTIME")) {
    return `🔴 LIVE_IN_PLAY [${match.clock || "Active"}]`;
  }
  if (status.includes("FINAL") || status.includes("FINISHED") || status.includes("COMPLETED")) return "🏁 FINAL_SCORE";

  // 2. Fallback to time math
  if (match.start_time) {
    const start = new Date(match.start_time).getTime();
    const now = Date.now();
    const diffHours = (start - now) / 36e5;

    // Logic Fix: Explicit ordering prevents finished games (-5h) matching "Closing Line" (< 1h)
    if (diffHours < 0 && diffHours > -4) return "🔴 LIVE_IN_PLAY (Calculated)";
    if (diffHours <= -4) return "🏁 FINAL_SCORE (Calculated)";
    if (diffHours < 1) return "⚡ CLOSING_LINE (T-Minus 60m)";
    if (diffHours < 24) return "🌊 DAY_OF_GAME";
    return "🔭 OPENING_MARKET";
  }

  // 3. CRITICAL: If we have team names but no time, do NOT assume offseason.
  if (match.home_team || match.home_team_name) return "⚠️ DATA_STALE - FORCE GOOGLE SEARCH";

  return "💤 OFFSEASON";
};

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ MULTIMODAL PARSER: Preserves Images & Text for Screenshot Analysis
// ═══════════════════════════════════════════════════════════════════════════
const extractUserContent = (msg: any): any => {
  if (!msg) return "Empty input";
  if (Array.isArray(msg.parts)) return msg.parts;
  if (Array.isArray(msg.content)) {
    return msg.content.map((p: any) => p.text || "[Media]").join(" ");
  }
  if (typeof msg.content === 'string') return msg.content;
  if (typeof msg === 'string') return msg;
  return "";
};

/**
 * 🛡️ Robust Part Extractor (for history)
 */
const extractUserParts = (msg: any): any[] => {
  if (!msg) return [{ text: " " }];

  // Case 1: Standard Gemini Parts Array (already correctly formatted)
  if (Array.isArray(msg.parts)) return msg.parts;

  // Case 2: Array of content objects (sent by our NEW ChatWidget)
  if (Array.isArray(msg.content)) {
    return msg.content.map((part: any) => {
      if (part.type === 'text') return { text: part.text || "" };

      // Map custom source structure to Gemini's inlineData
      if (part.source?.type === 'base64') {
        return {
          inlineData: {
            mimeType: part.source.media_type,
            data: part.source.data
          }
        };
      }
      return { text: "" };
    });
  }

  // Case 3: String content
  if (typeof msg.content === 'string') return [{ text: msg.content }];

  // Case 4: Raw string
  if (typeof msg === 'string') return [{ text: msg }];

  // Case 5: Safety Fallback for Objects
  try {
    const jsonStr = JSON.stringify(msg.content || msg);
    return [{ text: jsonStr }];
  } catch (e) {
    return [{ text: "Invalid Message Content" }];
  }
};

const logger = {
  info: (msg: string, data?: any) => console.log(JSON.stringify({ level: 'INFO', msg, ...data, timestamp: new Date().toISOString() })),
  error: (msg: string, data?: any) => console.error(JSON.stringify({ level: 'ERROR', msg, ...data, timestamp: new Date().toISOString() })),
  warn: (msg: string, data?: any) => console.warn(JSON.stringify({ level: 'WARN', msg, ...data, timestamp: new Date().toISOString() }))
};

// 🕐 ET Date Helper: Prevents timezone bugs where UTC shows tomorrow's fatigue
const getETDate = (offsetDays = 0): string => {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  // Format in ET timezone as YYYY-MM-DD
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
};

// ═══════════════════════════════════════════════════════════════════════════
// PICK EXTRACTION: Parse AI responses for betting recommendations
// ═══════════════════════════════════════════════════════════════════════════

interface ExtractedPick {
  pick_type: string;
  pick_side: string;
  pick_line: number | null;
  pick_odds: number | null;
  ai_confidence: string;
  reasoning_summary: string;
}

function extractPicksFromResponse(response: string, thoughts: string): ExtractedPick[] {
  const picks: ExtractedPick[] = [];
  const safeResponse = response || "";
  const safeThoughts = thoughts || "";
  const combinedText = `${safeResponse}\n${safeThoughts}`.toLowerCase();

  // ⛔ HARD GATE: If verdict is PASS, do not extract any picks.
  if (combinedText.includes('verdict: pass') || combinedText.includes('verdict: **pass**')) {
    return [];
  }

  // === NEW: Try to parse JSON-formatted picks first ===
  // The AI may return picks in a JSON code block like: ```json { "picks": [...] } ```
  const jsonBlockMatch = safeResponse.match(/```json\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (parsed.picks && Array.isArray(parsed.picks)) {
        for (const p of parsed.picks) {
          picks.push({
            pick_type: p.pick_type || 'unknown',
            pick_side: p.pick_side || 'unknown',
            pick_line: p.pick_line ?? 0,
            pick_odds: p.pick_odds ?? -110,
            ai_confidence: p.confidence || 'medium',
            reasoning_summary: p.reasoning?.substring(0, 500) || ''
          });
        }
        if (picks.length > 0) {
          return picks; // Successfully extracted from JSON
        }
      }
    } catch (e) {
      // JSON parsing failed, fall through to regex extraction
    }
  }

  // Also try parsing raw JSON (without code blocks)
  try {
    const rawParsed = JSON.parse(safeResponse.trim());
    if (rawParsed.picks && Array.isArray(rawParsed.picks)) {
      for (const p of rawParsed.picks) {
        picks.push({
          pick_type: p.pick_type || 'unknown',
          pick_side: p.pick_side || 'unknown',
          pick_line: p.pick_line ?? 0,
          pick_odds: p.pick_odds ?? -110,
          ai_confidence: p.confidence || 'medium',
          reasoning_summary: p.reasoning?.substring(0, 500) || ''
        });
      }
      if (picks.length > 0) {
        return picks;
      }
    }
  } catch (e) {
    // Not raw JSON, continue with regex
  }



  // Check if this is actually a pick recommendation
  const pickIndicators = [
    'i recommend', 'my pick', 'take the', 'bet on', 'lean towards', 'strong edge',
    'play:', 'pick:', 'recommendation:', 'best bet', 'sharp play', 'value on',
    'dislocation on', 'ev+', 'fair price shows', 'variance favors',
    'structural edge', 'market mismatch', 'verdict:'
  ];

  const hasPick = pickIndicators.some(indicator => combinedText.includes(indicator));
  if (!hasPick) return picks;

  let confidence = 'medium';
  if (combinedText.includes('high confidence') || combinedText.includes('strong conviction') || combinedText.includes('heavily favor')) {
    confidence = 'high';
  } else if (combinedText.includes('low confidence') || combinedText.includes('slight lean') || combinedText.includes('marginal edge')) {
    confidence = 'low';
  }

  // Strip markdown bold/italic before matching (Fixes issues with "**Lakers**")
  const cleanResponse = safeResponse.replace(/[*_]+/g, '');

  // Pattern: Spread
  const spreadPattern = /(?:take|bet|recommend|pick|play|verdict)[:\s]*(?:the\s+)?([A-Za-z\s]+?)\s*([-+]\d+\.?\d*)/gi;
  let match;
  while ((match = spreadPattern.exec(cleanResponse)) !== null) {
    const team = match[1].trim();
    const line = parseFloat(match[2]);
    if (team.length > 2 && team.length < 30 && !team.toLowerCase().includes('over') && !team.toLowerCase().includes('under') && !team.toLowerCase().includes('pass')) {
      picks.push({
        pick_type: 'spread',
        pick_side: team,
        pick_line: line,
        pick_odds: -110,
        ai_confidence: confidence,
        reasoning_summary: extractReasoning(safeResponse, safeThoughts)
      });
    }
  }

  // Pattern: Totals
  const totalPattern = /(?:take|bet|recommend|pick|play)[\s:]*(?:the\s+)?(over|under)\s*(\d+\.?\d*)/gi;
  while ((match = totalPattern.exec(cleanResponse)) !== null) {
    picks.push({
      pick_type: 'total',
      pick_side: match[1].toUpperCase(),
      pick_line: parseFloat(match[2]),
      pick_odds: -110,
      ai_confidence: confidence,
      reasoning_summary: extractReasoning(safeResponse, safeThoughts)
    });
  }

  // Pattern: Moneyline
  const mlPattern = /(?:take|bet|recommend|pick|play)[\s:]*(?:the\s+)?([A-Za-z\s]+?)\s*(?:ML|moneyline)/gi;
  while ((match = mlPattern.exec(cleanResponse)) !== null) {
    const team = match[1].trim();
    if (team.length > 2 && team.length < 30) {
      picks.push({
        pick_type: 'moneyline',
        pick_side: team,
        pick_line: null,
        pick_odds: null,
        ai_confidence: confidence,
        reasoning_summary: extractReasoning(safeResponse, safeThoughts)
      });
    }
  }

  // === VERDICT-SPECIFIC PATTERNS ===

  // Pattern for VERDICT: Team ML (odds) format
  // Matches: "VERDICT: Juventus ML (-125 / 1.80)" or "VERDICT: Lakers ML"
  const verdictMLPattern = /verdict[:\s]+([A-Za-z\s]+?)\s*ML\s*(?:\(([+-]?\d+)[^)]*\))?/gi;
  while ((match = verdictMLPattern.exec(cleanResponse)) !== null) {
    const team = match[1].trim();
    const odds = match[2] ? parseInt(match[2]) : -110;
    if (team.length > 2 && team.length < 30 && !team.toLowerCase().includes('pass')) {
      picks.push({
        pick_type: 'moneyline',
        pick_side: team,
        pick_line: null,
        pick_odds: odds,
        ai_confidence: confidence,
        reasoning_summary: extractReasoning(safeResponse, safeThoughts)
      });
    }
  }

  // Pattern for VERDICT: Team spread format
  // Matches: "VERDICT: Lakers -3.5" or "VERDICT: Celtics +7"
  const verdictSpreadPattern = /verdict[:\s]+([A-Za-z\s]+?)\s*([-+]\d+\.?\d*)\s*(?:\([^)]*\))?/gi;
  while ((match = verdictSpreadPattern.exec(cleanResponse)) !== null) {
    const team = match[1].trim();
    const line = parseFloat(match[2]);
    if (team.length > 2 && team.length < 30 && !team.toLowerCase().includes('pass') && !team.toLowerCase().includes('ml')) {
      const exists = picks.some(p => p.pick_side.toLowerCase() === team.toLowerCase());
      if (!exists) {
        picks.push({
          pick_type: 'spread',
          pick_side: team,
          pick_line: line,
          pick_odds: -110,
          ai_confidence: confidence,
          reasoning_summary: extractReasoning(safeResponse, safeThoughts)
        });
      }
    }
  }

  // Pattern for VERDICT: Over/Under total format
  // Matches: "VERDICT: Under 2.5" or "VERDICT: Over 221.5 (-110)"
  const verdictTotalPattern = /verdict[:\s]+(over|under)\s*(\d+\.?\d*)\s*(?:\(([+-]?\d+)[^)]*\))?/gi;
  while ((match = verdictTotalPattern.exec(cleanResponse)) !== null) {
    const side = match[1].toUpperCase();
    const line = parseFloat(match[2]);
    const odds = match[3] ? parseInt(match[3]) : -110;
    picks.push({
      pick_type: 'total',
      pick_side: side,
      pick_line: line,
      pick_odds: odds,
      ai_confidence: confidence,
      reasoning_summary: extractReasoning(safeResponse, safeThoughts)
    });
  }

  return picks;
}

function extractReasoning(response: string, thoughts: string): string {
  const reasoningPatterns = [
    /edge\s*:?\s*([^.]+\.)/i,
    /because\s+([^.]+\.)/i,
    /key\s+factor\s*:?\s*([^.]+\.)/i,
    /value\s+(?:is|comes?\s+from)\s+([^.]+\.)/i
  ];

  for (const pattern of reasoningPatterns) {
    const match = (thoughts || response).match(pattern);
    if (match) return match[1].substring(0, 200);
  }

  const sentences = response.split(/[.!?]/).filter((s: string) => s.length > 30);
  return sentences[0]?.substring(0, 200) || 'AI recommendation based on market analysis';
}


Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  logger.info("CHAT_REQUEST_START", { requestId });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 🛡️ Fix: Safe JSON parsing to prevent crash on empty/malformed body
    let body;
    try {
      body = await req.json();
    } catch (e) {
      logger.warn("INVALID_JSON_BODY", { requestId, error: String(e) });
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: CORS_HEADERS });
    }

    const { messages, session_id, current_match, conversation_id, live_snapshot } = body;

    // Fix: Validates messages array to prevent downstream crashes
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      logger.warn("EMPTY_MESSAGE_PAYLOAD", { requestId });
      return new Response(JSON.stringify({ content: "Link idle." }), { headers: CORS_HEADERS });
    }

    // 🆕 Log if we received real-time client data
    // Fix: Parse timestamp robustly (handles ISO strings, numbers, or nulls)
    const getSnapshotAge = (snap: any) => {
      if (!snap?.timestamp) return Infinity;
      const ts = new Date(snap.timestamp).getTime();
      return isNaN(ts) ? Infinity : (Date.now() - ts) / 1000;
    };
    const snapshotAge = getSnapshotAge(live_snapshot);

    if (live_snapshot) {
      logger.info("LIVE_SNAPSHOT_RECEIVED", { requestId, score: live_snapshot.score, clock: live_snapshot.clock, age: snapshotAge });
    }

    const matchId = current_match?.match_id || current_match?.id;
    const lastUserMessage = messages[messages.length - 1];
    const lastUserParts = extractUserParts(lastUserMessage);
    const lastUserText = lastUserParts.find(p => p.text)?.text || "";

    // 📸 Log Multimodal Ingestion Summary
    const imageCount = lastUserParts.filter(p => p.inlineData?.mimeType?.startsWith('image/')).length;
    const fileCount = lastUserParts.filter(p => p.inlineData?.mimeType && !p.inlineData.mimeType.startsWith('image/')).length;
    if (imageCount > 0 || fileCount > 0) {
      logger.info("MULTIMODAL_INGESTION_SUMMARY", { requestId, images: imageCount, files: fileCount });
    }

    const isGreetingTrigger = lastUserText === "GENERATE_GREETING";

    const fetchStart = Date.now();
    const [identityRes, ragRes, liveStateRes, teamContextRes, scheduleRes, tempoRes] = await Promise.allSettled([
      (async () => {
        let activeId = conversation_id;
        let history = [];
        if (session_id && !activeId) {
          const { data } = await supabase.rpc('get_or_create_conversation', {
            p_session_id: session_id,
            p_match_id: matchId || null
          });
          if (data) activeId = data;
        }
        if (activeId) {
          const { data } = await supabase.from('conversations').select('messages').eq('id', activeId).single();
          if (data) history = data.messages || [];
        }
        return { activeId, history };
      })(),
      (async () => {
        if (!lastUserText || isGreetingTrigger) return "";
        const ragStart = Date.now();
        try {
          const qEmb = await executeEmbeddingQuery(lastUserText);
          const { data } = await supabase.rpc('match_chat_knowledge', { query_embedding: qEmb, match_threshold: 0.60, match_count: 5 });
          const content = data?.map((m: any) => m.content).join('\n') || "";
          return content;
        } catch (e: any) {
          logger.error("RAG_FAULT", { requestId, error: e.message });
          return "";
        }
      })(),
      (async () => {
        if (!matchId) return null;
        try {
          const [state, match] = await Promise.all([
            supabase.from('live_game_state').select('*').eq('id', matchId).maybeSingle(),
            supabase.from('matches').select('home_score, away_score, display_clock, status, current_odds').eq('id', matchId).maybeSingle()
          ]);
          return { state: state.data, match: match.data };
        } catch (e: any) {
          logger.warn("TELEMETRY_FAULT", { requestId, error: e.message });
          return null;
        }
      })(),
      (async () => {
        if (!current_match?.home_team || !current_match?.away_team) return null;
        const today = getETDate();
        try {
          const [homeCtx, awayCtx] = await Promise.all([
            supabase.from('team_game_context').select('injury_notes, injury_impact, situation, rest_days, fatigue_score').eq('team', current_match.home_team).eq('game_date', today).maybeSingle(),
            supabase.from('team_game_context').select('injury_notes, injury_impact, situation, rest_days, fatigue_score').eq('team', current_match.away_team).eq('game_date', today).maybeSingle()
          ]);
          return { home: homeCtx.data, away: awayCtx.data };
        } catch (e: any) {
          logger.warn("TEAM_CONTEXT_FAULT", { requestId, error: e.message });
          return null;
        }
      })(),
      (async () => {
        try {
          const today = getETDate();
          const twoWeeksOut = getETDate(14);
          const { data, error } = await supabase
            .from('matches')
            .select('id, home_team, away_team, start_time, sport, league_id')
            .gte('start_time', today)
            .lte('start_time', twoWeeksOut)
            .order('start_time', { ascending: true })
            .limit(2000);
          if (error) throw error;
          return data || [];
        } catch (e: any) {
          return [];
        }
      })(),
      (async () => {
        if (!current_match?.home_team && !current_match?.away_team) return null;
        try {
          const teams = [current_match.home_team, current_match.away_team].filter(Boolean);
          const { data, error } = await supabase
            .from('team_tempo')
            .select('team, pace, ortg, drtg, net_rtg, ats_record, ats_l10, over_record, under_record, over_l10, under_l10, rank')
            .in('team', teams);
          if (error) throw error;
          return data || [];
        } catch (e: any) {
          return [];
        }
      })()
    ]);

    const { activeId, history: storedHistory } = identityRes.status === 'fulfilled' ? identityRes.value : { activeId: null, history: [] };
    const ragContext = ragRes.status === 'fulfilled' ? ragRes.value : "";
    const telemetry = liveStateRes.status === 'fulfilled' ? liveStateRes.value : null;
    const teamContextData = teamContextRes.status === 'fulfilled' ? teamContextRes.value : null;
    const scheduleData = scheduleRes.status === 'fulfilled' ? scheduleRes.value : [];
    const tempoData = tempoRes.status === 'fulfilled' ? tempoRes.value : [];

    if (lastUserText === "INIT_HISTORY") {
      return new Response(JSON.stringify({ messages: storedHistory, conversation_id: activeId }), { headers: CORS_HEADERS });
    }

    const now = new Date();
    const estTime = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const liveMatch = telemetry?.match;
    const liveSignals = telemetry?.state?.deterministic_signals;
    const useLiveSnapshot = live_snapshot && snapshotAge < 30;

    const telemetryBlock = useLiveSnapshot ? `
      LIVE TELEMETRY [CLIENT REAL-TIME - ${snapshotAge.toFixed(1)}s old]:
      ${current_match?.away_team || 'Away'}: ${live_snapshot.away_score ?? 0}
      ${current_match?.home_team || 'Home'}: ${live_snapshot.home_score ?? 0}
      Clock: ${live_snapshot.clock || 'Pregame'} | Period: ${live_snapshot.period || 0}
      Status: ${live_snapshot.status}
      Spread: ${live_snapshot.spread ?? 'OFF'} | Total: ${live_snapshot.total ?? 'OFF'}
      ML Home: ${live_snapshot.moneyline_home ?? 'OFF'} | ML Away: ${live_snapshot.moneyline_away ?? 'OFF'}
    ` : liveMatch ? `
      LIVE TELEMETRY [DB FALLBACK]:
      ${current_match?.away_team || 'Away'}: ${liveMatch.away_score || 0}
      ${current_match?.home_team || 'Home'}: ${liveMatch.home_score || 0}
      Clock: ${liveMatch.display_clock || 'Pregame'}
      Status: ${liveMatch.status}
      Model Fair Total: ${liveSignals?.deterministic_fair_total?.toFixed(1) || 'Calculating...'}
      Edge Magnitude: ${liveSignals?.edge_points?.toFixed(1) || 0} points
      Pace (PPM): ${liveSignals?.ppm?.observed?.toFixed(3) || '0.000'}
    ` : "TELEMETRY: Offline. Use Search for live scores.";

    const buildTeamBlock = (ctx: any, teamName: string) => {
      if (!ctx) return `${teamName}: No context data`;
      const fatigue = ctx.fatigue_score ? `Fatigue: ${ctx.fatigue_score}/100` : '';
      const situation = ctx.situation ? `Situation: ${ctx.situation}` : '';
      const rest = ctx.rest_days !== undefined ? `Rest: ${ctx.rest_days}d` : '';
      const injuries = ctx.injury_notes || 'Healthy';
      return `${teamName}: ${[situation, rest, fatigue].filter(Boolean).join(' | ')} | Injuries: ${injuries}`;
    };

    const teamContextBlock = `
      ROSTER & FATIGUE CONTEXT [GROUND TRUTH]:
      ${buildTeamBlock(teamContextData?.home, current_match?.home_team || 'Home')}
      ${buildTeamBlock(teamContextData?.away, current_match?.away_team || 'Away')}
    `;

    const generateScheduleManifest = (games: any[]): string => {
      if (!games || games.length === 0) return "MANIFEST: No upcoming games found in database.";
      const today = getETDate();
      const tomorrow = getETDate(1);
      const byDate: Record<string, Record<string, number>> = {};
      const dateLeagues: Record<string, string[]> = {};

      for (const g of games) {
        const d = (g.start_time || "").split('T')[0];
        if (!d) continue;
        const league = (g.league_id || g.sport || 'Unknown').toUpperCase();

        if (!byDate[d]) byDate[d] = {};
        if (!dateLeagues[d]) dateLeagues[d] = [];

        byDate[d][league] = (byDate[d][league] || 0) + 1;
        if (!dateLeagues[d].includes(league)) dateLeagues[d].push(league);
      }

      const lines: string[] = ["UPCOMING SCHEDULE MANIFEST [14-DAY OVERVIEW]:"];
      lines.push("⚠️ If the user asks about a game on a date below, use 'fetch_detailed_schedule' to get the full context (odds, injuries, physics).");

      const dates = Object.keys(byDate).sort();
      for (const date of dates.slice(0, 14)) {
        const isToday = date === today;
        const isTomorrow = date === tomorrow;
        const marker = isToday ? '📍 TODAY' : isTomorrow ? '📆 TOMORROW' : '';
        const dateStr = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const summary = dateLeagues[date].map(l => `${l} (${byDate[date][l]})`).join(' | ');
        lines.push(`${marker ? marker + ' ' : ''}${dateStr}: ${summary}`);
      }
      return lines.join('\n      ');
    };

    const scheduleBlock = generateScheduleManifest(scheduleData);

    const formatTempoBlock = (teams: any[]): string => {
      if (!teams || teams.length === 0) return "";
      const lines = ["TEAM TEMPO & TRENDS [BETTING ANALYTICS]:"];
      for (const t of teams) {
        lines.push(`${t.team} (#${t.rank}): Pace ${t.pace} | ORTG ${t.ortg} | DRTG ${t.drtg} | Net ${t.net_rtg > 0 ? '+' : ''}${t.net_rtg}`);
        lines.push(`  ATS: ${t.ats_record} (L10: ${t.ats_l10}) | O/U: ${t.over_record}o-${t.under_record}u (L10: ${t.over_l10}o-${t.under_l10}u)`);
      }
      return lines.join('\n      ');
    };

    const tempoBlock = formatTempoBlock(tempoData || []);
    const marketPhase = getMarketPhase(current_match);

    const lastPlay = telemetry?.state?.last_play;
    const situation = telemetry?.state?.situation;
    const currentDrive = telemetry?.state?.current_drive;
    const signals = telemetry?.state?.deterministic_signals;
    const dbOdds = telemetry?.state?.odds;

    const livePlayBlock = lastPlay ? `
      LAST PLAY: ${lastPlay.text || 'N/A'}
      Type: ${lastPlay.type || 'unknown'} | Clock: ${lastPlay.clock || 'N/A'}
      Win Prob Shift: ${lastPlay.probability?.homeWinPercentage ? `Home ${lastPlay.probability.homeWinPercentage}%` : 'N/A'}
    ` : '';

    const recentPlays = telemetry?.state?.recent_plays;
    const recentPlaysBlock = Array.isArray(recentPlays) && recentPlays.length > 0 ? `
      RECENT GAME FLOW (last ${recentPlays.length} plays):
      ${recentPlays.map((p: any, i: number) => `${i + 1}. [${p.clock || 'N/A'}] ${p.team ? `${p.team}: ` : ''}${p.text}`).join('\n      ')}
    ` : '';

    const situationBlock = situation ? `
      LIVE SITUATION:
      ${situation.down ? `Down: ${situation.down} & ${situation.distance} at ${situation.yardLine}` : ''}
      ${situation.isRedZone ? '🔴 RED ZONE' : ''}
      ${situation.isPowerPlay ? '⚡ POWER PLAY' : ''}
      ${situation.possessionText || ''}
      ${situation.isBonus ? '🏀 BONUS' : ''}
      ${situation.balls !== undefined ? `Count: ${situation.balls}-${situation.strikes}, ${situation.outs} out` : ''}
      ${situation.onFirst || situation.onSecond || situation.onThird ? `Runners: ${[situation.onFirst && '1B', situation.onSecond && '2B', situation.onThird && '3B'].filter(Boolean).join(', ')}` : ''}
    `.trim() : '';

    const driveBlock = currentDrive ? `
      CURRENT DRIVE: ${currentDrive.description || 'Active'}
      ${currentDrive.plays ? `Plays: ${currentDrive.plays}` : ''} ${currentDrive.yards ? `| Yards: ${currentDrive.yards}` : ''}
    ` : '';

    const signalsBlock = signals ? `
      MODEL SIGNALS [Physics Engine]:
      Fair Total: ${signals.deterministic_fair_total?.toFixed(1) || 'N/A'}
      Market Total: ${signals.market_total?.toFixed(1) || 'N/A'}
      Edge: ${signals.edge_points?.toFixed(1) || 0} pts (${signals.edge_state || 'NEUTRAL'})
      Regime: ${signals.deterministic_regime || 'NORMAL'}
      PPM: Observed ${signals.ppm?.observed?.toFixed(3) || 0} vs Projected ${signals.ppm?.projected?.toFixed(3) || 0}
      P10-P90 Range: ${signals.p10_total?.toFixed(1) || 'N/A'} - ${signals.p90_total?.toFixed(1) || 'N/A'}
      Variance SD: ${signals.variance_sd?.toFixed(2) || 'N/A'}
      Market Lean: ${signals.narrative?.market_lean || 'NEUTRAL'}
      Signal Label: ${signals.narrative?.signal_label || 'LIVE READ'}
      ${signals.debug_trace?.slice(0, 3).join(' | ') || ''}
    ` : '';

    // Fix: Use ?? to handle 0 spread correctly
    const oddsBlock = dbOdds ? `
      ODDS SNAPSHOT:
      Current: Spread ${dbOdds.current?.homeSpread ?? 'OFF'} | Total ${dbOdds.current?.total ?? 'OFF'} | ML ${dbOdds.current?.homeWin ?? 'OFF'}/${dbOdds.current?.awayWin ?? 'OFF'}
      Opening: Spread ${dbOdds.opening?.homeSpread ?? dbOdds.opening?.spread ?? 'OFF'} | Total ${dbOdds.opening?.overUnder ?? 'OFF'}
      Live: ${dbOdds.current?.isLive ? 'YES' : 'NO'} | Provider: ${dbOdds.current?.provider || 'ESPN'}
    ` : '';

    const systemInstruction = `
<anti_hallucination_directive>
1. STRICT ANCHOR: Base game flow and situational analysis heavily on the RECENT_GAME_FLOW, LIVE_SITUATION, and TELEMETRY payloads.
2. ROSTER FREEDOM: You are fully permitted to use your internal knowledge of current 2025-2026 NBA rosters to name actual players for these specific teams (e.g., Desmond Bane for the Magic). 
3. NO REDACTIONS: NEVER use bracketed placeholders like "[The starting SG]" or "[The starting PG]". Confidently use their real names.
4. CONTEXT OVERRIDE: Prioritize live play-by-play flow over historical priors or pre-game narratives.
</anti_hallucination_directive>

<temporal_anchor>
TODAY: ${getETDate()} (${new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' })})
CURRENT TIME: ${estTime} ET
CRITICAL: All "tomorrow" references mean ${getETDate(1)}. All "yesterday" references mean ${getETDate(-1)}.
</temporal_anchor>

<RECENT_GAME_FLOW>
${telemetry?.state?.recent_plays ? JSON.stringify(telemetry.state.recent_plays, null, 2) : 'No recent plays available.'}
</RECENT_GAME_FLOW>

<LIVE_SITUATION>
${telemetry?.state?.situation ? JSON.stringify(telemetry.state.situation, null, 2) : 'No live situation data available.'}
</LIVE_SITUATION>

<TELEMETRY>
${JSON.stringify({
      stats: telemetry?.state?.stats || null,
      player_stats: telemetry?.state?.player_stats || null,
      momentum: telemetry?.state?.momentum || null,
      advanced_metrics: telemetry?.state?.advanced_metrics || null,
      current_drive: telemetry?.state?.current_drive || null
    }, null, 2)}
</TELEMETRY>

<search_directive>
REQUIRED: Conduct TWO separate searches for every game:

1. MARKET DATA: "\${away_team} vs \${home_team} betting splits sentiment \${TODAY}"
2. SOCIAL PULSE: "\${away_team} vs \${home_team} reddit twitter real time public sentiment \${TODAY}"

You must combine data from both established market sources AND social threads.

DIVERSITY REQUIREMENT:
Cite AT LEAST 5-7 distinct sources. Prefer variety:
- 2+ Traditional/Betting Media (Action, VSiN, ESPN)
- 1+ Social Sentiment (Reddit, Twitter threads)
- 1+ Injury/News (Official reports)
</search_directive>

<role>
You are "The Edge" - a Market Structuralist & Risk Manager.
You do not predict the game. You predict where the *Line* is wrong.
You adhere to the **Efficient Market Hypothesis**.
Your Default State is **PASS**. You only recommend a play if a "Triple Confluence" is met.
</role>

<decision_gate>
⛔ **HARD GATE:**
Your DEFAULT output must be **VERDICT: PASS**.
To override this and recommend a play, you MUST prove a **TRIPLE CONFLUENCE**:

1.  💰 **Price Error:** Implied Probability vs Model Reality has a distinct delta (e.g., Market implies 60%, Model sees 52%).
2.  📉 **Sentiment Signal:** WEAPONIZED SEARCH must find >70% Public on the *Losing* side OR Sharp Money on the *Winning* side.
3.  🏗️ **Structural Support:** Game Physics (Pace, Defense, Possession) must support the contrarian view.

**IF ANY CONDITION IS MISSING -> VERDICT: PASS.**
Do not force a bet. Real sharps pass on 90% of games.
</decision_gate>

<search_doctrine>
🔥 **WEAPONIZED SEARCH:**
Search for:
1. "Public betting splits [Matchup]" (Identify the Square side).
2. "Reverse line movement [Matchup]" (Identify the Sharp side).
3. "Referee assignment [Matchup] tendencies".
</search_doctrine>

<multimodal_reasoning>
👁️ **VISION & MULTI-FILE DIRECTIVE:**
1. If images/screenshots are provided, perform **OCR** and **Visual Parsing** immediately.
2. Cross-reference data between multiple files (e.g. compare a screenshot of live odds with a PDF injury report).
3. Trust visual evidence from screenshots over metadata if they conflict.
4. If a PDF is provided, treat it as the **Primary Technical Source**.
</multimodal_reasoning>

<output_rules>
**FORMAT IS NON-NEGOTIABLE:**

**VERDICT:** [The Play] OR [PASS] (e.g., Structural Under 3.5)
**EVIDENCE:**
- **The Narrative:** [What the squares believe].
- **The Structural Reality:** [Why physics/math contradicts the narrative].
- **The Market Read:** [Splits/Movement].
**CONFIDENCE:** [High/Medium/Low] (High only if all three dimensions align: Price, Sentiment, Physics).
**WHAT TO WATCH LIVE:** [Actionable in-game triggers that validate or invalidate this pick. E.g., "If xG exceeds 0.8 by 30', consider live hedge" or "Monitor box touches for Jonathan David — if <3 by halftime, thesis weakens."]
**THE RULE:** [The generalized principle, e.g., "Fade public overs on slow-paced teams"].

**STYLE — TYPOGRAPHY:**
- Italicize proper competition names in non-English languages: *Derby d'Italia*, *Clásico*, *Der Klassiker*, *Le Classique*, *Superclásico*
- Do NOT italicize team names (Monterrey, León, Juventus, etc.)
- Use proper em-dashes (—) not double hyphens (--)
- Use proper ellipsis (…) not three dots (...)
</output_rules>


<context>
MARKET_PHASE: ${marketPhase}
TIME: ${estTime} ET

DATA SOURCES (priority order):
1. VISUAL: If user sends IMAGE, trust it over metadata
2. LIVE CLIENT: ${useLiveSnapshot ? `Score: ${live_snapshot.score}, Clock: ${live_snapshot.clock}` : 'No client data'}
3. DB TELEMETRY: ${liveMatch ? `${liveMatch.away_score}-${liveMatch.home_score}` : 'Offline'}

${telemetryBlock}
${signalsBlock}
${oddsBlock}
${livePlayBlock}
${recentPlaysBlock}
${situationBlock}
${driveBlock}
${teamContextBlock}
${scheduleBlock}
${tempoBlock}
${ragContext ? `
KNOWLEDGE BASE [RAG - VERIFIED DOMAIN INTEL]:
${ragContext}
` : ''}
</context>

<task>
MATCH: ${current_match?.away_team} @ ${current_match?.home_team} (${current_match?.league})
SCHEDULED: ${current_match?.start_time ? new Date(current_match.start_time).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'TIME UNKNOWN - VERIFY VIA SEARCH'}
Apply the full analytical framework. If the edge isn't structural, PASS.
</task>
    `;

    // INVARIANT: Prevent context starvation hallucination loop
    if (!systemInstruction.includes('<anti_hallucination_directive>')) {
      logger.error("INVARIANT_VIOLATION: AI prompt missing hallucination safeguards", { requestId, file: "ai-chat/index.ts" });
      throw new Error("Context Starvation Warning: Cannot execute AI analysis without strict telemetry anchoring safeguards.");
    }

    const chatHistory = messages
      .slice(0, -1)
      .map((m: any) => {
        if (!m || typeof m !== 'object') return null;
        return {
          role: m.role === 'model' ? 'model' : 'user',
          parts: extractUserParts(m)
        };
      })
      .filter((m: any) => m !== null);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let fullReply = "";
        let rawThoughts = ""; // Keep raw model thoughts separate; promote to visible reply only if no text ever arrives
        let groundingUrls: any[] = [];
        let groundingMetadata: any = null; // Full Gemini grounding for inline citations
        let ttftLogged = false;
        let isPartialResponse = false; // Track if we hit deadline
        let promotedThoughtsToText = false; // Track if we had to promote thoughts
        const inferenceStart = Date.now();
        const hardDeadline = startTime + CONFIG.TIMEOUT_MS; // Wall-clock cutoff

        // === PROMOTE THOUGHTS TO TEXT IF EMPTY ===
        const promoteThoughtsToTextIfEmpty = (): boolean => {
          const hasNoText = fullReply.trim().length === 0;
          const hasThoughts = rawThoughts.trim().length > 0;
          if (hasNoText && hasThoughts) {
            fullReply = rawThoughts;
            controller.enqueue(encoder.encode(JSON.stringify({ type: "text", content: fullReply }) + "\n"));
            return true;
          }
          return false;
        };

        // === DEADLINE CHECK HELPER ===
        const checkDeadline = (): boolean => {
          const remaining = hardDeadline - Date.now();
          if (remaining < CONFIG.DEADLINE_GRACE_MS) {
            logger.warn("DEADLINE_APPROACHING", { remainingMs: remaining });
            return true; // Signal to abort gracefully
          }
          return false;
        };

        try {
          logger.info("INFERENCE_START", { requestId, model: "multi-model-router" });


          // ============================================
          // MULTI-MODEL EXECUTION LOGIC
          // ============================================
          let activeModel = getActiveModel();
          let modelUsedID = activeModel.id;
          let streamGen: any;

          // 1. Prepare Request
          const llmRequest: LLMRequest = {
            model: activeModel.id,
            systemPrompt: activeModel.systemPromptOverride || systemInstruction,
            messages: lastUserParts.map(p => ({ role: 'user', content: p.text || '' })),
            stream: true,
            reasoningLevel: activeModel.reasoningEffort,
            verbosity: activeModel.verbosity,
            // Note: jsonSchema removed for general chat - only apply for explicit pick requests
            // jsonSchema: BETTING_PICK_SCHEMA,
            enableGrounding: true
          };


          try {
            logger.info("INFERENCE_START", { requestId, model: activeModel.id });

            // Branch Execution based on Provider
            if (activeModel.apiProvider === 'google') {
              // Legacy Gemini Call (using our updated unified adapter if possible, or keeping raw for now)
              // Integrating adapter fully would be cleaner, but let's stick to existing gemini.ts for stability
              // and just use the config. 
              // Wait - we need structured output from Gemini too.
              // Let's rely on `executeStreamingAnalyticalQuery` from gemini.ts for now as primary.
              streamGen = executeStreamingAnalyticalQuery(lastUserParts, {
                model: activeModel.id,
                systemInstruction: llmRequest.systemPrompt,
                tools: [{ googleSearch: {} }],
                history: chatHistory,
                thinkingLevel: "high" // Gemini Flash needs high thinking
                // NOTE: responseSchema removed - we want natural language output
                // Pick extraction happens via extractPicksFromResponse() which parses JSON from prose
              });

            } else {
              // Should not happen as primary is Gemini, but safe to have
              streamGen = executeGPT52StreamingQuery(llmRequest);
            }

            // Iterate Stream (Primary) with DEADLINE CHECK
            for await (const chunk of streamGen) {
              if (checkDeadline()) {
                logger.warn("DEADLINE_HIT_PRIMARY", { model: activeModel.id, contentLength: fullReply.length });
                isPartialResponse = true;
                break; // Exit gracefully before platform kill
              }
              await processChunk(chunk, activeModel.apiProvider);
            }

          } catch (primaryError: any) {
            logger.error("PRIMARY_MODEL_FAILED", { model: activeModel.id, error: primaryError?.message || String(primaryError) });

            // 2. FAILOVER LOGIC - Cascade through models
            const fallbackModel = getFallbackModel(activeModel.id);

            if (fallbackModel) {
              logger.warn("FAILOVER_ENGAGED", { from: activeModel.id, to: fallbackModel.id });
              activeModel = fallbackModel;
              modelUsedID = fallbackModel.id;

              // Update Request for Fallback
              llmRequest.model = fallbackModel.id;
              llmRequest.systemPrompt = fallbackModel.systemPromptOverride || systemInstruction;
              llmRequest.reasoningLevel = fallbackModel.reasoningEffort;

              try {
                let fallbackGen: any;

                if (fallbackModel.apiProvider === 'google') {
                  // Fallback to another Gemini model with DEGRADED settings
                  // Drop tools + reduce thinking to improve success rate
                  fallbackGen = executeStreamingAnalyticalQuery(lastUserParts, {
                    model: fallbackModel.id,
                    systemInstruction: llmRequest.systemPrompt,
                    tools: [], // DEGRADATION: No tools on fallback
                    history: chatHistory,
                    thinkingLevel: "medium" // DEGRADATION: Reduced thinking
                  });
                } else if (fallbackModel.apiProvider === 'openai') {
                  // Final fallback to GPT-5.2
                  fallbackGen = executeGPT52StreamingQuery(llmRequest);
                }

                // Iterate Stream (Fallback) with DEADLINE CHECK
                for await (const chunk of fallbackGen) {
                  if (checkDeadline()) {
                    logger.warn("DEADLINE_HIT_FALLBACK", { model: fallbackModel.id, contentLength: fullReply.length });
                    isPartialResponse = true;
                    break;
                  }
                  await processChunk(chunk, fallbackModel.apiProvider);
                }
              } catch (fallbackError: any) {
                logger.error("FALLBACK_MODEL_FAILED", { model: fallbackModel.id, error: fallbackError?.message || String(fallbackError) });

                // Try one more fallback if available
                const lastResort = getFallbackModel(fallbackModel.id);
                if (lastResort && lastResort.apiProvider === 'openai') {
                  logger.warn("LAST_RESORT_ENGAGED", { to: lastResort.id });
                  modelUsedID = lastResort.id;
                  llmRequest.model = lastResort.id;
                  llmRequest.systemPrompt = lastResort.systemPromptOverride || systemInstruction;

                  const lastResortGen = executeGPT52StreamingQuery(llmRequest);
                  for await (const chunk of lastResortGen) {
                    if (checkDeadline()) {
                      logger.warn("DEADLINE_HIT_LAST_RESORT", { model: lastResort.id, contentLength: fullReply.length });
                      isPartialResponse = true;
                      break;
                    }
                    await processChunk(chunk, 'openai');
                  }
                } else {
                  throw fallbackError;
                }
              }
            } else {
              throw primaryError; // No fallback available
            }

          }

          async function processChunk(chunk: any, provider: string) {
            let chunkType = 'text';
            let chunkContent = '';

            if (provider === 'google') {
              chunkType = chunk.type;
              chunkContent = chunk.content;
              if (chunkType === 'grounding' && chunk.metadata) {
                // Capture full metadata for inline citations
                groundingMetadata = chunk.metadata;
                if (chunk.metadata.groundingChunks) {
                  const refs = chunk.metadata.groundingChunks
                    .map((c: any) => ({ title: c.web?.title || 'Source', uri: c.web?.uri }))
                    .filter((c: any) => c.uri);
                  groundingUrls = [...groundingUrls, ...refs];
                }
                return; // Don't stream grounding metadata as text
              }
            } else if (provider === 'openai') {
              chunkType = chunk.type;
              chunkContent = chunk.content || '';
              if (chunkType === 'error') throw new Error(chunkContent);
            }

            if (!ttftLogged && (chunkType === 'text' || chunkType === 'thought')) {
              logger.info("TTFT_REACHED", { requestId, ttft: Date.now() - inferenceStart });
              ttftLogged = true;
            }

            // Some Gemini streams emit content only as `thought`. Keep it,
            // and promote to visible reply at the end if no `text` arrives.
            if (chunkType === 'thought' && chunkContent) {
              rawThoughts += chunkContent;
              controller.enqueue(encoder.encode(JSON.stringify({ type: 'thought', content: chunkContent }) + "\n"));
            }

            if (chunkType === 'text' && chunkContent) {
              fullReply += chunkContent;
              controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', content: chunkContent }) + "\n"));
            }
          }


          // === PROMOTE THOUGHTS TO TEXT IF NO TEXT ARRIVED ===
          promotedThoughtsToText = promoteThoughtsToTextIfEmpty();

          // === LOG WHICH MODEL WAS USED ===
          logger.info("RESPONSE_COMPLETE", {
            requestId,
            modelUsed: modelUsedID,
            textLength: fullReply.length,
            thoughtsLength: rawThoughts.length,
            sourcesCount: groundingUrls.length,
            isPartial: isPartialResponse,
            totalLatencyMs: Date.now() - startTime,
            promotedThoughtsToText
          });

          const uniqueSources = Array.from(new Map(groundingUrls.map(u => [u.uri, u])).values());

          if (activeId) {
            const updatePayload = [...storedHistory];
            if (!isGreetingTrigger) updatePayload.push({ role: 'user', content: lastUserText || "[Input]", timestamp: new Date().toISOString() });
            updatePayload.push({
              role: 'model',
              content: fullReply,
              thoughts: rawThoughts,
              sources: uniqueSources,
              metadata: { requestId, latencyTotal: Date.now() - startTime, model: modelUsedID },
              timestamp: new Date().toISOString()
            });

            const { error: saveError } = await supabase.from('conversations').update({
              messages: updatePayload.slice(-40),
              last_message_at: new Date().toISOString()
            }).eq('id', activeId);

            if (saveError) logger.error("CONVERSATION_SAVE_FAILED", { requestId, error: saveError.message });
          }

          if (matchId && current_match && !isGreetingTrigger) {
            try {
              const extractedPicks = extractPicksFromResponse(fullReply, rawThoughts || "");

              if (extractedPicks.length > 0) {
                const openingSpread = dbOdds?.opening?.homeSpread ?? dbOdds?.opening?.spread ?? null;
                const openingTotal = dbOdds?.opening?.overUnder ?? null;
                const currentSpread = dbOdds?.current?.homeSpread ?? null;
                const currentTotal = dbOdds?.current?.total ?? null;

                // Proper devig: derive no-vig implied probability from actual market prices.
                // Falls back to moneyline-based devig when spread juice isn't available.
                const calcImpliedProb = (pick: typeof extractedPicks[0]): number | null => {
                  if (pick.pick_type === 'moneyline' && dbOdds?.current) {
                    const hML = dbOdds.current.homeWin ?? dbOdds.current.homeML;
                    const aML = dbOdds.current.awayWin ?? dbOdds.current.awayML;
                    if (hML && aML) {
                      const { probA, probB } = devig2Way(hML, aML);
                      return Math.round((pick.pick_side === 'HOME' ? probA : probB) * 100);
                    }
                  }
                  if (pick.pick_type === 'spread') {
                    const hOdds = dbOdds?.current?.homeSpreadOdds ?? -110;
                    const aOdds = dbOdds?.current?.awaySpreadOdds ?? -110;
                    const { probA, probB } = devig2Way(hOdds, aOdds);
                    return Math.round((pick.pick_side === 'HOME' ? probA : probB) * 100);
                  }
                  if (pick.pick_type === 'total') {
                    const oOdds = dbOdds?.current?.overOdds ?? -110;
                    const uOdds = dbOdds?.current?.underOdds ?? -110;
                    const { probA, probB } = devig2Way(oOdds, uOdds);
                    return Math.round((pick.pick_side === 'OVER' ? probA : probB) * 100);
                  }
                  return null;
                };

                const pickRecords = extractedPicks.map(pick => {
                  const relevantOpening = pick.pick_type === 'total' ? openingTotal : openingSpread;
                  const relevantCurrent = pick.pick_type === 'total' ? currentTotal : currentSpread;

                  let lineMovement = null;
                  if (relevantOpening !== null && relevantCurrent !== null) {
                    const diff = Number(relevantCurrent) - Number(relevantOpening);
                    if (!isNaN(diff)) lineMovement = diff;
                  }

                  return {
                    session_id: body.session_id || 'unknown',
                    conversation_id: activeId || null,
                    match_id: matchId,
                    home_team: current_match.home_team || 'Unknown',
                    away_team: current_match.away_team || 'Unknown',
                    league: current_match.league || current_match.sport || 'Unknown',
                    pick_type: pick.pick_type,
                    pick_side: pick.pick_side,
                    pick_line: pick.pick_line,
                    pick_odds: pick.pick_odds,
                    user_query: lastUserText.substring(0, 500),
                    ai_response_snippet: fullReply.substring(0, 500),
                    ai_confidence: pick.ai_confidence,
                    reasoning_summary: pick.reasoning_summary,
                    game_start_time: current_match.start_time || null,
                    result: 'pending',
                    opening_line: relevantOpening,
                    implied_probability: calcImpliedProb(pick),
                    market_alpha: lineMovement
                  };
                });

                const { error: pickError } = await supabase.from('ai_chat_picks').insert(pickRecords);
                if (pickError) logger.error("PICK_SAVE_FAILED", { requestId, error: pickError.message });
                else logger.info("PICKS_SAVED_TO_AI_CHAT_PICKS", { requestId, count: pickRecords.length });

                // === ALSO SAVE TO llm_model_picks FOR MODEL PERFORMANCE TRACKING ===
                const llmModelPicks = extractedPicks.map(pick => ({
                  model_id: modelUsedID, // <-- KEY: Track which model made this pick
                  session_id: body.session_id || 'unknown',
                  // Note: conversation_id omitted to avoid FK constraint issues
                  match_id: matchId,
                  home_team: current_match.home_team || 'Unknown',
                  away_team: current_match.away_team || 'Unknown',
                  league: current_match.league || current_match.sport || 'Unknown',

                  pick_type: pick.pick_type,
                  pick_side: pick.pick_side,
                  pick_line: pick.pick_line,
                  pick_odds: pick.pick_odds,
                  ai_confidence: pick.ai_confidence,
                  reasoning_summary: pick.reasoning_summary?.substring(0, 500),
                  game_start_time: current_match.start_time || null,
                  pick_result: 'PENDING'
                }));

                const { error: llmPickError } = await supabase.from('llm_model_picks').insert(llmModelPicks);
                if (llmPickError) logger.error("LLM_MODEL_PICKS_SAVE_FAILED", { requestId, error: llmPickError.message });
                else logger.info("PICKS_SAVED_TO_LLM_MODEL_PICKS", { requestId, model: modelUsedID, count: llmModelPicks.length });
              }
            } catch (pickExtractionError: any) {
              logger.warn("PICK_EXTRACTION_ERROR", { requestId, error: pickExtractionError.message });
            }
          }

          // === STREAM SOURCES TO UI IN FINAL MESSAGE ===
          controller.enqueue(encoder.encode(JSON.stringify({
            type: isPartialResponse ? 'partial_done' : 'done',
            conversation_id: activeId,
            sources: uniqueSources,
            groundingMetadata: groundingMetadata, // Full grounding for inline citations
            model: modelUsedID,
            metadata: {
              requestId,
              model: modelUsedID,
              isPartial: isPartialResponse,
              latencyMs: Date.now() - startTime
            }
          }) + "\n"));
          controller.close();

        } catch (e: any) {
          logger.error("STREAM_FAULT", { requestId, error: e.message });
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', content: e.message }) + "\n"));
          controller.close();
        }
      }
    });

    return new Response(stream, { headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream" } });

  } catch (fatalError: any) {
    logger.error("FATAL_CHAT_HANDLER_ERROR", { requestId, error: fatalError.message });
    return new Response(JSON.stringify({ error: fatalError.message || "Logic Fault", traceId: requestId }), { status: 500, headers: CORS_HEADERS });
  }
});
