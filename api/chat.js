/* ============================================================================
   api/chat.js
   "Obsidian Citadel" — Production Backend (v29.0 Titanium Edition)

   Architecture: Vite + Vercel Serverless Functions (Web API Standard)
   Engine: Gemini 3.1 Pro Preview
   Protocol: Dual-Mode + Verdict First + Entity Firewall

   TITANIUM HARDENING (v29.0):
   ├─ SEC: Object-Injection mitigation (Strict String casting for DB IDs)
   ├─ SEC: Fixed Multimodal JSON Base64 crash (natively parses Vision objects)
   ├─ DATA: normalizeGeminiHistory strictly enforces alternating roles (Prevents 400s)
   ├─ DATA: Fixed Supabase silent failures (SDK doesn't throw automatically)
   ├─ DATA: structuredClone() on Cache prevents warm-container reference bleed
   ├─ PERF: Detailed Promise.allSettled rejection tracing for background tasks
   └─ PERF: Strict 3000ms AbortSignals on pre-stream Supabase TTFB reads
============================================================================ */

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { waitUntil } from "@vercel/functions";

import { BettingPickSchema } from "../lib/schemas/picks.js";
import { generateSatelliteSlug, isSatelliteConfigured } from "./lib/satellite.js";
import { checkRateLimit } from "./lib/rateLimit.js";
import { LruTtlCache } from "./lib/lruTtlCache.js";
import { buildNbaPromptContextBlock } from "./lib/nbaContextPolicy.js";

// Vercel Serverless timeout configuration (seconds)
export const maxDuration = 300;

// =============================================================================
// INITIALIZATION & CONFIGURATION
// =============================================================================

const CONFIG = Object.freeze({
    MODEL_ID: "gemini-3.1-pro-preview",
    THINKING_CONFIG: Object.freeze({ includeThoughts: true, thinkingLevel: "high" }),
    ANALYSIS_TRIGGERS: Object.freeze([
        "edge", "best bet", "should i bet", "picks", "prediction",
        "analyze", "analysis", "spread", "over", "under", "moneyline",
        "verdict", "play", "handicap", "sharp", "odds", "line",
        "lean", "lock", "parlay", "action", "value", "bet", "pick"
    ]),
    TOOLS: Object.freeze([{ googleSearch: {} }, { urlContext: {} }]),
    STALE_THRESHOLD_MS: 15 * 60 * 1000,
    INJURY_CACHE_TTL_MS: 5 * 60 * 1000,
    MAX_PAYLOAD_SIZE: 2 * 1024 * 1024,
    MAX_MESSAGES: 40,
    MAX_HISTORY: 8,
    MAX_MESSAGE_CHARS: 6000
});

// Pre-compiled regex for performance
const VERDICT_PATTERNS = Object.freeze([
    /\*\*verdict[:\s*]*\*\*\s*(.+?)(?:\n|$)/i,
    /verdict[:\s*]+\*\*(.+?)\*\*/i,
    /verdict[:\s*]+(.+?)(?:\n|$)/i
]);

