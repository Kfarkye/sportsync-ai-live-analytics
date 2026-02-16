/* ============================================================================
   api/chat.js
   "Obsidian Citadel" — Production Backend (v26.1 Enhanced)
   
   Engine: Gemini 3 Flash Preview
   Protocol: Dual-Mode + Verdict First + Entity Firewall
   
   ENHANCEMENTS (v26.1 Enhanced):
   ├─ LOGIC: Corrected spread delta sign calculation (preserves direction)
   ├─ STREAM: Iterates ALL parts per chunk (prevents data loss)
   ├─ GATE: Restored score < 2 for strict confluence filtering
   ├─ PROMPT: Softened Entity Firewall (status claims only)
   └─ PROMPT: Added colon to INVALIDATION for UI parsing
============================================================================ */
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { BettingPickSchema } from "../lib/schemas/picks.js";
import { generateSatelliteSlug } from "./lib/satellite.js";

// =============================================================================
// INITIALIZATION
// =============================================================================

const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** Resolve the public origin for URL Context endpoints. */
function getPublicOrigin() {
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return "http://localhost:3000";
}

const CONFIG = {
    MODEL_ID: "gemini-3-flash-preview",
    THINKING_CONFIG: { includeThoughts: true, thinkingLevel: "high" },
    ANALYSIS_TRIGGERS: [
        "edge", "best bet", "should i bet", "picks", "prediction",
        "analyze", "analysis", "spread", "over", "under", "moneyline",
        "verdict", "play", "handicap", "sharp", "odds", "line",
        "lean", "lock", "parlay", "action", "value", "bet", "pick"
    ],
    TOOLS: [{ googleSearch: {} }, { urlContext: {} }],
    STALE_THRESHOLD_MS: 15 * 60 * 1000,  // 15 minutes
    INJURY_CACHE_TTL_MS: 5 * 60 * 1000   // 5 minutes
};

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Safely stringify an object with truncation.
 * @param {any} obj - Object to stringify
 * @param {number} maxLen - Maximum character length
 * @returns {string}
 */
function safeJsonStringify(obj, maxLen = 1200) {
    try {
        const str = JSON.stringify(obj);
        return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
    } catch {
        return "";
    }
}

/**
 * Detect operating mode based on query content.
 * @param {string} query - User's message
 * @param {boolean} hasImage - Whether message contains an image
 * @returns {'ANALYSIS' | 'CONVERSATION'}
 */
function detectMode(query, hasImage) {
    if (hasImage) return "ANALYSIS";
    if (!query) return "CONVERSATION";
    const q = query.toLowerCase();
    return CONFIG.ANALYSIS_TRIGGERS.some((t) => q.includes(t)) ? "ANALYSIS" : "CONVERSATION";
}

/**
 * Determine the market phase based on game status and timing.
 * @param {object} match - Match context object
 * @returns {string} Human-readable market phase
 */
function getMarketPhase(match) {
    if (!match) return "UNKNOWN";

    const status = (match.status || match.game_status || "").toUpperCase();

    // Live game states
    if (status.includes("IN_PROGRESS") || status.includes("LIVE") || status.includes("HALFTIME")) {
        return `🔴 LIVE_IN_PLAY [${match.clock || match.display_clock || "Active"}]`;
    }

    // Final states
    if (status.includes("FINAL") || status.includes("FINISHED") || status.includes("COMPLETE")) {
        return "🏁 FINAL_SCORE";
    }

    // Time-based phases
    if (match.start_time) {
        const hoursUntilStart = (new Date(match.start_time).getTime() - Date.now()) / 3.6e6;

        if (hoursUntilStart < 0 && hoursUntilStart > -4) return "🔴 LIVE_IN_PLAY (Inferred)";
        if (hoursUntilStart <= -4) return "🏁 FINAL_SCORE";
        if (hoursUntilStart < 1) return "⚡ CLOSING_LINE";
        if (hoursUntilStart < 6) return "🎯 SHARP_WINDOW";
        if (hoursUntilStart < 24) return "🌊 DAY_OF_GAME";
    }

    return "🔭 OPENING_MARKET";
}

/**
 * Check if the provided context data is stale.
 * @param {object} context - Game context
 * @returns {boolean}
 */
