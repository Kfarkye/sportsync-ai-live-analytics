/**
 * ============================================================================
 * api/chat.ts
 * "Obsidian Citadel" — Elite Production Backend (v26.2 Enterprise)
 *
 * Engine: Gemini 3 Flash Preview (Multi-Provider Fallbacks Enabled)
 * Protocol: Dual-Mode + Verdict First + Entity Firewall + Tool Calling
 *
 * ENTERPRISE UPGRADES:
 * ├─ STRICT TYPES: Zod payload validation & TypeScript interfaces.
 * ├─ CONCURRENCY: Request Coalescing (Thundering Herd) for external APIs.
 * ├─ MEMORY SAFETY: Bounded LRU caching prevents OOM leaks.
 * ├─ RESILIENT SSE: Anti-buffering headers & safe writable checks.
 * └─ OBSERVABILITY: Structured logging with run_id tracing.
 * ============================================================================
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import crypto from "crypto";

import { BettingPickSchema } from "../lib/schemas/picks.js";
import { orchestrate, orchestrateStream, getProviderHealth, googleClient, circuitBreaker } from "../lib/ai-provider.js";
import { FUNCTION_DECLARATIONS, TOOL_CONFIG, TOOL_ENABLED_TASK_TYPES } from "../lib/tool-registry.js";
import { ToolResultCache } from "../lib/tool-result-cache.js";
import { createToolCallingStream } from "../lib/tool-calling-stream.js";

// =============================================================================
// 1. TYPES & SCHEMAS
// =============================================================================

const ChatRequestSchema = z.object({
    messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))])
    })).min(1),
    session_id: z.string().nullish(),
    conversation_id: z.string().nullish(),
    gameContext: z.record(z.string(), z.unknown()).optional().nullable(),
    run_id: z.string().nullish()
});

export type TaskType = "grounding" | "analysis" | "chat" | "vision" | "code" | "recruiting";
export type Mode = "ANALYSIS" | "CONVERSATION";

export interface GameContext {
    match_id?: string;
    home_team?: string;
    away_team?: string;
    home_team_id?: string;
    away_team_id?: string;
    league?: string;
    sport?: string;
    start_time?: string;
    game_start_time?: string;
    status?: string;
    game_status?: string;
    home_score?: number;
    away_score?: number;
    clock?: string;
    display_clock?: string;
    current_odds?: Record<string, unknown>;
    odds?: Record<string, unknown>;
    t60_snapshot?: { odds?: Record<string, unknown> };
    t0_snapshot?: { odds?: Record<string, unknown> };
    period?: number;
    [key: string]: unknown;
}

export interface ClaimMap {
    verdict: string | null;
    confidence: "low" | "medium" | "high";
    confluence: {
        price: boolean;
        sentiment: boolean;
        structure: boolean;
    };
}

interface InjuryRecord {
    name: string;
    status: string;
    position: string;
}

interface LineMovement {
    type: string;
    delta: string;
    direction: string;
    signal: string;
}

// =============================================================================
// 2. CONFIGURATION & INFRASTRUCTURE
// =============================================================================

const TOOL_CALLING_COMPAT_MODEL_ID = process.env.GEMINI_TOOL_MODEL_COMPAT_ID || "gemini-2.5-flash";
const TOOL_CALLING_ENABLE_GOOGLE_SEARCH = process.env.TOOL_CALLING_ENABLE_GOOGLE_SEARCH === "true";

function isGemini3Model(model: string): boolean {
    return /^gemini-3(?:-|$)/i.test(model);
}

const CONFIG = {
    MODEL_ID: "gemini-3-flash-preview",
    TOOL_CALLING_MODEL_ID: process.env.GEMINI_TOOL_MODEL_ID || "gemini-3-flash-preview",
    HANDLER_TIMEOUT_MS: 90_000,
    ANALYSIS_TRIGGERS: [
        "edge", "best bet", "should i bet", "picks", "prediction", "analyze",
        "analysis", "spread", "over", "under", "moneyline", "verdict", "play",
        "handicap", "sharp", "odds", "line", "lean", "lock", "parlay", "action", "value", "bet", "pick"
    ] as const,
    GROUNDING_TRIGGERS: [
        "odds", "line", "spread", "total", "score", "live", "today",
        "tonight", "injury", "status", "current", "slate", "updates"
    ] as const,
    STALE_THRESHOLD_MS: 15 * 60 * 1000,
    INJURY_CACHE_TTL_MS: 5 * 60 * 1000,
    ENABLE_TOOL_CALLING: process.env.ENABLE_TOOL_CALLING !== "false"
} as const;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
});

const log = {
    info: (msg: string, data?: Record<string, unknown>) => console.log(JSON.stringify({ level: "INFO", msg, ...data, ts: new Date().toISOString() })),
    warn: (msg: string, data?: Record<string, unknown>) => console.warn(JSON.stringify({ level: "WARN", msg, ...data, ts: new Date().toISOString() })),
    error: (msg: string, data?: Record<string, unknown>) => console.error(JSON.stringify({ level: "ERROR", msg, ...data, ts: new Date().toISOString() }))
};

/**
 * Bounded TTL Memory Cache w/ Request Coalescing (Thundering Herd Protection)
 */
class BoundedTTLMemoryCache<T> {
    private cache = new Map<string, { data: T; expiresAt: number }>();
    private inflight = new Map<string, Promise<T>>();

    constructor(private maxSize: number = 500) { }

    async getOrFetch(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
        const now = Date.now();
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > now) {
            return cached.data;
        }

        if (this.inflight.has(key)) return this.inflight.get(key)!;

        const promise = fetcher().then((data) => {
            if (this.cache.size >= this.maxSize) {
                const firstKey = this.cache.keys().next().value;
                if (firstKey) this.cache.delete(firstKey);
            }
            this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
            return data;
        }).finally(() => {
            this.inflight.delete(key);
        });

        this.inflight.set(key, promise);
        return promise;
    }
}

const INJURY_CACHE = new BoundedTTLMemoryCache<{ injuries: InjuryRecord[] }>(500);

/**
 * Resilient SSE Writer (Prevents write-after-end crashes and proxies)
 */