const ANALYSIS_TRIGGER_RE = new RegExp(
    `\\b(${CONFIG.ANALYSIS_TRIGGERS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "i"
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Singleton TextEncoder (Memory + GC reduction)
const ENCODER = new TextEncoder();

const ENV = Object.freeze({
    GOOGLE_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
});

const genAI = ENV.GOOGLE_KEY ? new GoogleGenAI({ apiKey: ENV.GOOGLE_KEY }) : null;
const supabase = (ENV.SUPABASE_URL && ENV.SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// Bounded local memory cache survives Vite/Vercel warm node containers
const INJURY_CACHE = new LruTtlCache({
    maxEntries: Number(process.env.INJURY_CACHE_MAX_ENTRIES ?? 512),
    ttlMs: Number(process.env.INJURY_CACHE_TTL_MS ?? CONFIG.INJURY_CACHE_TTL_MS),
});

function getPublicOrigin() {
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return "http://localhost:3000";
}

// =============================================================================
// PURE UTILITIES
// =============================================================================

const isValidUUID = (id) => typeof id === "string" && UUID_RE.test(id);

const safeJsonStringify = (obj, maxLen = 1200) => {
    try {
        if (obj === null || obj === undefined) return "";
        const str = JSON.stringify(obj);
        return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
    } catch {
        return "[Unparseable Payload]";
    }
};

const truncateText = (text, maxLen = CONFIG.MAX_MESSAGE_CHARS) => {
    if (!text) return "";
    return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
};

const detectMode = (query, hasImage) => {
    if (hasImage) return "ANALYSIS";
    if (!query) return "CONVERSATION";
    return ANALYSIS_TRIGGER_RE.test(query) ? "ANALYSIS" : "CONVERSATION";
};

const normalizeOddsNumber = (val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === "number" && Number.isFinite(val)) return val;
    if (typeof val === "string") {
        const cleaned = val.replace(/[^\d.+-]/g, "");
        if (!cleaned || cleaned === "+" || cleaned === "-") return null;
        const num = Number(cleaned);
        return Number.isFinite(num) ? num : null;
    }
    return null;
};

const getMarketPhase = (match) => {
    if (!match) return "UNKNOWN";
    const status = (match.status || match.game_status || "").toUpperCase();

    if (status.includes("IN_PROGRESS") || status.includes("LIVE") || status.includes("HALFTIME")) return `🔴 LIVE_IN_PLAY [${match.clock || match.display_clock || "Active"}]`;
    if (status.includes("FINAL") || status.includes("FINISHED") || status.includes("COMPLETE")) return "🏁 FINAL_SCORE";

    if (match.start_time) {
        const hoursUntilStart = (new Date(match.start_time).getTime() - Date.now()) / 3.6e6;
        if (hoursUntilStart < 0 && hoursUntilStart > -4) return "🔴 LIVE_IN_PLAY (Inferred)";
        if (hoursUntilStart <= -4) return "🏁 FINAL_SCORE";
        if (hoursUntilStart < 1) return "⚡ CLOSING_LINE";
        if (hoursUntilStart < 6) return "🎯 SHARP_WINDOW";
        if (hoursUntilStart < 24) return "🌊 DAY_OF_GAME";
    }
    return "🔭 OPENING_MARKET";
};

const isContextStale = (context) => {
    if (!context?.start_time) return false;
    const gameStart = new Date(context.start_time);
    if (Number.isNaN(gameStart.getTime())) return false;

    const status = (context.status || context.game_status || "").toUpperCase();
    const activeStatuses = ["IN_PROGRESS", "LIVE", "HALFTIME", "FINAL", "FINISHED"];

    return (Date.now() - gameStart.getTime()) > CONFIG.STALE_THRESHOLD_MS && !activeStatuses.some(s => status.includes(s));
};

const calculateLineMovement = (currentOdds, t60Snapshot) => {
    if (!currentOdds || !t60Snapshot?.odds) return { available: false, signal: null };

    const currentSpread = normalizeOddsNumber(currentOdds.spread);
    const openingSpread = normalizeOddsNumber(t60Snapshot.odds.spread);
    const currentTotal = normalizeOddsNumber(currentOdds.total);
    const openingTotal = normalizeOddsNumber(t60Snapshot.odds.total);
    const movements = [];

    if (currentSpread !== null && openingSpread !== null) {
        const spreadDelta = currentSpread - openingSpread;
        if (Math.abs(spreadDelta) >= 0.5) {
            movements.push({
                type: "SPREAD", delta: Math.abs(spreadDelta).toFixed(1),
                direction: spreadDelta < 0 ? "HOME" : "AWAY",
                signal: Math.abs(spreadDelta) >= 1.5 ? "🚨 SHARP_STEAM" : "📊 LINE_MOVE"
            });
        }
    }

    if (currentTotal !== null && openingTotal !== null) {
        const totalDelta = currentTotal - openingTotal;
        if (Math.abs(totalDelta) >= 1) {
            movements.push({
                type: "TOTAL", delta: Math.abs(totalDelta).toFixed(1),
                direction: totalDelta > 0 ? "UP" : "DOWN",
                signal: Math.abs(totalDelta) >= 2.5 ? "🚨 SHARP_STEAM" : "📊 LINE_MOVE"
            });
        }
    }

    if (movements.length === 0) return { available: true, signal: "STABLE_MARKET", movements: [] };

    return {
        available: true, movements,
        signal: movements.some(m => m.signal === "🚨 SHARP_STEAM") ? "SHARP_ACTION_DETECTED" : "MODERATE_MOVEMENT"
    };
};

const classifyQuestionType = (query) => {
    const q = (query || "").toLowerCase();
    if (/(power play|powerplay|penalt(?:y|ies)|last penalty|penalty summary)/i.test(q)) return "power_play";
    if (/(top scorer|most points|points leader|who scored)/i.test(q)) return "top_scorer";
    if (/(rebounds|rebounding leader)/i.test(q)) return "rebounds";
    if (/(assists|assist leader)/i.test(q)) return "assists";
    if (/(line|odds|spread|total|moneyline|ml)/i.test(q)) return "market";
    if (/(last play|recent plays|events|what happened)/i.test(q)) return "events";
    return "general";
};

const QUALITY_FAILURE_CODES = Object.freeze({
    OK: "OK",
    STALE_CONFIDENT_ANSWER: "F1_STALE_CONFIDENT_ANSWER",
    PARTIAL_PACKET_OVERREACH: "F2_PARTIAL_PACKET_OVERREACH",
    SNAPSHOT_AS_TRANSITION: "F3_SNAPSHOT_AS_TRANSITION",
    CAUSAL_WITHOUT_EXECUTION: "F4_CAUSAL_WITHOUT_EXECUTION",
    SILENT_FALLBACK: "F5_SILENT_FALLBACK",
    PACKET_BYPASS: "F6_PACKET_BYPASS",
});

const LIVE_QUESTION_TYPES = new Set(["power_play", "top_scorer", "rebounds", "assists", "events", "market"]);
const PACKET_STALE_THRESHOLD_SECONDS = 60;

const RESPONSE_CLASSES = Object.freeze({
    FACT: "fact",
    STATE: "state",
    EDGE: "edge",
});

const EDGE_INTENT_RE = /\b(best bet|bet|tail|fade|edge|value|play|take|lean|lock|odds edge|mispriced|over\/under|moneyline)\b/i;

const PENALTY_TERMS = [
    "power play",
    "penalty",
    "high-sticking",
    "tripping",
    "hooking",
    "slashing",
    "cross-checking",
    "interference",
    "roughing",
    "holding",
    "boarding",
    "charging",
    "elbowing",
    "too many men",
    "delay of game",
];

const toFactLine = (value, max = 120) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const getPacketEvents = (packet) => (
    Array.isArray(packet?.events)
        ? packet.events.filter((event) => event && typeof event === "object")
        : []
);

const isPenaltyLikeEvent = (event) => {
    const haystack = `${event?.type || ""} ${event?.text || ""}`.toLowerCase();
    return PENALTY_TERMS.some((term) => haystack.includes(term));
};

const buildDeterministicFactAnswer = ({ questionType, userQuery, trustedPacket }) => {
    if (!trustedPacket || typeof trustedPacket !== "object" || trustedPacket.error) return null;
    const events = getPacketEvents(trustedPacket);
    if (!events.length) return null;

    const q = (userQuery || "").toLowerCase();

    if (questionType === "power_play" || /power play|penalt(?:y|ies)/i.test(q)) {
        const penaltyEvents = events.filter(isPenaltyLikeEvent);
        if (!penaltyEvents.length) return null;

        const latest = penaltyEvents[penaltyEvents.length - 1];
        const recent = penaltyEvents.slice(-3).reverse();
        const latestLine = `Last power-play event: ${latest?.t || "N/A"} — ${toFactLine(latest?.text)}`;
        if (recent.length === 1) return latestLine;

        return [
            latestLine,
            "",
            "Recent penalties:",
            ...recent.map((event) => `- ${event?.t || "N/A"} — ${toFactLine(event?.text)}`),
        ].join("\n");
    }

    if (questionType === "events" || /last play|what happened|recent plays/i.test(q)) {
        const latest = events[events.length - 1];
        if (!latest?.text) return null;
        return `Latest event: ${latest?.t || "N/A"} — ${toFactLine(latest?.text)}`;
    }

    return null;
};

const classifyResponseClass = ({ questionType, userQuery }) => {
    if (["power_play", "top_scorer", "rebounds", "assists", "events"].includes(questionType)) {
        return RESPONSE_CLASSES.FACT;
    }
    if (questionType === "market") {
        return EDGE_INTENT_RE.test(userQuery || "") ? RESPONSE_CLASSES.EDGE : RESPONSE_CLASSES.STATE;
    }
    return EDGE_INTENT_RE.test(userQuery || "") ? RESPONSE_CLASSES.EDGE : RESPONSE_CLASSES.STATE;
};

const getRequiredAnswerabilityKeys = (questionType) => {
    switch (questionType) {
        case "power_play":
            return ["can_answer_recent_events"];
        case "top_scorer":
            return ["can_answer_top_scorer"];
        case "rebounds":
            return ["can_answer_rebounds_leader"];
        case "assists":
            return ["can_answer_assists_leader"];
        case "events":
            return ["can_answer_recent_events"];
        case "market":
            return ["can_answer_market_movement"];
        default:
            return ["can_answer_scoreboard"];
    }
};

const deriveInferenceMode = (packet) => {
    const hasTransitionEvidence = Number.isFinite(packet?.market_structure?.trigger_window?.corridor_width_points)
        || Number.isFinite(packet?.market_structure?.clob_repricing?.delta_open_to_latest);
    return hasTransitionEvidence ? "transition_grounded" : "snapshot_only";
};

const getGuardrailMessage = ({ failureCode, questionType, missingKeys = [], freshnessSeconds = null }) => {
    switch (failureCode) {
        case QUALITY_FAILURE_CODES.PACKET_BYPASS:
            return "Live context is not available right now. I cannot answer this safely until the trusted match packet is back.";
        case QUALITY_FAILURE_CODES.STALE_CONFIDENT_ANSWER:
            return `Live packet is stale (${freshnessSeconds ?? "unknown"}s old). I can only provide limited context until freshness recovers.`;
        case QUALITY_FAILURE_CODES.PARTIAL_PACKET_OVERREACH: {
            if (questionType === "top_scorer") return "Live scorer feed not available yet.";
            if (questionType === "rebounds") return "Live rebound leader feed not available yet.";
            if (questionType === "assists") return "Live assist leader feed not available yet.";
            if (questionType === "events") return "Recent live event feed not available yet.";
            if (questionType === "market") return "Live line-movement feed not available yet.";
            return `Required live fields are missing: ${missingKeys.join(", ") || "unknown"}.`;
        }
        default:
            return "Live data quality guard triggered. I can only give limited context right now.";
    }
};

const getSeverityForFailureCode = (failureCode) => {
    if ([QUALITY_FAILURE_CODES.STALE_CONFIDENT_ANSWER, QUALITY_FAILURE_CODES.PACKET_BYPASS].includes(failureCode)) return "S0";
    if ([QUALITY_FAILURE_CODES.PARTIAL_PACKET_OVERREACH, QUALITY_FAILURE_CODES.SNAPSHOT_AS_TRANSITION, QUALITY_FAILURE_CODES.CAUSAL_WITHOUT_EXECUTION, QUALITY_FAILURE_CODES.SILENT_FALLBACK].includes(failureCode)) return "S1";
    return "S2";
};

async function logResponseQualityGuard({
    matchId = null,
    questionType = "general",
    failureCode = QUALITY_FAILURE_CODES.OK,
    missingFields = [],
    freshnessSeconds = null,
    inferenceMode = "snapshot_only",
    isLiveIntent = false,
    requiresPacket = false,
    reason = null,
}) {
    if (!supabase) return;
    try {
        await supabase.from("ai_tool_logs").insert({
            tool_name: "response_guard",
            match_id: matchId ? String(matchId) : null,
            question_type: questionType,
            packet_freshness_seconds: Number.isFinite(freshnessSeconds) ? Number(freshnessSeconds) : null,
            missing_fields: Array.isArray(missingFields) ? missingFields : [],
            success: failureCode === QUALITY_FAILURE_CODES.OK,
            error: failureCode === QUALITY_FAILURE_CODES.OK ? null : failureCode,
            meta: {
                failure_code: failureCode,
                severity: getSeverityForFailureCode(failureCode),
                inference_mode: inferenceMode,
                is_live_intent: Boolean(isLiveIntent),
                requires_packet: Boolean(requiresPacket),
                route: "api/chat",
                reason: reason || null,
            },
        });
    } catch (logErr) {
        console.warn("[QualityGuard] log insert failed:", logErr?.message || logErr);
    }
}

const extractEvidenceLinesFromPacket = (packet) => {
    const lines = [];
    if (!packet || typeof packet !== "object") return lines;

    const away = packet?.match?.away_team || "Away";
    const home = packet?.match?.home_team || "Home";
    const awayScore = packet?.scoreboard?.away;
    const homeScore = packet?.scoreboard?.home;
    const clock = packet?.scoreboard?.clock || "N/A";

    if (Number.isFinite(awayScore) && Number.isFinite(homeScore)) {
        lines.push(`${away} ${awayScore} - ${homeScore} ${home} (${clock})`);
    }

    const move = packet?.market?.movement_total;
    if (Number.isFinite(move)) {
        const sign = move > 0 ? "+" : "";
        lines.push(
            `Total movement: ${sign}${Number(move).toFixed(1)} (open ${packet?.market?.open_total ?? "—"} -> live ${packet?.market?.live_total ?? "—"})`,
        );
    }

    const corridorWidth = packet?.market_structure?.trigger_window?.corridor_width_points;
    if (Number.isFinite(corridorWidth)) {
        lines.push(`Live corridor: ${Number(corridorWidth).toFixed(1)} points at trigger`);
    } else {
        const clobDelta = packet?.market_structure?.clob_repricing?.delta_open_to_latest;
        if (Number.isFinite(clobDelta)) {
            const sign = clobDelta > 0 ? "+" : "";
            lines.push(`Market repricing: ${sign}${Number(clobDelta).toFixed(3)} vs open probability`);
        }
    }

    if (Array.isArray(packet?.events) && packet.events.length > 0) {
        const latestEvent = packet.events[packet.events.length - 1];
        if (latestEvent?.text) {
            lines.push(`Latest event: ${latestEvent.t || "N/A"} ${latestEvent.text}`);
        }
    }

    if (Array.isArray(packet?.trends) && packet.trends.length > 0) {
        const trend = packet.trends[0];
        lines.push(`Trend: ${trend?.label || "Signal"} — ${trend?.value || "Active"}`);
    }

    return lines.slice(0, 3);
};

const buildTrustedPacketContextBlock = (packet) => {
    if (!packet || typeof packet !== "object" || packet.error) {
        return "TRUSTED_MATCH_PACKET: unavailable";
    }

    const answerability = packet.answerability || {};
    const inferenceMode = deriveInferenceMode(packet);
    const answerabilityLine = Object.entries(answerability)
        .map(([key, value]) => `${key}:${value ? "yes" : "no"}`)
        .join(" | ");

    const eventLines = Array.isArray(packet.events)
        ? packet.events.slice(-3).map((e) => `- ${e?.t || "N/A"} ${e?.text || ""}`).join("\n")
        : "- none";

    const trendLines = Array.isArray(packet.trends)
        ? packet.trends.slice(0, 3).map((t) => `- ${t?.label || "Signal"}: ${t?.value || "Active"}`).join("\n")
        : "- none";

    return `
TRUSTED_MATCH_PACKET (SYSTEM OF RECORD):
- Match: ${packet?.match?.away_team || "Away"} @ ${packet?.match?.home_team || "Home"} [${packet?.match?.id || "unknown"}]
- Scoreboard: ${packet?.scoreboard?.away ?? "N/A"}-${packet?.scoreboard?.home ?? "N/A"} | Clock ${packet?.scoreboard?.clock || "N/A"} | Period ${packet?.scoreboard?.period ?? "N/A"} | Status ${packet?.scoreboard?.status || "N/A"}
- Market: Live Total ${packet?.market?.live_total ?? "N/A"} | Open Total ${packet?.market?.open_total ?? "N/A"} | Movement ${packet?.market?.movement_total ?? "N/A"}
- Market Structure: Corridor ${packet?.market_structure?.trigger_window?.corridor_width_points ?? "N/A"} | Kalshi Delta ${packet?.market_structure?.clob_repricing?.delta_open_to_latest ?? "N/A"}
- Inference Mode: ${inferenceMode}
- Leaders available: ${answerabilityLine || "none"}
- Packet as_of: ${packet?.packet_meta?.as_of || "N/A"} | freshness_seconds: ${packet?.packet_meta?.freshness_seconds ?? "N/A"}
RECENT EVENTS:
${eventLines}
TRENDS / INTEL:
${trendLines}
`.trim();
};

async function fetchTrustedMatchPacket(matchId, questionType = "general") {
    if (!supabase || !matchId) return null;
    try {
        const started = Date.now();
        const maxEvents = ["power_play", "events", "top_scorer", "rebounds", "assists"].includes(questionType)
            ? 25
            : 10;
        const { data, error } = await supabase
            .rpc("get_ai_match_packet", { p_match_id: String(matchId), p_max_events: maxEvents })
            .abortSignal(AbortSignal.timeout(3000));

        if (error || !data) {
            console.warn("[TrustedPacket] RPC failed:", error?.message || "no_data");
            try {
                await supabase.from("ai_tool_logs").insert({
                    tool_name: "get_live_context",
                    match_id: String(matchId),
                    question_type: questionType,
                    latency_ms: Date.now() - started,
                    packet_freshness_seconds: null,
                    missing_fields: ["trusted_packet_missing"],
                    success: false,
                    error: error?.message || "trusted_packet_missing",
                    meta: {
                        failure_code: QUALITY_FAILURE_CODES.PACKET_BYPASS,
                        route: "api/chat",
                    },
                });
            } catch (logErr) {
                console.warn("[TrustedPacket] error-log insert failed:", logErr?.message || logErr);
            }
            return null;
        }

        const packet = data;
        const answerability = packet?.answerability || {};
        const missingFields = Object.entries(answerability)
            .filter(([, canAnswer]) => canAnswer === false)
            .map(([k]) => k);

        const freshness = Number.isFinite(packet?.packet_meta?.freshness_seconds)
            ? packet.packet_meta.freshness_seconds
            : null;

        // Best-effort observability write (table may not exist in older envs)
        try {
            await supabase.from("ai_tool_logs").insert({
                tool_name: "get_live_context",
                match_id: String(matchId),
                question_type: questionType,
                latency_ms: Date.now() - started,
                packet_freshness_seconds: freshness,
                missing_fields: missingFields,
                success: true,
                meta: {
                    evidence_lines: extractEvidenceLinesFromPacket(packet).length,
                    packet_as_of: packet?.packet_meta?.as_of || null,
                },
            });
        } catch (logErr) {
            console.warn("[TrustedPacket] log insert failed:", logErr?.message || logErr);
        }

        return packet;
    } catch (err) {
        console.warn("[TrustedPacket] fetch error:", err?.message || err);
        try {
            await supabase.from("ai_tool_logs").insert({
                tool_name: "get_live_context",
                match_id: String(matchId),
                question_type: questionType,
                packet_freshness_seconds: null,
                missing_fields: ["trusted_packet_fetch_exception"],
                success: false,
                error: err?.message || "trusted_packet_fetch_exception",
                meta: {
                    failure_code: QUALITY_FAILURE_CODES.PACKET_BYPASS,
                    route: "api/chat",
                },
            });
        } catch (logErr) {
            console.warn("[TrustedPacket] catch-log insert failed:", logErr?.message || logErr);
        }
        return null;
    }
}

// =============================================================================
// NETWORK / IP HARDENING
// =============================================================================

const isValidIPv4 = (ip) => {
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
    return ip.split(".").every(n => Number(n) >= 0 && Number(n) <= 255);
};

const isValidIPv6 = (ip) => /^[0-9a-fA-F:]{2,39}$/.test(ip);

const isPrivateIp = (ip) => {
    if (!ip || ip === "::1") return true;
    if (isValidIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return true;
    }
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
    return false;
};

const getClientIp = (headers) => {
    // 🛡️ SEC: Vercel securely injects this, bypassing user-spoofable x-forwarded-for
    const vercelIp = headers.get("x-vercel-forwarded-for");
    if (vercelIp) return vercelIp.split(",")[0].trim();

    const candidates = [
        headers.get("x-forwarded-for"),
        headers.get("x-real-ip"),
        headers.get("cf-connecting-ip"),
    ].filter(Boolean);

    const valid = candidates
        .flatMap(v => String(v).split(","))
        .map(v => v.trim())
        .filter(ip => isValidIPv4(ip) || isValidIPv6(ip));

    return valid.find(ip => !isPrivateIp(ip)) || valid[0] || "127.0.0.1";
};

// =============================================================================
// PROMPT & MULTIMODAL BUILDERS
// =============================================================================

const buildStaticInstruction = (MODE) => `
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

**RULE 4 (TRUSTED MATCH PACKET):**
- The TRUSTED_MATCH_PACKET block is the primary source for score, clock, leaders, events, and line movement.
- If TRUSTED_MATCH_PACKET conflicts with web snippets, TRUSTED_MATCH_PACKET wins.
- If answerability.can_answer_top_scorer is false and the user asks top-scorer/most-points, reply: "Live scorer feed not available yet."
- Never say "access blocked", "unconfigured access", or "cannot verify due to endpoint access" for packet-backed questions.
- If TRUSTED_MATCH_PACKET says "Inference Mode: snapshot_only", do not claim transition-level causality. State that transition evidence is not available yet.

**RULE 5 (MATCHUP LINE - DATE/TIME):**
- For each pick, output a MATCHUP line that includes matchup + date + time + timezone.
- You MUST ground the date/time via tools. If not grounded, write "Time TBD" (do NOT guess).
</prime_directive>

${MODE === "ANALYSIS" ? `
<mode_analysis>
**OUTPUT FORMAT (STRICT - VERDICT FIRST):**

**MATCHUP:** [Away] vs [Home] — [Month Day, Time TZ or "Time TBD"]
**VERDICT:** [Team/Side] [Line/Price] ([Confidence: High/Med/Low])

**BETTING ANGLE**
(2-3 sentences max. Explain what changed in the game and why the current line matters. No hedging.)

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
`.trim();

const buildResponseClassDirective = (responseClass, questionType) => {
    if (responseClass === RESPONSE_CLASSES.FACT) {
        return `
<response_class_fact>
- Question type: ${questionType}
- Answer first, then stop. Maximum 2 short lines unless user asked for a list.
- No verdict labels, no betting recommendation language, no confidence labels.
- For power play / penalty questions, include exact most recent timestamp and event text.
- If additional detail is useful, add up to 3 bullet lines only.
</response_class_fact>
`.trim();
    }
    if (responseClass === RESPONSE_CLASSES.STATE) {
        return `
<response_class_state>
- Question type: ${questionType}
- Give a short game-state read in 1 sentence.
- Add 2-4 compact evidence bullets tied to score, clock, events, and movement.
- Do not use verdict labels, Tail/Fade language, or confidence percentages.
</response_class_state>
`.trim();
    }
    return `
<response_class_edge>
- This is a betting intent response. Use verdict-first structure with evidence.
</response_class_edge>
`.trim();
};

const buildDynamicInstruction = ({ marketPhase, MODE, responseClass, questionType, activeContext, isLive, liveDataUrls, evidence, lineMovementIntel, staleWarning, nbaProductContext, trustedPacket }) => {
    const now = new Date();
    const nbaContextBrief = buildNbaPromptContextBlock(nbaProductContext);
    const trustedPacketBlock = buildTrustedPacketContextBlock(trustedPacket);
    const responseDirective = buildResponseClassDirective(responseClass, questionType);
    return `
<temporal>
TODAY: ${now.toLocaleDateString("en-US", { timeZone: "America/New_York" })}
TIME: ${now.toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET
MARKET_PHASE: ${marketPhase}
MODE: ${MODE}
</temporal>

${responseDirective}

<context>
${[
            `MATCHUP: ${activeContext?.away_team || "TBD"} @ ${activeContext?.home_team || "TBD"}`,
            isLive ? `🔴 LIVE: ${activeContext?.away_score || 0}-${activeContext?.home_score || 0} | ${activeContext?.clock || ""}` : "",
            ...(liveDataUrls.length > 0
                ? [`LIVE_DATA_URLS: ${liveDataUrls.join(", ")}`, "(Fetch these endpoints via URL Context for authoritative real-time data)"]
                : ["LIVE_DATA_URLS: none provided for this request. Use snapshot and stats context only."]),
            `ODDS: ${safeJsonStringify(activeContext?.current_odds, 600)}`,
            lineMovementIntel ? `LINE_MOVEMENT: ${lineMovementIntel}` : "",
            `INJURIES_HOME: ${safeJsonStringify(evidence.injuries.home, 400)}`,
            `INJURIES_AWAY: ${safeJsonStringify(evidence.injuries.away, 400)}`,
            evidence.temporal?.t60 ? `T-60_ODDS: ${safeJsonStringify(evidence.temporal.t60.odds, 300)}` : "",
            trustedPacketBlock,
            nbaContextBrief ? nbaContextBrief : "",
            staleWarning
        ].filter(Boolean).join("\n")}
</context>
`.trim();
};

/** 🛡️ SEC: Safely structures Multimodal payloads to prevent Base64 stringification crash */
const extractVisionParts = (content) => {
    if (typeof content === "string") return [{ text: truncateText(content) }];
    if (Array.isArray(content)) {
        return content.map(c => {
            if (typeof c === "string") return { text: truncateText(c) };
            if (c.type === "text" || c.text) return { text: truncateText(c.text || "") };
            if (c.type === "image_url" && c.image_url?.url) {
                const match = c.image_url.url.match(/^data:(.*?);base64,(.*)$/);
                if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
            }
            if (c.inlineData) return c;
            return { text: "" };
        }).filter(p => p.text !== "" || p.inlineData);
    }
    return [{ text: truncateText(safeJsonStringify(content)) }];
};

/** 🛡️ DATA: Ensures message array strictly alternates (user -> model) to prevent Google 400 Errors */
const normalizeGeminiHistory = (messages, liveDataUrls) => {
    const raw = messages.map((m, i) => {
        const parts = extractVisionParts(m.content);
        if (i === messages.length - 1 && m.role === "user" && liveDataUrls.length > 0) {
            const textPart = parts.find(p => p.text !== undefined);
            if (textPart) textPart.text += `\n\nLive data sources:\n${liveDataUrls.join("\n")}`;
            else parts.push({ text: `Live data sources:\n${liveDataUrls.join("\n")}` });
        }
        return { role: m.role === "assistant" ? "model" : "user", parts };
    });

    const normalized = [];
    let expectedRole = "user";

    for (let i = raw.length - 1; i >= 0; i--) {
        if (raw[i].role === expectedRole) {
            normalized.unshift({ role: raw[i].role, parts: [...raw[i].parts] });
            expectedRole = expectedRole === "user" ? "model" : "user";
        } else if (raw[i].role === "user" && expectedRole === "model") {
            // Merge back-to-back user messages to preserve sequence integrity
            const currentTextParts = raw[i].parts.filter(p => p.text).map(p => p.text).join("\n");
            const targetTextPart = normalized[0].parts.find(p => p.text !== undefined);
            if (targetTextPart) {
                targetTextPart.text = currentTextParts + "\n\n" + targetTextPart.text;
            } else if (currentTextParts) {
                normalized[0].parts.unshift({ text: currentTextParts + "\n\n" });
            }
            const imageParts = raw[i].parts.filter(p => p.inlineData);
            if (imageParts.length > 0) normalized[0].parts.push(...imageParts);
        }
        if (normalized.length >= CONFIG.MAX_HISTORY) break;
    }

    // Google API requires the array to begin with a User message
    if (normalized.length > 0 && normalized[0].role === "model") normalized.shift();
    return normalized;
};

// =============================================================================
// DATA FETCHERS & STRUCTURAL ANALYSIS
// =============================================================================

async function scanForLiveGame(userQuery) {
    if (!userQuery) return { ok: false };
    const hints = userQuery.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4).sort((a, b) => b.length - a.length).slice(0, 3);
    if (!hints.length) return { ok: false };

    try {
        const orClauses = hints.map(h => `home_team.ilike.%${h}%,away_team.ilike.%${h}%`).join(",");
        const { data, error } = await supabase
            .from("live_game_state")
            .select("*")
            .in("game_status", ["IN_PROGRESS", "HALFTIME", "END_PERIOD", "LIVE"])
            .or(orClauses)
            .order("updated_at", { ascending: false })
            .limit(1)
            .abortSignal(AbortSignal.timeout(3000)); // 🛡️ PERF: TTFB Defense

        if (error) throw new Error(error.message);
        return data?.[0] ? { ok: true, data: data[0], isLiveOverride: true } : { ok: false };
    } catch (e) {
        console.error("[Live Sentinel] Scan failed:", e?.message || e);
        return { ok: false };
    }
}

async function fetchESPNInjuries(teamId, sportKey) {
    if (!teamId) return { injuries: [] };

    const cacheKey = `${sportKey}_${teamId}`;
    const cached = INJURY_CACHE.get(cacheKey);
    // 🛡️ DATA: structuredClone guarantees pristine memory isolation inside warm containers
    if (cached) return structuredClone({ ...cached, cached: true });

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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const injuries = (data.team?.injuries || [])
            .map(i => ({ name: i.athlete?.displayName, status: i.status?.toUpperCase(), position: i.athlete?.position?.abbreviation }))
            .filter(i => i.name && i.status).slice(0, 8);

        const result = { injuries };
        INJURY_CACHE.set(cacheKey, result);
        return structuredClone(result);
    } catch (e) {
        console.error(`[Injury Fetch] Failed for ${teamId}:`, e?.message || e);
        return { injuries: [] };
    }
}