function isContextStale(context) {
    if (!context?.start_time) return false;

    const gameStart = new Date(context.start_time);
    const now = new Date();
    const status = (context.status || context.game_status || "").toUpperCase();

    const timeSinceStart = now - gameStart;
    const activeStatuses = ["IN_PROGRESS", "LIVE", "HALFTIME", "FINAL", "FINISHED"];

    if (timeSinceStart > CONFIG.STALE_THRESHOLD_MS && !activeStatuses.some(s => status.includes(s))) {
        return true;
    }

    return false;
}

/**
 * Calculate line movement preserving directional sign.
 * 
 * Assumes standard US convention: spread is relative to Home team.
 * - Negative spread = Home favored (e.g., Home -5.5)
 * - Positive spread = Home underdog (e.g., Home +3.0)
 * 
 * Delta Interpretation:
 * - Delta < 0: Line moved LEFT (e.g., -3 → -4) = HOME steam (money on favorite)
 * - Delta > 0: Line moved RIGHT (e.g., -3 → -2) = AWAY steam (money on underdog)
 * 
 * @param {object} currentOdds - Current odds object
 * @param {object} t60Snapshot - T-60 snapshot with odds
 * @returns {object} Line movement analysis
 */
function calculateLineMovement(currentOdds, t60Snapshot) {
    if (!currentOdds || !t60Snapshot?.odds) {
        return { available: false, signal: null };
    }

    const current = currentOdds;
    const opening = t60Snapshot.odds;
    const movements = [];

    // Spread movement analysis (preserves algebraic sign)
    if (current.spread !== undefined && opening.spread !== undefined) {
        const spreadDelta = current.spread - opening.spread;

        if (Math.abs(spreadDelta) >= 0.5) {
            // Negative delta = moved left (more negative) = HOME steam
            // Positive delta = moved right (less negative/more positive) = AWAY steam
            const direction = spreadDelta < 0 ? "HOME" : "AWAY";
            movements.push({
                type: "SPREAD",
                delta: Math.abs(spreadDelta).toFixed(1),
                direction,
                signal: Math.abs(spreadDelta) >= 1.5 ? "🚨 SHARP_STEAM" : "📊 LINE_MOVE"
            });
        }
    }

    // Total movement analysis
    if (current.total !== undefined && opening.total !== undefined) {
        const totalDelta = current.total - opening.total;

        if (Math.abs(totalDelta) >= 1) {
            const direction = totalDelta > 0 ? "UP" : "DOWN";
            movements.push({
                type: "TOTAL",
                delta: Math.abs(totalDelta).toFixed(1),
                direction,
                signal: Math.abs(totalDelta) >= 2.5 ? "🚨 SHARP_STEAM" : "📊 LINE_MOVE"
            });
        }
    }

    if (movements.length === 0) {
        return { available: true, signal: "STABLE_MARKET", movements: [] };
    }

    return {
        available: true,
        movements,
        signal: movements.some(m => m.signal === "🚨 SHARP_STEAM") ? "SHARP_ACTION_DETECTED" : "MODERATE_MOVEMENT"
    };
}

// =============================================================================
// LIVE SENTINEL
// =============================================================================

/**
 * Extract team name hints from user query for live game matching.
 * @param {string} query - User query
 * @returns {string[]} Team hint tokens
 */
function extractAllTeamHints(query) {
    if (!query) return [];

    const tokens = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4);

    return tokens.sort((a, b) => b.length - a.length).slice(0, 3);
}

/**
 * Scan live_game_state for active games matching user query.
 * @param {string} userQuery - User's message
 * @returns {Promise<{ok: boolean, data?: object, isLiveOverride?: boolean}>}
 */
async function scanForLiveGame(userQuery) {
    const hints = extractAllTeamHints(userQuery);
    if (!hints.length) return { ok: false };

    try {
        const orClauses = hints.map((h) => `home_team.ilike.%${h}%,away_team.ilike.%${h}%`).join(",");

        const { data, error } = await supabase
            .from("live_game_state")
            .select("*")
            .in("game_status", ["IN_PROGRESS", "HALFTIME", "END_PERIOD", "LIVE"])
            .or(orClauses)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (error) throw error;
        if (data?.[0]) return { ok: true, data: data[0], isLiveOverride: true };

        return { ok: false };
    } catch (e) {
        console.error("[Live Sentinel] Scan failed:", e.message);
        return { ok: false };
    }
}

// =============================================================================
// DATA FETCHERS
// =============================================================================

const INJURY_CACHE = new Map();