class SSEWriter {
    constructor(private res: NextApiResponse) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
    }

    private get writable(): boolean {
        return (
            !this.res.writableEnded &&
            !this.res.writableFinished &&
            !(this.res as unknown as { closed?: boolean }).closed &&
            !this.res.destroyed
        );
    }

    writeEvent(type: string, data: Record<string, unknown>): void {
        if (!this.writable) return;
        this.res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        this.flush();
    }

    writeDone(modelId?: string): void {
        if (!this.writable) return;
        if (modelId) this.res.write(`data: ${JSON.stringify({ done: true, model: modelId })}\n\n`);
        this.res.write("data: [DONE]\n\n");
        this.flush();
    }

    writeError(message: string): void {
        if (!this.writable) return;
        this.res.write(`data: ${JSON.stringify({ type: "error", content: message })}\n\n`);
        this.res.write("data: [DONE]\n\n");
        this.flush();
    }

    private flush() {
        if (typeof (this.res as unknown as { flush?: () => void }).flush === "function") {
            (this.res as unknown as { flush: () => void }).flush();
        }
    }
}

// =============================================================================
// 3. CORE LOGIC & PARSING
// =============================================================================

function safeJsonStringify(obj: unknown, maxLen = 1200): string {
    try {
        const str = JSON.stringify(obj);
        return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
    } catch {
        return "";
    }
}