async function buildEvidencePacket(context) {
    const packet = { injuries: { home: [], away: [] }, liveState: null, temporal: { t60: null, t0: null }, lineMovement: null };
    const promises = [];

    if (context?.home_team_id && context?.away_team_id) {
        promises.push(
            Promise.allSettled([
                fetchESPNInjuries(context.home_team_id, context.sport || context.league),
                fetchESPNInjuries(context.away_team_id, context.sport || context.league)
            ]).then(([homeRes, awayRes]) => {
                packet.injuries.home = homeRes.status === "fulfilled" ? (homeRes.value.injuries || []) : [];
                packet.injuries.away = awayRes.status === "fulfilled" ? (awayRes.value.injuries || []) : [];
            })
        );
    }

    if (context?.match_id) {
        promises.push(
            supabase.from("live_game_state")
                .select("*")
                .eq("id", String(context.match_id))
                .maybeSingle()
                .abortSignal(AbortSignal.timeout(3000)) // 🛡️ PERF: TTFB Defense
                .then(({ data, error }) => {
                    if (error) throw new Error(error.message);
                    if (data) {
                        packet.liveState = { score: { home: data.home_score, away: data.away_score }, clock: data.display_clock, period: data.period, status: data.game_status, odds: data.odds };
                        packet.temporal.t60 = data.t60_snapshot;
                        packet.temporal.t0 = data.t0_snapshot;
                        if (data.odds && data.t60_snapshot) packet.lineMovement = calculateLineMovement(data.odds, data.t60_snapshot);
                    }
                }).catch(e => console.warn(`[Evidence] Live state fetch failed:`, e?.message || e))
        );
    }

    await Promise.allSettled(promises);
    return packet;
}