/**
 * Fetch injuries from ESPN API with caching.
 * @param {string} teamId - ESPN team ID
 * @param {string} sportKey - Sport identifier (NBA, NFL, NHL, NCAAB, CBB)
 * @returns {Promise<{injuries: object[], cached?: boolean}>}
 */
async function fetchESPNInjuries(teamId, sportKey) {
    if (!teamId) return { injuries: [] };

    const cacheKey = `${sportKey}_${teamId}`;
    const cached = INJURY_CACHE.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CONFIG.INJURY_CACHE_TTL_MS) {
        return { ...cached.data, cached: true };
    }

    const sportConfig = {
        NBA: { sport: "basketball", league: "nba" },
        NFL: { sport: "football", league: "nfl" },
        NHL: { sport: "hockey", league: "nhl" },
        NCAAB: { sport: "basketball", league: "mens-college-basketball" },
        CBB: { sport: "basketball", league: "mens-college-basketball" }
    }[sportKey] || { sport: "basketball", league: "nba" };

    try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${sportConfig.sport}/${sportConfig.league}/teams/${teamId}?enable=injuries`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

        if (!res.ok) throw new Error(`ESPN API ${res.status}`);

        const data = await res.json();
        const injuries = (data.team?.injuries || [])
            .map((i) => ({
                name: i.athlete?.displayName,
                status: i.status?.toUpperCase(),
                position: i.athlete?.position?.abbreviation
            }))
            .filter((i) => i.name && i.status)
            .slice(0, 8);

        const result = { injuries };
        INJURY_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });

        return result;
    } catch (e) {
        console.error(`[Injury Fetch] ${sportKey}/${teamId}:`, e.message);
        return { injuries: [] };
    }
}

/**
 * Fetch live game state from database.
 * @param {string} matchId - Match UUID
 * @returns {Promise<{ok: boolean, data?: object}>}
 */
async function fetchLiveState(matchId) {
    if (!matchId) return { ok: false };

    try {
        const { data, error } = await supabase
            .from("live_game_state")
            .select("*")
            .eq("id", matchId)
            .maybeSingle();

        if (error) throw error;
        return data ? { ok: true, data } : { ok: false };
    } catch (e) {
        console.error("[Live State] Fetch failed:", e.message);
        return { ok: false };
    }
}

// =============================================================================
// EVIDENCE PACKET BUILDER
// =============================================================================

/**
 * Build comprehensive evidence packet for AI context.
 * @param {object} context - Game context
 * @returns {Promise<object>}
 */
async function buildEvidencePacket(context) {
    const packet = {
        injuries: { home: [], away: [] },
        liveState: null,
        temporal: { t60: null, t0: null },
        lineMovement: null
    };

    const promises = [];

    // Parallel injury fetches
    if (context?.home_team_id && context?.away_team_id) {
        promises.push(
            Promise.all([
                fetchESPNInjuries(context.home_team_id, context.sport || context.league),
                fetchESPNInjuries(context.away_team_id, context.sport || context.league)
            ]).then(([homeData, awayData]) => {
                packet.injuries.home = homeData.injuries;
                packet.injuries.away = awayData.injuries;
            })
        );
    }

    // Live state fetch
    if (context?.match_id) {
        promises.push(
            fetchLiveState(context.match_id).then(({ ok, data }) => {
                if (ok && data) {
                    packet.liveState = {
                        score: { home: data.home_score, away: data.away_score },
                        clock: data.display_clock,
                        period: data.period,
                        status: data.game_status,
                        odds: data.odds
                    };
                    packet.temporal.t60 = data.t60_snapshot;
                    packet.temporal.t0 = data.t0_snapshot;

                    // Calculate line movement with corrected sign logic
                    if (data.odds && data.t60_snapshot) {
                        packet.lineMovement = calculateLineMovement(data.odds, data.t60_snapshot);
                    }
                }
            })
        );
    }

    await Promise.allSettled(promises);
    return packet;
}

// =============================================================================
// STRUCTURAL ANALYSIS
// =============================================================================

/**
 * Build claim map from AI response for confluence evaluation.
 * Enhanced regex handles markdown formatting.
 * @param {string} response - AI response text
 * @param {string} thoughts - AI thinking text
 * @returns {object}
 */
function buildClaimMap(response, thoughts) {
    const combinedText = (response + " " + thoughts).toLowerCase();

    const map = {
        verdict: null,
        confidence: "medium",
        confluence: {
            price: false,
            sentiment: false,
            structure: false
        }
    };

    // Enhanced regex: handles **VERDICT:** markdown syntax
    const verdictPatterns = [
        /\*\*verdict[:\s*]*\*\*\s*(.+?)(?:\n|$)/i,     // **VERDICT:** text
        /verdict[:\s*]+\*\*(.+?)\*\*/i,                 // VERDICT: **text**
        /verdict[:\s*]+(.+?)(?:\n|$)/i                  // VERDICT: text
    ];

    for (const pattern of verdictPatterns) {
        const match = response.match(pattern);
        if (match) {
            const extracted = match[1].trim().replace(/\*+/g, "").trim();
            map.verdict = extracted.toLowerCase().includes("pass") ? "PASS" : extracted;
            break;
        }
    }

    // Confidence detection
    if (combinedText.includes("high confidence") || combinedText.includes("confidence: high") || combinedText.includes("(high)")) {
        map.confidence = "high";
    } else if (combinedText.includes("low confidence") || combinedText.includes("confidence: low") || combinedText.includes("(low)")) {
        map.confidence = "low";
    }

    // Confluence signal detection
    map.confluence.price = /(market|price|clv|delta|line move|steam|reverse|closing)/i.test(combinedText);
    map.confluence.sentiment = /(sentiment|sharp|public|split|money|ticket|fade|action)/i.test(combinedText);
    map.confluence.structure = /(structural|injury|rotation|rest|b2b|travel|revenge|matchup)/i.test(combinedText);

    return map;
}

/**
 * Gate decision based on confluence score.
 * RESTORED: Requires score >= 2 for strict quality filtering.
 * @param {object} map - Claim map
 * @param {boolean} strict - Whether to enforce minimum confluence
 * @returns {{approved: boolean, reason: string, score: number}}
 */
function gateDecision(map, strict) {
    const score = Object.values(map.confluence).filter(Boolean).length;

    if (map.verdict === "PASS") {
        return { approved: true, reason: "INTENTIONAL_PASS", score };
    }

    // RESTORED: Require 2+ confluence factors for approval
    if (strict && score < 2) {
        return { approved: false, reason: `WEAK_CONFLUENCE (${score}/3)`, score };
    }

    return { approved: true, reason: "APPROVED", score };
}

// =============================================================================
// PICK EXTRACTION & PERSISTENCE
// =============================================================================

/**
 * Extract structured pick from AI response using Gemini.
 * @param {string} text - AI response containing verdict
 * @param {object} context - Game context
 * @returns {Promise<object[]>}
 */
async function extractPickStructured(text, context) {
    if (!context || !context.home_team || !context.away_team) return [];

    const extractionPrompt = `