function safeParseJSON(raw: string): { success: boolean; data?: unknown; raw?: string } {
    if (!raw || typeof raw !== "string") return { success: false, raw };
    let text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();

    const start = text.search(/[\{\[]/);
    if (start === -1) return { success: false, raw };

    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (end !== -1) text = text.slice(start, end + 1);

    try { return { success: true, data: JSON.parse(text) }; }
    catch { return { success: false, raw }; }
}

function detectMode(query: string, hasImage: boolean): Mode {
    if (hasImage) return "ANALYSIS";
    if (!query) return "CONVERSATION";
    const q = query.toLowerCase();
    return CONFIG.ANALYSIS_TRIGGERS.some((t) => q.includes(t)) ? "ANALYSIS" : "CONVERSATION";
}

function detectTaskType(query: string, hasImage: boolean): TaskType {
    if (hasImage) return "analysis";
    if (!query) return "chat";
    const q = query.toLowerCase();
    if (CONFIG.GROUNDING_TRIGGERS.some((t) => q.includes(t))) return "grounding";
    if (CONFIG.ANALYSIS_TRIGGERS.some((t) => q.includes(t))) return "analysis";
    return "chat";
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function pickString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value;
    }
    return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return undefined;
}

function normalizeIncomingGameContext(input: unknown): GameContext {
    const raw = asRecord(input);
    const homeTeam = asRecord(raw.homeTeam);
    const awayTeam = asRecord(raw.awayTeam);

    const startRaw = raw.start_time ?? raw.startTime ?? raw.game_start_time;
    const startTime =
        typeof startRaw === "string"
            ? startRaw
            : startRaw instanceof Date
                ? startRaw.toISOString()
                : undefined;

    return {
        ...raw,
        match_id: pickString(raw.match_id, raw.id),
        home_team: pickString(raw.home_team, homeTeam.name),
        away_team: pickString(raw.away_team, awayTeam.name),
        league: pickString(raw.league, raw.leagueId, raw.league_id),
        sport: pickString(raw.sport),
        start_time: startTime,
        status: pickString(raw.status, raw.game_status),
        game_status: pickString(raw.game_status, raw.status),
        period: pickNumber(raw.period),
        clock: pickString(raw.clock, raw.displayClock, raw.display_clock),
        display_clock: pickString(raw.display_clock, raw.displayClock, raw.clock),
        home_score: pickNumber(raw.home_score, raw.homeScore),
        away_score: pickNumber(raw.away_score, raw.awayScore),
        current_odds: asRecord(raw.current_odds).spread !== undefined || asRecord(raw.current_odds).total !== undefined
            ? asRecord(raw.current_odds)
            : (asRecord(raw.odds).spread !== undefined || asRecord(raw.odds).total !== undefined ? asRecord(raw.odds) : undefined),
    };
}

const LIVE_ODDS_KEYS = [
    "spread",
    "homeSpread",
    "awaySpread",
    "total",
    "overUnder",
    "homeML",
    "awayML",
    "moneylineHome",
    "moneylineAway",
    "homeSpreadOdds",
    "awaySpreadOdds",
    "overOdds",
    "underOdds",
] as const;

const REGEX_CITATION_TOKEN = /\[(\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*)\](?!\()/g;

function buildLiveOddsSnapshot(currentOdds: Record<string, unknown> | undefined): Record<string, string | number> {
    if (!currentOdds) return {};
    const snapshot: Record<string, string | number> = {};
    for (const key of LIVE_ODDS_KEYS) {
        const value = currentOdds[key];
        if (typeof value === "string" && value.trim()) snapshot[key] = value.trim();
        if (typeof value === "number" && Number.isFinite(value)) snapshot[key] = value;
    }
    return snapshot;
}

function buildLiveLineTokens(snapshot: Record<string, string | number>): string[] {
    const tokens = new Set<string>();
    for (const value of Object.values(snapshot)) {
        if (typeof value === "number") {
            const base = String(value);
            tokens.add(base.toLowerCase());
            if (value > 0) tokens.add(`+${base}`.toLowerCase());
            continue;
        }
        const raw = value.toLowerCase().replace(/\s+/g, "");
        tokens.add(raw);
        const numeric = raw.replace(/^[ou]\s*/i, "");
        if (numeric !== raw) {
            tokens.add(numeric);
            if (numeric.startsWith("+")) tokens.add(numeric.slice(1));
        }
        if (raw.startsWith("+")) tokens.add(raw.slice(1));
    }
    return [...tokens];
}

function responseContainsLockedLine(text: string, lineTokens: string[]): boolean {
    if (!text || lineTokens.length === 0) return false;
    const normalized = text.toLowerCase().replace(/\s+/g, "");
    return lineTokens.some((token) => token && normalized.includes(token));
}

function buildLineGuardMessage(
    activeContext: GameContext,
    liveOddsSnapshot: Record<string, string | number>,
    reason: "NO_LIVE_ODDS" | "LINE_MISMATCH",
): string {
    const matchup = `${activeContext.away_team || "AWAY"} @ ${activeContext.home_team || "HOME"}`;
    const clock = activeContext.clock || activeContext.display_clock || "LIVE";
    const board = Object.keys(liveOddsSnapshot).length > 0
        ? safeJsonStringify(liveOddsSnapshot, 600)
        : "UNAVAILABLE";

    if (reason === "NO_LIVE_ODDS") {
        return `VERDICT: LINE_UNAVAILABLE\n\nLive analysis blocked for ${matchup} (${clock}) because current odds were not present in trusted context. Refresh odds feed and retry.`;
    }

    return `VERDICT: LINE_UNAVAILABLE\n\nLive line guard blocked output for ${matchup} (${clock}) because generated pricing did not match locked live board.\n\nLOCKED_LIVE_BOARD: ${board}`;
}

function sanitizeCitationsForAvailableSources(
    text: string,
    metadata: Record<string, unknown> | null,
): { text: string; hadCitations: boolean; changed: boolean; sourceCount: number } {
    if (!text) return { text, hadCitations: false, changed: false, sourceCount: 0 };

    const groundingChunks = Array.isArray(metadata?.groundingChunks)
        ? metadata.groundingChunks as Array<Record<string, unknown>>
        : [];
    const sourceCount = groundingChunks.filter((chunk) => {
        const web = chunk.web as Record<string, unknown> | undefined;
        return typeof web?.uri === "string" && web.uri.length > 0;
    }).length;

    let hadCitations = false;
    const sanitized = text.replace(REGEX_CITATION_TOKEN, (_match, inner: string) => {
        hadCitations = true;

        // No grounded source ledger available: strip bracket tokens entirely.
        if (sourceCount === 0) return "";

        const validIds = inner
            .split(/[,\s]+/)
            .map((part) => part.trim())
            .filter(Boolean)
            .filter((part) => {
                const id = Math.floor(Number.parseFloat(part));
                return Number.isFinite(id) && id >= 1 && id <= sourceCount;
            });

        if (validIds.length === 0) return "";
        return `[${Array.from(new Set(validIds)).join(", ")}]`;
    });

    const cleaned = sanitized
        .replace(/\s+\./g, ".")
        .replace(/\s+,/g, ",")
        .replace(/\s{2,}/g, " ")
        .trim();

    return {
        text: cleaned,
        hadCitations,
        changed: cleaned !== text,
        sourceCount,
    };
}

function getMarketPhase(match: GameContext | null): string {
    if (!match) return "UNKNOWN";
    const status = (match.status as string || match.game_status as string || "").toUpperCase();

    if (["IN_PROGRESS", "LIVE", "HALFTIME", "END_PERIOD"].some(s => status.includes(s))) {
        return `🔴 LIVE_IN_PLAY [${match.clock || match.display_clock || "Active"}]`;
    }
    if (["FINAL", "FINISHED", "COMPLETE"].some(s => status.includes(s))) {
        return "🏁 FINAL_SCORE";
    }
    if (match.start_time || match.game_start_time) {
        const hrs = (new Date((match.start_time || match.game_start_time) as string).getTime() - Date.now()) / 3600000;
        if (hrs < 0 && hrs > -4) return "🔴 LIVE_IN_PLAY (Inferred)";
        if (hrs <= -4) return "🏁 FINAL_SCORE";
        if (hrs < 1) return "⚡ CLOSING_LINE";
        if (hrs < 6) return "🎯 SHARP_WINDOW";
        if (hrs < 24) return "🌊 DAY_OF_GAME";
    }
    return "🔭 OPENING_MARKET";
}

function calculateLineMovement(currentOdds: unknown, t60Snapshot: { odds?: Record<string, unknown> } | undefined) {
    if (!currentOdds || !t60Snapshot?.odds) return { available: false, signal: "STABLE_MARKET", movements: [] as LineMovement[] };

    const current = currentOdds as Record<string, number>;
    const opening = t60Snapshot.odds as Record<string, number>;
    const movements: LineMovement[] = [];

    if (typeof current.spread === "number" && typeof opening.spread === "number") {
        const spreadDelta = current.spread - opening.spread;
        if (Math.abs(spreadDelta) >= 0.5) {
            movements.push({
                type: "SPREAD",
                delta: Math.abs(spreadDelta).toFixed(1),
                direction: spreadDelta < 0 ? "HOME" : "AWAY",
                signal: Math.abs(spreadDelta) >= 1.5 ? "🚨 SHARP_STEAM" : "📊 LINE_MOVE"
            });
        }
    }

    if (typeof current.total === "number" && typeof opening.total === "number") {
        const totalDelta = current.total - opening.total;
        if (Math.abs(totalDelta) >= 1) {
            movements.push({
                type: "TOTAL",
                delta: Math.abs(totalDelta).toFixed(1),
                direction: totalDelta > 0 ? "UP" : "DOWN",
                signal: Math.abs(totalDelta) >= 2.5 ? "🚨 SHARP_STEAM" : "📊 LINE_MOVE"
            });
        }
    }

    if (movements.length === 0) return { available: true, signal: "STABLE_MARKET", movements: [] as LineMovement[] };

    return {
        available: true,
        movements,
        signal: movements.some(m => m.signal === "🚨 SHARP_STEAM") ? "SHARP_ACTION_DETECTED" : "MODERATE_MOVEMENT"
    };
}

// =============================================================================
// 4. DATA FETCHERS
// =============================================================================

function extractAllTeamHints(query: string): string[] {
    if (!query) return [];
    return query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3)
        .sort((a, b) => b.length - a.length)
        .slice(0, 4);
}

async function scanForLiveGame(userQuery: string, signal?: AbortSignal) {
    const hints = extractAllTeamHints(userQuery);
    if (!hints.length) return { ok: false as const };

    try {
        const orClauses = hints.map((h) => `home_team.ilike.%${h}%,away_team.ilike.%${h}%`).join(",");
        const query = supabase
            .from("live_game_state")
            .select("*")
            .in("game_status", ["IN_PROGRESS", "HALFTIME", "END_PERIOD", "LIVE"])
            .or(orClauses)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (signal) query.abortSignal(signal);

        const { data, error } = await query;

        if (error) throw error;
        if (data && data.length > 0) return { ok: true as const, data: data[0] as Record<string, unknown>, isLiveOverride: true };
        return { ok: false as const };
    } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") log.warn("[Live Sentinel] Scan failed", { error: e.message });
        return { ok: false as const };
    }
}