function buildClaimMap(response, thoughts) {
    // 🛡️ PERF: Aggressively restrict string length to prevent Regex Event Loop DOS
    const evalText = truncateText(response + " " + thoughts, 12000).toLowerCase();
    const map = { verdict: null, confidence: "medium", confluence: { price: false, sentiment: false, structure: false } };

    for (const pattern of VERDICT_PATTERNS) {
        const match = response.match(pattern);
        if (match) {
            const extracted = match[1].trim().replace(/\*+/g, "").trim();
            map.verdict = extracted.toLowerCase().includes("pass") ? "PASS" : extracted;
            break;
        }
    }

    if (/(high confidence|confidence: high|\(high\))/i.test(evalText)) map.confidence = "high";
    else if (/(low confidence|confidence: low|\(low\))/i.test(evalText)) map.confidence = "low";

    map.confluence.price = /(market|price|clv|delta|line move|steam|reverse|closing)/i.test(evalText);
    map.confluence.sentiment = /(sentiment|sharp|public|split|money|ticket|fade|action)/i.test(evalText);
    map.confluence.structure = /(structural|injury|rotation|rest|b2b|travel|revenge|matchup)/i.test(evalText);

    return map;
}

function gateDecision(map, strict) {
    const score = Object.values(map.confluence).filter(Boolean).length;
    if (map.verdict === "PASS") return { approved: true, reason: "INTENTIONAL_PASS", score };
    if (strict && score < 2) return { approved: false, reason: `WEAK_CONFLUENCE (${score}/3)`, score };
    return { approved: true, reason: "APPROVED", score };
}