GAME CONTEXT:
- Home Team: "${context.home_team}"
- Away Team: "${context.away_team}"
- League: ${context.league || "Unknown"}

TASK: Extract the betting verdict from the analysis below.

STRICT RULES:
1. "pick_team" MUST exactly match one of: "${context.home_team}" or "${context.away_team}" (use null for Totals only)
2. If verdict is "PASS" or "NO BET", set verdict="PASS"
3. For Totals: pick_type="total", pick_direction="over" or "under"
4. For Spreads: pick_type="spread", pick_team=team name, pick_line=spread value
5. For Moneyline: pick_type="moneyline", pick_team=team name

ANALYSIS TEXT:
${text}
`;

    try {
        const { object } = await generateObject({
            model: google(CONFIG.MODEL_ID),
            schema: BettingPickSchema,
            prompt: extractionPrompt,
            mode: "json"
        });

        // Validate and normalize team names
        if (object.verdict === "BET" || object.verdict === "FADE") {
            if (object.pick_type !== "total" && object.pick_team) {
                const pickNorm = (object.pick_team || "").toLowerCase().replace(/[^a-z]/g, "");
                const homeNorm = (context.home_team || "").toLowerCase().replace(/[^a-z]/g, "");
                const awayNorm = (context.away_team || "").toLowerCase().replace(/[^a-z]/g, "");

                let matchedTeam = null;

                if (pickNorm.includes(homeNorm) || homeNorm.includes(pickNorm)) {
                    matchedTeam = context.home_team;
                } else if (pickNorm.includes(awayNorm) || awayNorm.includes(pickNorm)) {
                    matchedTeam = context.away_team;
                }

                if (matchedTeam) {
                    object.pick_team = matchedTeam;
                } else if (!object.pick_team) {
                    console.warn("[Pick Extraction] Could not normalize team:", object.pick_team);
                    return [];
                }
            }
        }

        return [object];
    } catch (e) {
        console.error("[Pick Extraction] Failed:", e.message);
        return [];
    }
}

/**
 * Persist AI chat run and extracted picks to database.
 */
async function persistRun(runId, map, gate, context, convoId, modelId, groundingMetadata) {
    try {
        // Build provenance: store groundingSupports for audit trail
        const grounding = groundingMetadata ? {
            chunk_count: groundingMetadata.groundingChunks?.length || 0,
            support_count: groundingMetadata.groundingSupports?.length || 0,
            sources: (groundingMetadata.groundingChunks || [])
                .map(c => c.web?.uri).filter(Boolean).slice(0, 10),
            supports: (groundingMetadata.groundingSupports || [])
                .map(s => ({
                    text: s.segment?.text?.slice(0, 100),
                    chunks: s.groundingChunkIndices
                })).slice(0, 20)
        } : null;

        // Upsert run record
        await supabase.from("ai_chat_runs").upsert(
            {
                id: runId,
                conversation_id: convoId,
                confluence_met: gate.approved,
                confluence_score: gate.score,
                verdict: map.verdict,
                confidence: map.confidence,
                gate_reason: gate.reason,
                match_context: context
                    ? { id: context.match_id, home: context.home_team, away: context.away_team }
                    : null,
                grounding_provenance: grounding
            },
            { onConflict: "id" }
        );

        // Extract and persist picks if approved
        if (gate.approved && map.verdict && map.verdict !== "PASS") {
            const structuralPicks = await extractPickStructured(map.verdict, context);

            if (structuralPicks.length > 0) {
                const pickRecords = structuralPicks.map((p) => {
                    let side = p.pick_team;
                    if (p.pick_type === "total") {
                        side = p.pick_direction ? p.pick_direction.toUpperCase() : "UNKNOWN";
                    }

                    return {
                        run_id: runId,
                        conversation_id: convoId,
                        match_id: context?.match_id,
                        home_team: context?.home_team,
                        away_team: context?.away_team,
                        league: context?.league,
                        game_start_time: context?.start_time || context?.game_start_time,
                        pick_type: p.pick_type,
                        pick_side: side,
                        pick_line: p.pick_line,
                        ai_confidence: p.confidence || map.confidence,
                        model_id: modelId,
                        reasoning_summary: p.reasoning_summary,
                        extraction_method: "structured_v26_enhanced"
                    };
                });

                await supabase.from("ai_chat_picks").insert(pickRecords);
            }
        }
    } catch (e) {
        console.error("[Persist Run] Failed:", e.message);
    }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { messages, session_id, conversation_id, gameContext, run_id } = req.body;
        const currentRunId = run_id || crypto.randomUUID();

        // Initialize context
        let activeContext = gameContext || {};
        const lastMsg = messages[messages.length - 1];
        const userQuery = typeof lastMsg.content === "string" ? lastMsg.content : "";
        const hasImage = Array.isArray(lastMsg.content) && lastMsg.content.some((c) => c.type === "image");

        const MODE = detectMode(userQuery, hasImage);

        // --- LIVE SENTINEL CHECK ---
        const liveScan = await scanForLiveGame(userQuery);
        let isLive = false;

        if (liveScan.ok) {
            const liveData = liveScan.data;
            activeContext = {
                ...activeContext,
                ...liveData,
                match_id: liveData.id,
                clock: liveData.display_clock,
                status: liveData.game_status,
                current_odds: liveData.odds
            };
            isLive = true;
        }

        isLive = isLive || (activeContext?.status || "").toUpperCase().includes("IN_PROGRESS");

        // --- BUILD EVIDENCE PACKET ---
        const evidence = await buildEvidencePacket(activeContext);

        if (evidence.liveState) {
            activeContext = {
                ...activeContext,
                ...evidence.liveState,
                current_odds: evidence.liveState.odds
            };
        }

        // Determine market phase
        const marketPhase = getMarketPhase(activeContext);

        // Format line movement for prompt
        let lineMovementIntel = "";
        if (evidence.lineMovement?.available && evidence.lineMovement.movements?.length > 0) {
            lineMovementIntel = evidence.lineMovement.movements
                .map((m) => `${m.signal} ${m.type}: ${m.direction} ${m.delta}pts`)
                .join(" | ");
        }

        // Stale context warning
        const staleWarning = isContextStale(activeContext)
            ? "\n⚠️ DATA WARNING: Context may be stale. Verify with Search."
            : "";

        // Build HMAC-signed live data URLs for URL Context grounding
        const liveDataUrls = [];
        if (activeContext?.match_id) {
            const origin = getPublicOrigin();
            const gid = encodeURIComponent(activeContext.match_id);
            const scoreSlug = generateSatelliteSlug(activeContext.match_id, "scores");
            const oddsSlug = generateSatelliteSlug(activeContext.match_id, "odds");
            const pbpSlug = generateSatelliteSlug(activeContext.match_id, "pbp");
            liveDataUrls.push(
                `${origin}/api/live/scores/${scoreSlug}?g=${gid}`,
                `${origin}/api/live/odds/${oddsSlug}?g=${gid}`,
                `${origin}/api/live/pbp/${pbpSlug}?g=${gid}`
            );
        }

        // --- SYSTEM PROMPT: VERDICT FIRST + ENTITY FIREWALL (SOFTENED) ---
        const systemInstruction = `