async function fetchESPNInjuries(teamId: string | undefined, sportKey: string | undefined, signal?: AbortSignal): Promise<{ injuries: InjuryRecord[] }> {
    if (!teamId) return { injuries: [] };
    const cacheKey = `${sportKey || "NBA"}_${teamId}`;

    return INJURY_CACHE.getOrFetch(cacheKey, CONFIG.INJURY_CACHE_TTL_MS, async () => {
        const sportConfig: Record<string, { sport: string; league: string }> = {
            NBA: { sport: "basketball", league: "nba" },
            NFL: { sport: "football", league: "nfl" },
            NHL: { sport: "hockey", league: "nhl" },
            NCAAB: { sport: "basketball", league: "mens-college-basketball" },
            CBB: { sport: "basketball", league: "mens-college-basketball" }
        };
        const cfg = sportConfig[(sportKey || "NBA").toUpperCase()] || sportConfig.NBA;

        try {
            const ctrl = new AbortController();
            const timeoutId = setTimeout(() => ctrl.abort(), 4000);

            const onExternalAbort = () => ctrl.abort();
            if (signal) signal.addEventListener("abort", onExternalAbort, { once: true });

            const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/teams/${teamId}?enable=injuries`, { signal: ctrl.signal });

            clearTimeout(timeoutId);
            if (signal) signal.removeEventListener("abort", onExternalAbort);

            if (!res.ok) throw new Error(`ESPN API ${res.status}`);

            const data = await res.json();
            const injuries = ((data.team?.injuries || []) as Array<Record<string, unknown>>)
                .map((i) => ({
                    name: (i.athlete as Record<string, string>)?.displayName ?? "",
                    status: ((i.status as string) ?? "").toUpperCase(),
                    position: ((i.athlete as Record<string, Record<string, string>>)?.position?.abbreviation) ?? ""
                }))
                .filter((i): i is InjuryRecord => Boolean(i.name && i.status))
                .slice(0, 8);

            return { injuries };
        } catch (e: unknown) {
            if (e instanceof Error && e.name !== "AbortError") log.warn(`[Injury Fetch] ${cacheKey} failed`, { error: e.message });
            return { injuries: [] };
        }
    });
}

// =============================================================================
// 5. POST-PROCESSING (ANALYSIS & PERSISTENCE)
// =============================================================================

function buildClaimMap(response: string, thoughts: string): ClaimMap {
    const combinedText = (response + " " + thoughts).toLowerCase();
    const map: ClaimMap = { verdict: null, confidence: "medium", confluence: { price: false, sentiment: false, structure: false } };

    const verdictPatterns = [
        /\*\*verdict[:\s*]*\*\*\s*(.+?)(?:\n|$)/i,
        /verdict[:\s*]+\*\*(.+?)\*\*/i,
        /verdict[:\s*]+(.+?)(?:\n|$)/i
    ];

    for (const pattern of verdictPatterns) {
        const match = response.match(pattern);
        if (match && match[1]) {
            const extracted = match[1].trim().replace(/\*+/g, "").trim();
            map.verdict = extracted.toLowerCase().includes("pass") ? "PASS" : extracted;
            break;
        }
    }

    if (combinedText.includes("high confidence") || combinedText.includes("confidence: high") || combinedText.includes("(high)")) {
        map.confidence = "high";
    } else if (combinedText.includes("low confidence") || combinedText.includes("confidence: low") || combinedText.includes("(low)")) {
        map.confidence = "low";
    }

    map.confluence.price = /(market|price|clv|delta|line move|steam|reverse|closing)/i.test(combinedText);
    map.confluence.sentiment = /(sentiment|sharp|public|split|money|ticket|fade|action)/i.test(combinedText);
    map.confluence.structure = /(structural|injury|rotation|rest|b2b|travel|revenge|matchup)/i.test(combinedText);

    return map;
}

function gateDecision(map: ClaimMap, strict: boolean) {
    const score = Object.values(map.confluence).filter(Boolean).length;
    if (map.verdict === "PASS") return { approved: true, reason: "INTENTIONAL_PASS", score };
    if (strict && score < 2) return { approved: false, reason: `WEAK_CONFLUENCE (${score}/3)`, score };
    return { approved: true, reason: "APPROVED", score };
}

async function extractPickStructured(text: string, context: GameContext): Promise<Record<string, unknown>[]> {
    if (!context || !context.home_team || !context.away_team) return [];

    const extractionPrompt = `
You are a structured betting pick extractor. Return JSON ONLY.

GAME CONTEXT:
- Home Team: "${context.home_team}"
- Away Team: "${context.away_team}"
- League: ${context.league || "Unknown"}

OUTPUT JSON SCHEMA (STRICT):
{
  "verdict": "PASS" | "BET" | "FADE",
  "pick_type": "spread" | "moneyline" | "total" | "prop" | null,
  "pick_team": "HOME_TEAM_NAME" | "AWAY_TEAM_NAME" | null,
  "pick_direction": "home" | "away" | "over" | "under" | null,
  "pick_line": number | null,
  "confidence": "low" | "medium" | "high",
  "reasoning_summary": "string (<=300 chars)"
}

RULES:
1. "pick_team" MUST exactly match one of: "${context.home_team}" or "${context.away_team}" (use null for Totals only).
2. If verdict is "PASS" or "NO BET", set verdict="PASS" and all pick_* fields null.
3. Totals: pick_type="total", pick_direction="over" or "under", pick_team=null.
4. Spreads: pick_type="spread", pick_team=team name, pick_direction="home" or "away", pick_line=spread value.
5. Moneyline: pick_type="moneyline", pick_team=team name, pick_direction="home" or "away", pick_line=null.
6. Return valid JSON only. No prose.

ANALYSIS TEXT:
${text}
`;

    try {
        const result = await orchestrate("analysis", [
            { role: "system", content: "You extract structured betting picks. Output JSON only." },
            { role: "user", content: extractionPrompt }
        ], {
            gameContext: { home_team: context.home_team, away_team: context.away_team, league: context.league || "Unknown" },
            temperature: 0.2, maxTokens: 600
        });

        const parsed = safeParseJSON(result.content);
        if (!parsed.success) {
            log.warn("[Pick Extraction] JSON parse failed", { provider: result.servedBy });
            return [];
        }

        const validated = BettingPickSchema.safeParse(parsed.data);
        if (!validated.success) {
            log.warn("[Pick Extraction] Schema validation failed", { error: validated.error.message });
            return [];
        }

        const object = validated.data as Record<string, unknown>;

        if (object.verdict === "BET" || object.verdict === "FADE") {
            if (object.pick_type !== "total" && object.pick_team) {
                const pickNorm = (object.pick_team as string || "").toLowerCase().replace(/[^a-z]/g, "");
                const homeNorm = (context.home_team || "").toLowerCase().replace(/[^a-z]/g, "");
                const awayNorm = (context.away_team || "").toLowerCase().replace(/[^a-z]/g, "");

                let matchedTeam: string | null = null;
                if (pickNorm.includes(homeNorm) || homeNorm.includes(pickNorm)) {
                    matchedTeam = context.home_team!;
                } else if (pickNorm.includes(awayNorm) || awayNorm.includes(pickNorm)) {
                    matchedTeam = context.away_team!;
                }

                if (matchedTeam) {
                    object.pick_team = matchedTeam;
                } else if (!object.pick_team) {
                    log.warn("[Pick Extraction] Could not normalize team", { team: String(object.pick_team) });
                    return [];
                }
            }
        }

        return [object];
    } catch (e: unknown) {
        log.error("[Pick Extraction] Failed", { error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

// =============================================================================
// 6. MAIN API ROUTE HANDLER
// =============================================================================

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const parsedReq = ChatRequestSchema.safeParse(req.body);
    if (!parsedReq.success) {
        const rawBody = req.body as unknown;
        const bodyKeys =
            rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
                ? Object.keys(rawBody as Record<string, unknown>).slice(0, 20)
                : [];
        const issuePreview = parsedReq.error.issues.slice(0, 5).map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
            message: issue.message,
        }));
        log.warn("[Chat] Invalid payload format", {
            contentType: req.headers["content-type"] || "",
            bodyType: rawBody === null ? "null" : Array.isArray(rawBody) ? "array" : typeof rawBody,
            bodyKeys,
            issueCount: parsedReq.error.issues.length,
            issuePreview,
        });
        return res.status(400).json({ error: "Invalid payload format", details: parsedReq.error.format() });
    }

    const { messages, conversation_id, gameContext, run_id } = parsedReq.data;
    const currentRunId = run_id || crypto.randomUUID();
    const requestStartMs = Date.now();

    const sse = new SSEWriter(res);
    const abortController = new AbortController();
    const handlerTimeout = setTimeout(() => {
        log.warn("[Chat] Handler timeout reached", {
            run_id: currentRunId,
            timeoutMs: CONFIG.HANDLER_TIMEOUT_MS,
        });
        abortController.abort();
    }, CONFIG.HANDLER_TIMEOUT_MS);

    const onSocketClose = () => abortController.abort();
    req.on("close", onSocketClose);

    try {
        const health = getProviderHealth();
        log.info("[AI:Health]", { run_id: currentRunId, enabled: health.enabled, circuits: health.circuits, costCeiling: health.costCeiling });

        let activeContext: GameContext = normalizeIncomingGameContext(gameContext);
        const lastMsg = messages[messages.length - 1];
        const userQuery = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        const hasImage = Array.isArray(lastMsg?.content) && lastMsg.content.some((c: Record<string, unknown>) => c.type === "image");

        const MODE = detectMode(userQuery, hasImage);
        const taskType = detectTaskType(userQuery, hasImage);

        const [liveScan, homeInjuries, awayInjuries] = await Promise.all([
            scanForLiveGame(userQuery, abortController.signal),
            activeContext.home_team_id ? fetchESPNInjuries(activeContext.home_team_id as string, (activeContext.sport || activeContext.league) as string, abortController.signal) : Promise.resolve({ injuries: [] as InjuryRecord[] }),
            activeContext.away_team_id ? fetchESPNInjuries(activeContext.away_team_id as string, (activeContext.sport || activeContext.league) as string, abortController.signal) : Promise.resolve({ injuries: [] as InjuryRecord[] })
        ]);

        if (liveScan.ok && liveScan.data) {
            activeContext = {
                ...activeContext, ...liveScan.data,
                match_id: liveScan.data.id as string,
                clock: liveScan.data.display_clock as string,
                current_odds: liveScan.data.odds as Record<string, unknown>
            };
        }

        const isLive = ((activeContext?.status as string) || (activeContext?.game_status as string) || "").toUpperCase().includes("IN_PROGRESS") || liveScan.ok;
        const marketPhase = getMarketPhase(activeContext);
        const liveOddsSnapshot = buildLiveOddsSnapshot(activeContext.current_odds);
        const liveLineTokens = buildLiveLineTokens(liveOddsSnapshot);
        const hasLockedLiveOdds = Object.keys(liveOddsSnapshot).length > 0;
        const enforceLiveLineGuard = MODE === "ANALYSIS" && isLive;

        if (enforceLiveLineGuard && !hasLockedLiveOdds) {
            log.warn("[LineGuard] Missing locked live odds", {
                run_id: currentRunId,
                match_id: activeContext.match_id || null,
                home_team: activeContext.home_team || null,
                away_team: activeContext.away_team || null,
            });
            sse.writeEvent("text", {
                content: buildLineGuardMessage(activeContext, liveOddsSnapshot, "NO_LIVE_ODDS"),
            });
            sse.writeDone(CONFIG.MODEL_ID);
            return;
        }

        const lineMovement = calculateLineMovement(activeContext.current_odds, activeContext.t60_snapshot);
        const lineMovementIntel = lineMovement.available && lineMovement.movements
            ? lineMovement.movements.map((m) => `${m.signal} ${m.type}: ${m.direction} ${m.delta}pts`).join(" | ")
            : "";

        const staleWarning = (activeContext.start_time && (Date.now() - new Date(activeContext.start_time as string).getTime() > CONFIG.STALE_THRESHOLD_MS) && !isLive)
            ? "\n⚠️ DATA WARNING: Context may be stale. Verify with Search." : "";

        // 3. Construct System Prompt
        const systemInstruction = `
<temporal>
TODAY: ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}
TIME: ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET
MARKET_PHASE: ${marketPhase}
MODE: ${MODE}
</temporal>

<context>
MATCHUP: ${activeContext?.away_team || "TBD"} @ ${activeContext?.home_team || "TBD"}
${isLive ? `🔴 LIVE: ${activeContext?.away_score ?? 0}-${activeContext?.home_score ?? 0} | ${activeContext?.clock || ""}` : ""}
ODDS: ${safeJsonStringify(activeContext?.current_odds, 600)}
${lineMovementIntel ? `LINE_MOVEMENT: ${lineMovementIntel}` : ""}
INJURIES_HOME: ${safeJsonStringify(homeInjuries.injuries, 400)}
INJURIES_AWAY: ${safeJsonStringify(awayInjuries.injuries, 400)}
${activeContext.t60_snapshot ? `T-60_ODDS: ${safeJsonStringify(activeContext.t60_snapshot.odds, 300)}` : ""}
${staleWarning}
</context>

${enforceLiveLineGuard && hasLockedLiveOdds ? `
<line_lock>
LOCKED_LIVE_BOARD: ${safeJsonStringify(liveOddsSnapshot, 600)}
ALLOWED_LINE_TOKENS: ${liveLineTokens.join(", ")}
HARD RULE:
- In VERDICT and MARKET DYNAMICS, ONLY use line/price values present in LOCKED_LIVE_BOARD.
- If you cannot map your recommendation to those exact values, output VERDICT: LINE_UNAVAILABLE.
</line_lock>
` : ""}

<prime_directive>
You are "The Obsidian Ledger," a forensic sports analyst.

**RULE 1 (ENTITY FIREWALL - STATUS CLAIMS ONLY):**
- For **injury/availability/status claims**, you MUST cite a source [1.x].
- **FALLBACK:** If you cannot verify a player's STATUS, use their role (e.g., "The starting PG") instead of their name. NO GUESSING.

**RULE 2 (CITATION PROTOCOL):**
- Use high-density decimal citations [1.1], [1.2] only when the claim is backed by a verifiable source URL in this run.
- NEVER invent citation IDs.
- If sources are unavailable for a claim, write "Unverified" and do not emit [n.n] tokens.

**RULE 3 (ZERO HALLUCINATION — TOOL-FIRST):**
- Call get_schedule() to discover today's slate. Call get_live_odds(match_id) for current and opening lines.
- For MARKET DYNAMICS, use get_live_odds().line_movement/open/current fields directly.
- If opening data is unavailable, state "Opening line unavailable" and do NOT infer causes.
- NEVER guess game data. If a tool returns an error, acknowledge the data gap.
</prime_directive>

${MODE === "ANALYSIS" ? `
<mode_analysis>
**OUTPUT FORMAT (STRICT - VERDICT FIRST):**

**VERDICT:** [Team/Side] [Line/Price] ([Confidence: High/Med/Low])

**THE EDGE**
(2-3 sentences max. State the market inefficiency directly. No hedging.)

**KEY FACTORS**
- [Factor 1] [1.x]

**MARKET DYNAMICS**
(Use get_live_odds line_movement/open/current values only. If unavailable, explicitly state it. Cite [1.x].)

**WHAT TO WATCH LIVE**
IF [Trigger Condition] → THEN [Action/Adjustment]

**INVALIDATION:** [Exit condition that would void this pick]

**TRIPLE CONFLUENCE**
• Price: [Present/Absent] - [Reason]
• Sentiment: [Present/Absent] - [Reason]
• Structure: [Present/Absent] - [Reason]
</mode_analysis>
` : `
<mode_conversation>
Role: Field Reporter. Direct, factual, concise.
- Answer the question directly.
- Cite only source-backed facts with [1.x]; otherwise mark the claim as Unverified.
</mode_conversation>
`}`;

        // 4. Configure & Initialize Stream
        const recentMessages = messages.slice(-8);
        const isGoogleAvailable = !circuitBreaker.isOpen("google");
        let hadRealContext = Boolean(
            activeContext?.match_id
            || (
                activeContext?.home_team
                && activeContext?.away_team
                && activeContext.home_team !== "TBD"
                && activeContext.away_team !== "TBD"
            )
        );
        const useToolCalling = CONFIG.ENABLE_TOOL_CALLING
            && TOOL_ENABLED_TASK_TYPES.includes(taskType as typeof TOOL_ENABLED_TASK_TYPES[number])
            && isGoogleAvailable;
        const toolRoutingReasons: string[] = [];
        if (!CONFIG.ENABLE_TOOL_CALLING) toolRoutingReasons.push("feature_flag_disabled");
        if (!TOOL_ENABLED_TASK_TYPES.includes(taskType as typeof TOOL_ENABLED_TASK_TYPES[number])) toolRoutingReasons.push("task_type_not_enabled");
        if (!isGoogleAvailable) toolRoutingReasons.push("google_circuit_open");
        log.info("routing_to_chat_handler", {
            trace: currentRunId,
            ms: Date.now() - requestStartMs,
            taskType,
            mode: MODE,
            useToolCalling,
            googleCircuit: health.circuits.google,
            toolCallingModel: CONFIG.TOOL_CALLING_MODEL_ID,
            toolCallingGoogleSearch: TOOL_CALLING_ENABLE_GOOGLE_SEARCH,
            reasons: toolRoutingReasons.length > 0 ? toolRoutingReasons : ["primary"],
        });
        let stream: ReadableStream<Record<string, unknown>>;

        if (useToolCalling) {
            try {
                let toolSystemPrompt: string;

                if (hadRealContext) {
                    toolSystemPrompt = systemInstruction + `\n<tool_guidance>\nYou have access to data tools.\n- Match context is already loaded for this request. PRIORITIZE this matchup first.\n- If match_id is present, call get_live_odds(match_id) directly before any broad slate discovery.\n- Use get_team_injuries/get_team_tempo for the same two teams in context.\n- Do NOT call get_schedule() first unless matchup context is missing or ambiguous.\n- Do NOT guess data.\n</tool_guidance>`;
                } else {
                    toolSystemPrompt = systemInstruction.replace(/<context>[\s\S]*?<\/context>/, `<context>\nNO GAME CONTEXT LOADED. You MUST call tools to get data.\n</context>`)
                        + `\n<tool_guidance>\n** CRITICAL: No game data is pre-loaded. You MUST call tools before responding. **\n1. FIRST: Call get_schedule() to discover today's games.\n</tool_guidance>`;
                }

                const initialContents = recentMessages.filter((m) => m.role !== "system").map((m) => ({
                    role: m.role === "assistant" ? "model" : "user",
                    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }]
                }));

                const toolContext = { supabase, matchId: activeContext?.match_id || null, signal: abortController.signal, requestId: currentRunId };
                const toolCache = new ToolResultCache();

                let toolRound = 0;
                const chatStreamFn = async (contents: Array<Record<string, unknown>>) => {
                    if (circuitBreaker.isOpen("google")) {
                        throw new Error("Google tool-calling circuit is open");
                    }
                    toolRound++;

                    const executeWithModel = async (
                        model: string,
                        isFallback: boolean,
                        reason: string,
                        primaryModel?: string,
                    ) => {
                        const callStartMs = Date.now();
                        log.info("model_selected", {
                            trace: currentRunId,
                            ms: callStartMs - requestStartMs,
                            event: "model_selected",
                            model,
                            intent: taskType,
                            isFallback,
                            primaryModel,
                            reason,
                        });

                        const res = await googleClient.chatStreamRaw(contents, {
                            model,
                            messages: [],
                            temperature: taskType === "analysis" ? 0.5 : 0.7,
                            maxTokens: taskType === "analysis" ? 8000 : 2000,
                            signal: abortController.signal,
                            retries: 1,
                            // Function-calling + Google Search is not stable across all Gemini model/endpoints.
                            // Default to function-only tool turns; grounding search remains available in fallback path.
                            enableGrounding: TOOL_CALLING_ENABLE_GOOGLE_SEARCH && taskType === "grounding",
                            tools: {
                                functionDeclarations: FUNCTION_DECLARATIONS,
                                enableGrounding: TOOL_CALLING_ENABLE_GOOGLE_SEARCH && taskType === "grounding",
                            },
                            toolConfig: toolRound === 1 && !hadRealContext ? { functionCallingConfig: { mode: "ANY" } } : TOOL_CONFIG,
                            // Gemini 2.5 rejects thinkingLevel (expects thinkingBudget).
                            // Gate by model family to prevent parameter bleed on fallback models.
                            thinkingLevel: isGemini3Model(model)
                                ? (taskType === "analysis" ? "HIGH" : "MEDIUM")
                                : undefined,
                            systemInstruction: toolSystemPrompt,
                        });

                        log.info("model_response_received", {
                            trace: currentRunId,
                            ms: Date.now() - requestStartMs,
                            event: "model_response_received",
                            model,
                            intent: taskType,
                            inputTokens: null,
                            outputTokens: null,
                            latencyMs: Date.now() - callStartMs,
                        });

                        return res;
                    };

                    const isFunctionCallingUnsupported = (error: unknown): boolean => {
                        const message = error instanceof Error ? error.message : String(error);
                        return /tool use with function calling is unsupported by the model/i.test(message)
                            || /function calling is unsupported by the model/i.test(message);
                    };

                    try {
                        const primaryRes = await executeWithModel(CONFIG.TOOL_CALLING_MODEL_ID, false, "primary");
                        circuitBreaker.recordSuccess("google");
                        return primaryRes;
                    } catch (primaryError: unknown) {
                        if (
                            CONFIG.TOOL_CALLING_MODEL_ID !== TOOL_CALLING_COMPAT_MODEL_ID
                            && isFunctionCallingUnsupported(primaryError)
                        ) {
                            log.warn("tool_model_incompatible_fallback", {
                                trace: currentRunId,
                                primaryModel: CONFIG.TOOL_CALLING_MODEL_ID,
                                fallbackModel: TOOL_CALLING_COMPAT_MODEL_ID,
                            });

                            try {
                                const fallbackRes = await executeWithModel(
                                    TOOL_CALLING_COMPAT_MODEL_ID,
                                    true,
                                    "primary_model_tool_unsupported",
                                    CONFIG.TOOL_CALLING_MODEL_ID,
                                );
                                circuitBreaker.recordSuccess("google");
                                return fallbackRes;
                            } catch (fallbackError: unknown) {
                                const fallbackErrorType = typeof fallbackError === "object" && fallbackError !== null && "errorType" in fallbackError
                                    ? String((fallbackError as { errorType?: unknown }).errorType)
                                    : undefined;
                                circuitBreaker.recordFailure("google", fallbackErrorType);
                                throw fallbackError;
                            }
                        }

                        const primaryErrorType = typeof primaryError === "object" && primaryError !== null && "errorType" in primaryError
                            ? String((primaryError as { errorType?: unknown }).errorType)
                            : undefined;
                        circuitBreaker.recordFailure("google", primaryErrorType);
                        throw primaryError;
                    }
                };

                stream = createToolCallingStream(chatStreamFn, initialContents, { provider: "google", model: CONFIG.TOOL_CALLING_MODEL_ID, supportsGrounding: true } as Record<string, unknown>, toolCache, toolContext, Date.now(), currentRunId) as ReadableStream<Record<string, unknown>>;
            } catch (toolErr) {
                log.warn("Tool setup failed, falling back", { error: String(toolErr) });
                stream = await orchestrateStream(taskType, recentMessages as Array<{ role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> }>, {
                    gameContext: activeContext,
                    systemPrompt: systemInstruction,
                    signal: abortController.signal,
                    traceId: currentRunId,
                    intent: taskType,
                    requestStartMs,
                }) as unknown as ReadableStream<Record<string, unknown>>;
            }
        } else {
            stream = await orchestrateStream(taskType, recentMessages as Array<{ role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> }>, {
                gameContext: activeContext,
                systemPrompt: systemInstruction,
                signal: abortController.signal,
                traceId: currentRunId,
                intent: taskType,
                requestStartMs,
            }) as unknown as ReadableStream<Record<string, unknown>>;
        }

        // 5. Stream Consumption
        const deferTextFlush = MODE === "ANALYSIS" || enforceLiveLineGuard;
        let fullText = "", rawThoughts = "", finalMetadata: Record<string, unknown> | null = null, servedModel: string | null = null, streamErrorOnly = false;

        async function consumeStream(readableStream: ReadableStream<Record<string, unknown>>) {
            const reader = readableStream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (!value) continue;

                    if (!servedModel && value.model) servedModel = value.model as string;

                    if (value.type === "grounding" && value.metadata) {
                        finalMetadata = value.metadata as Record<string, unknown>;
                        sse.writeEvent("grounding", { metadata: finalMetadata });
                    } else if (value.type === "thought") {
                        rawThoughts += (value.content as string) || "";
                        if (!enforceLiveLineGuard) sse.writeEvent("thought", { content: value.content });
                    } else if (value.type === "text") {
                        fullText += (value.content as string) || "";
                        if (!deferTextFlush) sse.writeEvent("text", { content: value.content });
                    } else if (value.type === "tool_status") {
                        sse.writeEvent("tool_status", { tools: value.tools, status: value.status });
                    } else if (value.type === "error") {
                        if (!fullText && !rawThoughts) streamErrorOnly = true;
                    }
                }
            } finally {
                try { reader.releaseLock(); } catch { /* noop */ }
            }
        }

        await consumeStream(stream);

        if (streamErrorOnly && useToolCalling && !fullText) {
            log.warn("Tool stream error-only, executing multi-provider orchestrateStream fallback", { run_id: currentRunId });
            streamErrorOnly = false;
            const fallbackTaskType = (!hadRealContext && taskType === "analysis") ? "grounding" : taskType;
            const fallbackSystemPrompt = `${systemInstruction}
<tool_guidance>
[SYSTEM ALERT: Internal data tools are unavailable for this request. Use native web search/grounding only and do not fabricate internal tool outputs.]
[CITATION CONTRACT: Use [n.n] only for claims backed by real source URLs in this response. If not source-backed, mark as Unverified and omit bracket citations.]
[REQUIRED: If matchup context is missing, first identify today's relevant game from web search, then continue with concrete teams/odds.]
</tool_guidance>`;
            const fallbackStream = await orchestrateStream(
                fallbackTaskType as TaskType,
                recentMessages as Array<{ role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> }>,
                {
                    gameContext: activeContext,
                    systemPrompt: fallbackSystemPrompt,
                    signal: abortController.signal,
                    traceId: currentRunId,
                    intent: fallbackTaskType,
                    requestStartMs,
                }
            ) as unknown as ReadableStream<Record<string, unknown>>;
            await consumeStream(fallbackStream);
        }

        if (fullText) {
            const citationIntegrity = sanitizeCitationsForAvailableSources(fullText, finalMetadata);
            if (citationIntegrity.hadCitations && citationIntegrity.sourceCount === 0) {
                log.warn("[CitationGuard] Removed bracket citations due to missing source ledger", {
                    run_id: currentRunId,
                    model: servedModel || CONFIG.MODEL_ID,
                });
            } else if (citationIntegrity.changed) {
                log.warn("[CitationGuard] Removed out-of-range citation IDs", {
                    run_id: currentRunId,
                    model: servedModel || CONFIG.MODEL_ID,
                    sourceCount: citationIntegrity.sourceCount,
                });
            }
            fullText = citationIntegrity.text;
        }

        if (enforceLiveLineGuard && fullText) {
            const lineMatched = responseContainsLockedLine(fullText, liveLineTokens);
            if (!lineMatched) {
                log.warn("[LineGuard] Generated line mismatch", {
                    run_id: currentRunId,
                    match_id: activeContext.match_id || null,
                    lockedLines: liveOddsSnapshot,
                });
                fullText = buildLineGuardMessage(activeContext, liveOddsSnapshot, "LINE_MISMATCH");
                rawThoughts = "";
                finalMetadata = null;
            }
        }

        if (deferTextFlush && fullText) {
            sse.writeEvent("text", { content: fullText });
        }

        if (!fullText && !rawThoughts) {
            sse.writeError("All providers unavailable. Please retry shortly.");
        } else {
            sse.writeDone(servedModel || CONFIG.MODEL_ID);
        }

        // 6. Concurrent Non-Blocking Teardown & Persistence
        const backgroundTasks: Promise<unknown>[] = [];

        if (MODE === "ANALYSIS" && fullText) {
            const map = buildClaimMap(fullText, rawThoughts);
            const gate = gateDecision(map, true);

            backgroundTasks.push(
                (async () => {
                    await supabase.from("ai_chat_runs").upsert({
                        id: currentRunId, conversation_id, confluence_met: gate.approved, confluence_score: gate.score,
                        verdict: map.verdict, confidence: map.confidence, gate_reason: gate.reason,
                        match_context: activeContext?.match_id ? { id: activeContext.match_id, home: activeContext.home_team, away: activeContext.away_team } : null
                    }, { onConflict: "id" });

                    if (gate.approved && map.verdict && map.verdict !== "PASS") {
                        const picks = await extractPickStructured(fullText, activeContext);
                        if (picks.length > 0) {
                            await supabase.from("ai_chat_picks").insert(picks.map((p) => ({
                                run_id: currentRunId, conversation_id, match_id: activeContext?.match_id,
                                home_team: activeContext?.home_team, away_team: activeContext?.away_team, league: activeContext?.league,
                                pick_type: p.pick_type, pick_side: p.pick_type === "total" ? (p.pick_direction as string)?.toUpperCase() : p.pick_team,
                                pick_line: p.pick_line, ai_confidence: p.confidence || map.confidence,
                                model_id: servedModel || CONFIG.MODEL_ID, reasoning_summary: p.reasoning_summary, extraction_method: "structured_v26_enhanced"
                            })));
                        }
                    }
                })()
            );
        }

        if (conversation_id && fullText) {
            const sources = (finalMetadata?.groundingChunks as Array<{ web?: { title: string; uri: string } }> || [])
                .map((c) => ({ title: c.web?.title, uri: c.web?.uri }))
                .filter((s) => s.uri) || [];
            backgroundTasks.push(
                supabase.from("conversations").update({
                    messages: [...messages, { role: "assistant", content: fullText, thoughts: rawThoughts, groundingMetadata: finalMetadata, sources, model: servedModel || CONFIG.MODEL_ID }].slice(-40),
                    last_message_at: new Date().toISOString()
                }).eq("id", conversation_id)
            );
        }

        if (backgroundTasks.length > 0) {
            await Promise.allSettled(backgroundTasks);
        }

    } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") {
            log.error("[Chat Handler] Critical Error:", { error: e.message });
            sse.writeError(e.message || "An unexpected error occurred.");
        }
    } finally {
        clearTimeout(handlerTimeout);
        req.removeListener("close", onSocketClose);
        if (!(res as unknown as { writableEnded: boolean }).writableEnded) res.end();
    }
}