async function extractPickStructured(text, context) {
    if (!context || !context.home_team || !context.away_team) return [];

    const prompt = `GAME CONTEXT:
- Home Team: "${context.home_team}"
- Away Team: "${context.away_team}"
- League: ${context.league || "Unknown"}

TASK: Extract betting verdict from analysis.
RULES:
1. pick_team MUST exactly match Home or Away (null for Totals).
2. If verdict is PASS or NO BET, set verdict="PASS".
3. For Totals: pick_type="total", pick_direction="over" or "under".
ANALYSIS:\n${truncateText(text, 2500)}`;

    try {
        const { object } = await generateObject({
            model: google(CONFIG.MODEL_ID),
            schema: BettingPickSchema,
            prompt, mode: "json", abortSignal: AbortSignal.timeout(15000)
        });

        if (object.verdict === "BET" || object.verdict === "FADE") {
            if (object.pick_type !== "total" && object.pick_team) {
                // 🛡️ DATA: Strict alphanumeric regex prevents extraction loss on teams like 76ers / 49ers
                const pickNorm = object.pick_team.toLowerCase().replace(/[^a-z0-9]/g, "");
                const homeNorm = context.home_team.toLowerCase().replace(/[^a-z0-9]/g, "");
                const awayNorm = context.away_team.toLowerCase().replace(/[^a-z0-9]/g, "");

                if (pickNorm && homeNorm && (pickNorm.includes(homeNorm) || homeNorm.includes(pickNorm))) object.pick_team = context.home_team;
                else if (pickNorm && awayNorm && (pickNorm.includes(awayNorm) || awayNorm.includes(pickNorm))) object.pick_team = context.away_team;
                else return []; // Hallucination defense
            }
        }
        return [object];
    } catch (e) {
        if (e.name === "AbortError" || e.name === "TimeoutError") console.warn("[Pick Extraction] Timed out (15s)");
        else console.error("[Pick Extraction] Failed:", e?.message || e);
        return [];
    }
}