<temporal>
TODAY: ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}
TIME: ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET
MARKET_PHASE: ${marketPhase}
MODE: ${MODE}
</temporal>

<context>
${[
    `MATCHUP: ${activeContext?.away_team || "TBD"} @ ${activeContext?.home_team || "TBD"}`,
    isLive ? `🔴 LIVE: ${activeContext?.away_score || 0}-${activeContext?.home_score || 0} | ${activeContext?.clock || ""}` : "",
    ...(liveDataUrls.length > 0 ? [
        `LIVE_DATA_URLS: ${liveDataUrls.join(", ")}`,
        "(These endpoints serve real-time scores, odds, and play-by-play. Fetch them via URL Context for authoritative data.)"
    ] : [
        `ODDS: ${safeJsonStringify(activeContext?.current_odds, 600)}`,
        lineMovementIntel ? `LINE_MOVEMENT: ${lineMovementIntel}` : "",
        `INJURIES_HOME: ${safeJsonStringify(evidence.injuries.home, 400)}`,
        `INJURIES_AWAY: ${safeJsonStringify(evidence.injuries.away, 400)}`,
        evidence.temporal.t60 ? `T-60_ODDS: ${safeJsonStringify(evidence.temporal.t60.odds, 300)}` : ""
    ]),
    staleWarning
].filter(Boolean).join("\n")}
</context>