// =============================================================================
// MAIN VERCEL WEB API HANDLER (For Vite api/ directory)
// =============================================================================

export async function POST(req) {
    // 🛡️ SEC: Required env validation w/ explicit 500 response
    if (!genAI || !supabase) {
        return new Response(JSON.stringify({ error: "Server misconfigured: missing required env vars." }), {
            status: 500, headers: { "Content-Type": "application/json" }
        });
    }

    // 🛡️ SEC: Pre-Read Content-Length Check (OOM / Memory Exhaustion Defense)
    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > CONFIG.MAX_PAYLOAD_SIZE) {
        return new Response(JSON.stringify({ error: "Payload too large (Max 2MB)" }), { status: 413, headers: { "Content-Type": "application/json" } });
    }

    // 🛡️ SEC: Strict Proxy-Safe IP Extraction & Legacy Format Guard
    const clientIp = getClientIp(req.headers);
    const legacyReq = {
        headers: Object.fromEntries(req.headers.entries()),
        method: req.method, url: req.url,
        socket: { remoteAddress: clientIp }
    };

    if (!checkRateLimit(legacyReq)) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    const bodyText = await req.text();
    // Secondary size catch in case chunked transfer lacked content-length
    if (bodyText.length > CONFIG.MAX_PAYLOAD_SIZE) {
        return new Response(JSON.stringify({ error: "Payload too large (Max 2MB)" }), { status: 413, headers: { "Content-Type": "application/json" } });
    }

    let body;
    try { body = bodyText ? JSON.parse(bodyText) : {}; }
    catch { return new Response(JSON.stringify({ error: "Invalid JSON payload" }), { status: 400, headers: { "Content-Type": "application/json" } }); }

    // 🛡️ SEC: Strict ID Casting prevents Object-Injection vulnerabilities in DB queries
    const convoIdRaw = body.conversation_id;
    const runIdRaw = body.run_id;
    const conversation_id = isValidUUID(convoIdRaw) ? String(convoIdRaw) : null;
    const currentRunId = isValidUUID(runIdRaw) ? String(runIdRaw) : crypto.randomUUID();

    const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-CONFIG.MAX_MESSAGES) : [];

    // Do not pre-stringify the payload here to preserve Multimodal Vision structures
    const messages = rawMessages
        .map((m) => {
            if (!m || typeof m !== "object") return null;
            return { role: m.role === "assistant" ? "assistant" : "user", content: m.content };
        })
        .filter(Boolean);

    let activeContext = body.gameContext || {};
    const nbaProductContext = body.nba_product_context && typeof body.nba_product_context === "object"
        ? body.nba_product_context
        : null;

    // Safely extract final user query & detect images
    const lastMsgContent = messages.length > 0 ? messages[messages.length - 1].content : "";
    let userQuery = "";
    let hasImage = false;

    if (typeof lastMsgContent === "string") {
        userQuery = lastMsgContent;
    } else if (Array.isArray(lastMsgContent)) {
        userQuery = lastMsgContent.find(c => c.type === "text" || c.text)?.text || "";
        hasImage = lastMsgContent.some(c => c.type === "image" || c.type === "image_url");
    }

    const MODE = detectMode(userQuery, hasImage);

    // --- PARALLEL: LIVE SENTINEL + EVIDENCE PACKET ---
    let liveScan = { ok: false }, evidence = { injuries: { home: [], away: [] }, liveState: null, temporal: { t60: null, t0: null }, lineMovement: null };
    try {
        [liveScan, evidence] = await Promise.all([scanForLiveGame(userQuery), buildEvidencePacket(activeContext)]);
    } catch (e) {
        console.warn("[WARN] Middle logic failed:", e?.message || e);
    }

    let isLive = false;
    if (liveScan.ok) {
        activeContext = { ...activeContext, ...liveScan.data, match_id: String(liveScan.data.id), clock: liveScan.data.display_clock, status: liveScan.data.game_status, current_odds: liveScan.data.odds };
        isLive = true;
    }

    if (evidence.liveState) activeContext = { ...activeContext, ...evidence.liveState, current_odds: evidence.liveState.odds };

    const validLiveStatuses = ["IN_PROGRESS", "LIVE", "HALFTIME", "END_PERIOD"];
    isLive = isLive || validLiveStatuses.some(st => (activeContext?.status || "").toUpperCase().includes(st));
    const questionType = classifyQuestionType(userQuery);
    const responseClass = classifyResponseClass({ questionType, userQuery });
    const modeForPrompt = responseClass === RESPONSE_CLASSES.EDGE ? "ANALYSIS" : "CONVERSATION";

    const trustedPacketMatchId = activeContext?.match_id ? String(activeContext.match_id) : null;
    const trustedPacket = trustedPacketMatchId ? await fetchTrustedMatchPacket(trustedPacketMatchId, questionType) : null;
    const trustedEvidenceLines = extractEvidenceLinesFromPacket(trustedPacket);
    const trustedFreshnessSeconds = Number.isFinite(trustedPacket?.packet_meta?.freshness_seconds)
        ? Number(trustedPacket.packet_meta.freshness_seconds)
        : null;
    const trustedPacketAsOf = trustedPacket?.packet_meta?.as_of || null;
    const inferenceMode = deriveInferenceMode(trustedPacket);
    const requiredAnswerabilityKeys = getRequiredAnswerabilityKeys(questionType);
    const missingRequiredKeys = trustedPacket
        ? requiredAnswerabilityKeys.filter((key) => trustedPacket?.answerability?.[key] !== true)
        : requiredAnswerabilityKeys;
    const requiresTrustedPacket = isLive || (LIVE_QUESTION_TYPES.has(questionType) && Boolean(trustedPacketMatchId));
    const packetIsStale = Number.isFinite(trustedFreshnessSeconds)
        && trustedFreshnessSeconds > PACKET_STALE_THRESHOLD_SECONDS;
    const deterministicFactAnswer = buildDeterministicFactAnswer({
        questionType,
        userQuery,
        trustedPacket,
    });

    let qualityFailureCode = QUALITY_FAILURE_CODES.OK;
    let qualityFailureReason = null;

    if (requiresTrustedPacket && !trustedPacket) {
        qualityFailureCode = QUALITY_FAILURE_CODES.PACKET_BYPASS;
        qualityFailureReason = "trusted_packet_missing";
    } else if (requiresTrustedPacket && packetIsStale) {
        qualityFailureCode = QUALITY_FAILURE_CODES.STALE_CONFIDENT_ANSWER;
        qualityFailureReason = "trusted_packet_stale";
    } else if (requiresTrustedPacket && missingRequiredKeys.length > 0) {
        qualityFailureCode = QUALITY_FAILURE_CODES.PARTIAL_PACKET_OVERREACH;
        qualityFailureReason = `missing_required_fields:${missingRequiredKeys.join(",")}`;
    } else if (questionType === "market" && inferenceMode === "snapshot_only") {
        qualityFailureCode = QUALITY_FAILURE_CODES.SNAPSHOT_AS_TRANSITION;
        qualityFailureReason = "market_query_without_transition_evidence";
    }

    const marketPhase = getMarketPhase(activeContext);
    const lineMovementIntel = (evidence.lineMovement?.available && evidence.lineMovement.movements?.length > 0)
        ? evidence.lineMovement.movements.map(m => `${m.signal} ${m.type}: ${m.direction} ${m.delta}pts`).join(" | ")
        : "";

    const liveDataUrls = [];
    if (activeContext?.match_id && isSatelliteConfigured()) {
        const origin = getPublicOrigin();
        const gid = encodeURIComponent(String(activeContext.match_id));
        const [scores, odds, pbp] = ["scores", "odds", "pbp"].map(t => generateSatelliteSlug(String(activeContext.match_id), t));
        if (scores.slug && scores.nonce && odds.slug && odds.nonce && pbp.slug && pbp.nonce) {
            liveDataUrls.push(
                `${origin}/api/live/scores/${scores.slug}?g=${gid}&n=${scores.nonce}`,
                `${origin}/api/live/odds/${odds.slug}?g=${gid}&n=${odds.nonce}`,
                `${origin}/api/live/pbp/${pbp.slug}?g=${gid}&n=${pbp.nonce}`
            );
        }
    }

    const geminiHistory = normalizeGeminiHistory(messages, liveDataUrls);
    waitUntil(logResponseQualityGuard({
        matchId: trustedPacketMatchId,
        questionType,
        failureCode: qualityFailureCode,
        missingFields: missingRequiredKeys,
        freshnessSeconds: trustedFreshnessSeconds,
        inferenceMode,
        isLiveIntent: isLive || LIVE_QUESTION_TYPES.has(questionType),
        requiresPacket: requiresTrustedPacket,
        reason: qualityFailureReason,
    }));

    // -------------------------------------------------------------------------
    // STREAM ENGINE: Native Web Streams
    // -------------------------------------------------------------------------
    const stream = new ReadableStream({
        async start(controller) {
            let streamActive = true;

            const safeWrite = (payload) => {
                if (!streamActive) return;
                try { controller.enqueue(ENCODER.encode(`data: ${JSON.stringify(payload)}\n\n`)); }
                catch { streamActive = false; }
            };

            const sendDone = (() => {
                let sent = false;
                return (payload = {}) => {
                    if (sent) return;
                    sent = true;
                    safeWrite({ done: true, model: CONFIG.MODEL_ID, ...payload });
                };
            })();

            controller.enqueue(ENCODER.encode(`:ok\n\n`));
            safeWrite({ type: "response_class", class: responseClass });

            let fullText = "";
            let rawThoughts = "";
            let finalMetadata = null;

            try {
                const systemPrompt = `${buildStaticInstruction(modeForPrompt)}\n\n${buildDynamicInstruction({
                    marketPhase,
                    MODE: modeForPrompt,
                    responseClass,
                    questionType,
                    activeContext,
                    isLive,
                    liveDataUrls,
                    evidence,
                    lineMovementIntel,
                    staleWarning: [
                        isContextStale(activeContext) ? "⚠️ DATA WARNING: Context may be stale." : "",
                        qualityFailureCode === QUALITY_FAILURE_CODES.SNAPSHOT_AS_TRANSITION
                            ? "⚠️ QUALITY MODE: Snapshot-only context. Do not claim transition-level causality."
                            : ""
                    ].filter(Boolean).map((line) => `\n${line}`).join(""),
                    nbaProductContext,
                    trustedPacket
                })}`;

                if (trustedPacket && trustedEvidenceLines.length > 0) {
                    safeWrite({
                        type: "evidence",
                        lines: trustedEvidenceLines,
                        freshness_seconds: trustedFreshnessSeconds,
                        as_of: trustedPacketAsOf
                    });
                }

                const hardStopFailureCodes = new Set([
                    QUALITY_FAILURE_CODES.PACKET_BYPASS,
                    QUALITY_FAILURE_CODES.STALE_CONFIDENT_ANSWER,
                    QUALITY_FAILURE_CODES.PARTIAL_PACKET_OVERREACH,
                ]);

                if (hardStopFailureCodes.has(qualityFailureCode)) {
                    fullText = getGuardrailMessage({
                        failureCode: qualityFailureCode,
                        questionType,
                        missingKeys: missingRequiredKeys,
                        freshnessSeconds: trustedFreshnessSeconds,
                    });
                    safeWrite({ type: "text", content: fullText });
                    safeWrite({
                        type: "quality",
                        content: `quality_guard:${qualityFailureCode}`,
                    });
                    sendDone({ fallback: qualityFailureCode });
                    return;
                }

                if (responseClass === RESPONSE_CLASSES.FACT && deterministicFactAnswer) {
                    fullText = deterministicFactAnswer;
                    safeWrite({ type: "text", content: fullText });
                    sendDone({ fallback: "deterministic_fact" });
                    return;
                }

                const result = await genAI.models.generateContentStream({
                    model: CONFIG.MODEL_ID,
                    contents: geminiHistory,
                    config: {
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        thinkingConfig: CONFIG.THINKING_CONFIG,
                        tools: CONFIG.TOOLS
                    },
                    abortSignal: req.signal // 🌟 Kills Google billing immediately if tab closes
                });

                for await (const chunk of result) {
                    if (!streamActive || req.signal.aborted) break;

                    if (chunk.candidates?.[0]?.groundingMetadata) {
                        finalMetadata = chunk.candidates[0].groundingMetadata;
                        safeWrite({ type: "grounding", metadata: finalMetadata });
                    }

                    for (const part of (chunk.candidates?.[0]?.content?.parts || [])) {
                        if (!part.text) continue;
                        if (part.thought) {
                            rawThoughts += part.text;
                            safeWrite({ type: "thought", content: part.text });
                        } else {
                            fullText += part.text;
                            safeWrite({ type: "text", content: part.text });
                        }
                    }
                }

                // 🌟 Concurrent Background Database Execution 🌟
                if (streamActive && !req.signal.aborted && fullText) {
                    waitUntil((async () => {
                        try {
                            const dbTasks = [];

                            const cleanMatchId = activeContext?.match_id ? String(activeContext.match_id) : null;

                            if (modeForPrompt === "ANALYSIS") {
                                const analysisTask = (async () => {
                                    const map = buildClaimMap(fullText, rawThoughts);
                                    const gate = gateDecision(map, true);

                                    const grounding = finalMetadata ? {
                                        chunk_count: finalMetadata.groundingChunks?.length || 0,
                                        support_count: finalMetadata.groundingSupports?.length || 0,
                                        sources: (finalMetadata.groundingChunks || []).map(c => c.web?.uri).filter(Boolean).slice(0, 10),
                                        supports: (finalMetadata.groundingSupports || []).map(s => ({ text: s.segment?.text?.slice(0, 100), chunks: s.groundingChunkIndices })).slice(0, 20)
                                    } : null;

                                    // 🛡️ DATA: Explicitly evaluate Supabase SDK errors (prevent silent failures)
                                    const { error: upsertErr } = await supabase.from("ai_chat_runs").upsert({
                                        id: currentRunId, conversation_id, confluence_met: gate.approved, confluence_score: gate.score,
                                        verdict: map.verdict, confidence: map.confidence, gate_reason: gate.reason,
                                        match_context: cleanMatchId ? { id: cleanMatchId, home: activeContext.home_team, away: activeContext.away_team } : null,
                                        grounding_provenance: grounding
                                    }, { onConflict: "id" });

                                    if (upsertErr) throw new Error(`Run Upsert Failed: ${upsertErr.message}`);

                                    if (gate.approved && map.verdict && map.verdict !== "PASS" && activeContext?.home_team && activeContext?.away_team) {
                                        const structuralPicks = await extractPickStructured(fullText, activeContext); // 🛡️ DATA: Pass fullText for correct summary
                                        if (structuralPicks.length > 0) {
                                            const { error: picksErr } = await supabase.from("ai_chat_picks").insert(structuralPicks.map(p => {
                                                const side = p.pick_type === "total" ? (p.pick_direction ? p.pick_direction.toUpperCase() : "UNKNOWN") : p.pick_team;
                                                return {
                                                    run_id: currentRunId, conversation_id, match_id: cleanMatchId,
                                                    home_team: activeContext.home_team, away_team: activeContext.away_team, league: activeContext?.league,
                                                    game_start_time: activeContext?.start_time || activeContext?.game_start_time,
                                                    pick_type: p.pick_type, pick_side: side, pick_line: p.pick_line,
                                                    ai_confidence: p.confidence || map.confidence || "medium", model_id: CONFIG.MODEL_ID,
                                                    reasoning_summary: p.reasoning_summary, extraction_method: "structured_v29.0_titanium"
                                                };
                                            }));

                                            if (picksErr) throw new Error(`Picks Insert Failed: ${picksErr.message}`);
                                        }
                                    }
                                })();
                                dbTasks.push(analysisTask);
                            }

                            if (conversation_id) {
                                const sources = finalMetadata?.groundingChunks?.map(c => ({ title: c.web?.title, uri: c.web?.uri })).filter(s => s.uri) || [];

                                const updateTask = supabase.from("conversations").update({
                                    messages: [...rawMessages, { role: "assistant", content: fullText, thoughts: rawThoughts, groundingMetadata: finalMetadata, sources, model: CONFIG.MODEL_ID }].slice(-CONFIG.MAX_MESSAGES),
                                    last_message_at: new Date().toISOString()
                                }).eq("id", conversation_id).then(({ error }) => {
                                    if (error) throw new Error(`Conversation Update Failed: ${error.message}`);
                                });

                                dbTasks.push(updateTask);
                            }

                            // 🛡️ PERF: Log specific sub-task failures without crashing the entire block
                            const results = await Promise.allSettled(dbTasks);
                            results.forEach((res, idx) => {
                                if (res.status === "rejected") {
                                    console.error(`🔥 Background Task [${idx}] Failed:`, res.reason);
                                }
                            });

                        } catch (dbErr) {
                            console.error("🔥 Fatal Background Setup Error:", dbErr?.message || dbErr);
                        }
                    })());
                }

                sendDone();
            } catch (e) {
                if (e?.name === "AbortError" || req.signal.aborted || !streamActive) {
                    console.log("⚠️ Stream aborted by user");
                } else {
                    console.error("🔥 Stream Generation Error:", e);
                    safeWrite({ type: "error", content: e?.message || "An unexpected error occurred." });
                }
                sendDone({ ok: false });
            } finally {
                streamActive = false;
                try { controller.close(); } catch { }
            }
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no" // Keep Vercel edge unbuffered
        }
    });
}