<prime_directive>
You are "The Obsidian Ledger," a forensic sports analyst.

**RULE 1 (ENTITY FIREWALL - STATUS CLAIMS ONLY):**
- For **injury/availability/status claims**, you MUST verify via grounded search.
- **FALLBACK:** If you cannot verify a player's STATUS (playing, doubtful, out), use their role (e.g., "The starting PG", "The backup center") instead of their name.
- **NO GUESSING on injury/availability.**

**RULE 2 (SOURCE AUTHORITY):**
- For live scores, odds, and play-by-play: use the data from the provided live endpoint URLs. These are real-time authenticated feeds refreshed every 15-30 seconds.
- For narratives, trends, injury context, and historical performance: use Google Search.
- If a web search result conflicts with the live endpoint data on score, odds, or play-by-play, the live endpoint is authoritative.

**RULE 3 (ZERO HALLUCINATION):**
- You have NO internal knowledge of today's specific lines, scores, or results.
- **MANDATORY:** Use grounded tools to verify current event claims.
- Do NOT output bracket citation tokens like [1] or [1.x]. Citations are handled automatically by the grounding system.

**RULE 4 (MATCHUP LINE - DATE/TIME):**
- For each pick, output a MATCHUP line that includes matchup + date + time + timezone.
- You MUST ground the date/time via tools. If not grounded, write "Time TBD" (do NOT guess).
</prime_directive>

${MODE === "ANALYSIS" ? `
<mode_analysis>
**OUTPUT FORMAT (STRICT - VERDICT FIRST):**

**MATCHUP:** [Away] vs [Home] — [Month Day, Time TZ or "Time TBD"]
**VERDICT:** [Team/Side] [Line/Price] ([Confidence: High/Med/Low])

**THE EDGE**
(2-3 sentences max. State the market inefficiency directly. No hedging.)

**KEY FACTORS**
- [Factor 1]
- [Factor 2]
- [Factor 3]

**MARKET DYNAMICS**
(Line movement direction, opening vs current, sharp vs public splits.)

**WHAT TO WATCH LIVE**
IF [Trigger Condition] → THEN [Action/Adjustment]

**STYLE RULES:**
- HEADERS: ALL CAPS with colons.
- Be ASSERTIVE. No "I think" or "It seems".
- Verdict must include exact line/price when available.
- No labeled bullets. Do: "- The team has won 8 of 10 at home." Don't: "- **Home Dominance:** The team has won 8 of 10 at home."
</mode_analysis>
` : `
<mode_conversation>
Role: Field Reporter. Direct, factual, concise.
- Answer the question directly.
- Keep responses focused and efficient.
- Do NOT output bracket citation tokens. Citations are handled automatically.
</mode_conversation>
`}
`;

        // --- BUILD GEMINI HISTORY ---
        // Append live data URLs to the final user message so URL Context fetches them.
        const geminiHistory = messages.map((m, i) => {
            let text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            if (i === messages.length - 1 && m.role === "user" && liveDataUrls.length > 0) {
                text += `\n\nLive data sources:\n${liveDataUrls.join("\n")}`;
            }
            return {
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text }]
            };
        });

        // --- STREAM RESPONSE ---
        const result = await genAI.models.generateContentStream({
            model: CONFIG.MODEL_ID,
            contents: geminiHistory.slice(-8),
            config: {
                systemInstruction: { parts: [{ text: systemInstruction }] },
                thinkingConfig: CONFIG.THINKING_CONFIG,
                tools: CONFIG.TOOLS
            }
        });

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        let fullText = "";
        let rawThoughts = "";
        let finalMetadata = null;

        for await (const chunk of result) {
            // Capture grounding metadata
            if (chunk.candidates?.[0]?.groundingMetadata) {
                finalMetadata = chunk.candidates[0].groundingMetadata;
                res.write(`data: ${JSON.stringify({ type: "grounding", metadata: finalMetadata })}\n\n`);
            }

            // FIX: Iterate ALL parts in the chunk (prevents data loss)
            const parts = chunk.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                if (part.text) {
                    if (part.thought) {
                        rawThoughts += part.text;
                        res.write(`data: ${JSON.stringify({ type: "thought", content: part.text })}\n\n`);
                    } else {
                        fullText += part.text;
                        res.write(`data: ${JSON.stringify({ type: "text", content: part.text })}\n\n`);
                    }
                }
            }
        }

        // --- GROUNDING DIAGNOSTIC ---
        if (finalMetadata) {
            const chunkCount = finalMetadata.groundingChunks?.length || 0;
            const supportCount = finalMetadata.groundingSupports?.length || 0;
            console.log(`[Grounding] chunks=${chunkCount} supports=${supportCount}`);
        }

        // --- POST-RUN PROCESSING ---
        if (MODE === "ANALYSIS") {
            const map = buildClaimMap(fullText, rawThoughts);
            const gate = gateDecision(map, true);  // Strict mode with score >= 2
            await persistRun(currentRunId, map, gate, activeContext, conversation_id, CONFIG.MODEL_ID, finalMetadata);
        }

        // --- PERSIST CONVERSATION ---
        if (conversation_id) {
            const sources = finalMetadata?.groundingChunks
                ?.map((c) => ({ title: c.web?.title, uri: c.web?.uri }))
                .filter((s) => s.uri) || [];

            await supabase.from("conversations").update({
                messages: [
                    ...messages,
                    {
                        role: "assistant",
                        content: fullText,
                        thoughts: rawThoughts,
                        groundingMetadata: finalMetadata,
                        sources,
                        model: CONFIG.MODEL_ID
                    }
                ].slice(-40),
                last_message_at: new Date().toISOString()
            }).eq("id", conversation_id);
        }

        res.write(`data: ${JSON.stringify({ done: true, model: CONFIG.MODEL_ID })}\n\n`);
        res.end();

    } catch (e) {
        console.error("[Chat Handler] Error:", e);
        res.write(`data: ${JSON.stringify({ type: "error", content: e.message })}\n\n`);
        res.end();
    }
}
