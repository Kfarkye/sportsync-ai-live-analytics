declare const Deno: any;

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { executeAnalyticalQuery, safeJsonParse } from "../_shared/gemini.ts";
import {
  getRequestId,
  jsonResponse,
  safeJsonBody,
  type TimingMetric,
  weakEtag,
} from "../_shared/http.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CACHE_TTL_MS = 45_000;
const MODEL = "gemini-3-flash-preview";

type NumericLike = number | string | null | undefined;

type LiveStat = {
  label?: string;
  home?: NumericLike;
  away?: NumericLike;
};

type KeyEvent = {
  time?: string;
  type?: string;
  detail?: string;
};

type Leader = {
  player?: string;
  stat?: string;
  value?: NumericLike;
};

type SnapshotPayload = {
  home_team?: string;
  away_team?: string;
  home_score?: NumericLike;
  away_score?: NumericLike;
  score?: string;
  clock?: string;
  period?: NumericLike;
  status?: string;
  market_total?: NumericLike;
  fair_total?: NumericLike;
  spread?: NumericLike;
};

type RequestBody = {
  match_id?: string;
  sport?: string;
  league_id?: string;
  snapshot?: SnapshotPayload;
  live_stats?: LiveStat[];
  key_events?: KeyEvent[];
  leaders?: Leader[];
};

type CardPayload = {
  headline: string;
  thesis: string;
  confidence: number;
  lean: "OVER" | "UNDER" | "HOME" | "AWAY" | "PASS";
  market: "TOTAL" | "SPREAD" | "MONEYLINE";
  drivers: string[];
  watchouts: string[];
};

type CachedEntry = {
  expiresAt: number;
  response: {
    success: true;
    state_hash: string;
    cached: boolean;
    generated_at: string;
    card: CardPayload;
    odds_context: {
      snapshots_table: string | null;
      snapshots_count: number;
      latest_total: number | null;
      move_5m: number | null;
      move_15m: number | null;
    };
  };
};

const responseCache = new Map<string, CachedEntry>();

const CARD_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    thesis: { type: "string" },
    confidence: { type: "number" },
    lean: { type: "string", enum: ["OVER", "UNDER", "HOME", "AWAY", "PASS"] },
    market: { type: "string", enum: ["TOTAL", "SPREAD", "MONEYLINE"] },
    drivers: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
    watchouts: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
  },
  required: [
    "headline",
    "thesis",
    "confidence",
    "lean",
    "market",
    "drivers",
    "watchouts",
  ],
} as const;

const SYSTEM_PROMPT = `You are a live betting intelligence analyst.
Return exactly one concise, actionable analysis card.
Rules:
- Use only provided live context and odds movement data.
- Do not invent injuries, news, or stats.
- If evidence is weak or mixed, return lean PASS.
- Confidence is 0-100 and should be conservative.
- Keep thesis under 45 words.
- Drivers/watchouts must be concrete and data-linked.
Output strictly valid JSON matching the schema.`;

function parseNumber(value: NumericLike): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[^0-9+.-]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeText(value: unknown, fallback = "—"): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function buildStateHash(matchId: string, body: RequestBody): string {
  const statsSeed = (body.live_stats ?? [])
    .slice(0, 12)
    .map((s) => `${normalizeText(s.label, "")}:${normalizeText(s.home, "")}-${normalizeText(s.away, "")}`)
    .join("|");

  const seed = JSON.stringify({
    match_id: matchId,
    score: normalizeText(body.snapshot?.score, ""),
    home_score: parseNumber(body.snapshot?.home_score),
    away_score: parseNumber(body.snapshot?.away_score),
    clock: normalizeText(body.snapshot?.clock, ""),
    period: parseNumber(body.snapshot?.period),
    market_total: parseNumber(body.snapshot?.market_total),
    fair_total: parseNumber(body.snapshot?.fair_total),
    stats: statsSeed,
  });

  return weakEtag(seed);
}

function parseSnapshotTotal(row: Record<string, unknown>): number | null {
  const candidates = [
    row.total_line,
    row.total,
    row.market_total,
    row.over_under,
    row.total_value,
    row.current_total,
  ];

  for (const value of candidates) {
    const parsed = parseNumber(value as NumericLike);
    if (parsed !== null) return parsed;
  }

  return null;
}

function parseSnapshotTimestamp(row: Record<string, unknown>): number | null {
  const candidates = [
    row.captured_at,
    row.snapshot_at,
    row.created_at,
    row.inserted_at,
  ];

  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }

  return null;
}

function computeMoves(rows: Array<Record<string, unknown>>): {
  latestTotal: number | null;
  move5m: number | null;
  move15m: number | null;
} {
  const parsed = rows
    .map((row) => ({
      ts: parseSnapshotTimestamp(row),
      total: parseSnapshotTotal(row),
    }))
    .filter((row) => row.ts !== null && row.total !== null)
    .sort((a, b) => (a.ts as number) - (b.ts as number));

  if (parsed.length === 0) {
    return { latestTotal: null, move5m: null, move15m: null };
  }

  const latest = parsed[parsed.length - 1];
  const nowTs = latest.ts as number;

  const findAnchor = (windowMs: number): number | null => {
    for (let index = parsed.length - 1; index >= 0; index -= 1) {
      const row = parsed[index];
      if ((nowTs - (row.ts as number)) >= windowMs) return row.total as number;
    }
    return parsed[0]?.total ?? null;
  };

  const anchor5 = findAnchor(5 * 60_000);
  const anchor15 = findAnchor(15 * 60_000);

  return {
    latestTotal: latest.total as number,
    move5m: anchor5 !== null ? (latest.total as number) - anchor5 : null,
    move15m: anchor15 !== null ? (latest.total as number) - anchor15 : null,
  };
}

function topStatDrivers(stats: LiveStat[]): string[] {
  return stats
    .map((stat) => {
      const home = parseNumber(stat.home);
      const away = parseNumber(stat.away);
      if (home === null || away === null) return null;
      const delta = Math.abs(home - away);
      if (delta <= 0) return null;
      return {
        label: normalizeText(stat.label, "Stat"),
        home,
        away,
        delta,
      };
    })
    .filter((entry): entry is { label: string; home: number; away: number; delta: number } => Boolean(entry))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 2)
    .map((entry) => `${entry.label}: ${entry.home} vs ${entry.away}`);
}

function fallbackCard(body: RequestBody, moves: { move5m: number | null; move15m: number | null }): CardPayload {
  const marketTotal = parseNumber(body.snapshot?.market_total);
  const fairTotal = parseNumber(body.snapshot?.fair_total);
  const edge = marketTotal !== null && fairTotal !== null ? fairTotal - marketTotal : null;

  const liveStats = body.live_stats ?? [];
  const drivers = topStatDrivers(liveStats);

  let lean: CardPayload["lean"] = "PASS";
  if (edge !== null && edge >= 1.5) lean = "OVER";
  if (edge !== null && edge <= -1.5) lean = "UNDER";

  const confidence = edge === null ? 46 : Math.max(48, Math.min(78, Math.round(50 + Math.abs(edge) * 8)));

  return {
    headline: lean === "PASS" ? "Live Market Is Balanced" : `Live ${lean} Edge Is Emerging`,
    thesis:
      edge === null
        ? "Insufficient price separation between fair total and market total. Wait for a stronger state change."
        : `Fair total is ${fairTotal?.toFixed(1)} versus market ${marketTotal?.toFixed(1)} (${edge > 0 ? "+" : ""}${edge.toFixed(1)}).`,
    confidence,
    lean,
    market: "TOTAL",
    drivers:
      drivers.length > 0
        ? drivers
        : ["No decisive stat dominance in current sample."],
    watchouts: [
      moves.move5m !== null
        ? `5m total move: ${moves.move5m > 0 ? "+" : ""}${moves.move5m.toFixed(1)}`
        : "No short-window line movement sample yet.",
      "Re-evaluate at next scoring or major possession swing.",
    ],
  };
}

function sanitizeCard(payload: unknown): CardPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const card = payload as Record<string, unknown>;

  const lean = normalizeText(card.lean, "PASS").toUpperCase();
  const market = normalizeText(card.market, "TOTAL").toUpperCase();
  const confidence = parseNumber(card.confidence) ?? 50;
  const drivers = Array.isArray(card.drivers)
    ? card.drivers.map((item) => normalizeText(item, "")).filter(Boolean)
    : [];
  const watchouts = Array.isArray(card.watchouts)
    ? card.watchouts.map((item) => normalizeText(item, "")).filter(Boolean)
    : [];

  if (!["OVER", "UNDER", "HOME", "AWAY", "PASS"].includes(lean)) return null;
  if (!["TOTAL", "SPREAD", "MONEYLINE"].includes(market)) return null;

  return {
    headline: normalizeText(card.headline, "Live Intelligence"),
    thesis: normalizeText(card.thesis, "No clear edge at this state."),
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    lean: lean as CardPayload["lean"],
    market: market as CardPayload["market"],
    drivers: drivers.slice(0, 4),
    watchouts: watchouts.slice(0, 3),
  };
}

function formatPrompt(
  body: RequestBody,
  oddsInfo: { latestTotal: number | null; move5m: number | null; move15m: number | null; table: string | null; count: number },
): string {
  const snapshot = body.snapshot ?? {};
  const statsLines = (body.live_stats ?? [])
    .slice(0, 12)
    .map((s) => `- ${normalizeText(s.label, "Stat")}: H ${normalizeText(s.home, "—")} | A ${normalizeText(s.away, "—")}`)
    .join("\n");

  const eventLines = (body.key_events ?? [])
    .slice(0, 8)
    .map((event) => `- ${normalizeText(event.time, "—")} ${normalizeText(event.type, "event")}: ${normalizeText(event.detail, "")}`)
    .join("\n");

  const leaderLines = (body.leaders ?? [])
    .slice(0, 6)
    .map((leader) => `- ${normalizeText(leader.player, "Player")} ${normalizeText(leader.stat, "stat")}: ${normalizeText(leader.value, "—")}`)
    .join("\n");

  return `
MATCH: ${normalizeText(snapshot.away_team, "Away")} @ ${normalizeText(snapshot.home_team, "Home")}
STATE:
- Score: ${normalizeText(snapshot.score, `${normalizeText(snapshot.away_score, "0")}-${normalizeText(snapshot.home_score, "0")}`)}
- Clock: ${normalizeText(snapshot.clock, "0:00")} | Period: ${normalizeText(snapshot.period, "1")}
- Market total: ${normalizeText(snapshot.market_total, "—")}
- Fair total: ${normalizeText(snapshot.fair_total, "—")}
- Spread: ${normalizeText(snapshot.spread, "—")}

ODDS SNAPSHOT CONTEXT:
- Table: ${oddsInfo.table ?? "none"}
- Snapshot count: ${oddsInfo.count}
- Latest total in snapshots: ${oddsInfo.latestTotal !== null ? oddsInfo.latestTotal.toFixed(1) : "—"}
- 5m total move: ${oddsInfo.move5m !== null ? `${oddsInfo.move5m > 0 ? "+" : ""}${oddsInfo.move5m.toFixed(1)}` : "—"}
- 15m total move: ${oddsInfo.move15m !== null ? `${oddsInfo.move15m > 0 ? "+" : ""}${oddsInfo.move15m.toFixed(1)}` : "—"}

LIVE STATS:
${statsLines || "- none"}

KEY EVENTS:
${eventLines || "- none"}

LEADERS:
${leaderLines || "- none"}

Write one sharp card for bettors.`;
}

async function fetchOddsSnapshots(
  supabase: ReturnType<typeof createClient>,
  matchId: string,
): Promise<{ table: string | null; rows: Array<Record<string, unknown>> }> {
  const tables = ["soccer_live_odds_snapshots", "live_odds_snapshots"];

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("match_id", matchId)
      .order("captured_at", { ascending: false })
      .limit(60);

    if (error) continue;
    if (data && data.length > 0) {
      return {
        table,
        rows: data as Array<Record<string, unknown>>,
      };
    }
  }

  return { table: null, rows: [] };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const requestId = getRequestId(req);
  const timings: TimingMetric[] = [];
  const startedAt = Date.now();

  try {
    if (req.method !== "POST") {
      return jsonResponse(
        { success: false, error: "Method not allowed" },
        { status: 405, cors: CORS_HEADERS, requestId },
      );
    }

    const parsedBody = await safeJsonBody<RequestBody>(req, 96 * 1024);
    if (!parsedBody.ok) {
      return jsonResponse(
        { success: false, error: parsedBody.error },
        { status: 400, cors: CORS_HEADERS, requestId },
      );
    }

    const body = parsedBody.value ?? {};
    const matchId = normalizeText(body.match_id, "");
    if (!matchId) {
      return jsonResponse(
        { success: false, error: "match_id is required" },
        { status: 400, cors: CORS_HEADERS, requestId },
      );
    }

    const stateHash = buildStateHash(matchId, body);
    const now = Date.now();
    const cached = responseCache.get(stateHash);
    if (cached && cached.expiresAt > now) {
      const cachedResponse = {
        ...cached.response,
        cached: true,
      };
      return jsonResponse(cachedResponse, {
        cors: CORS_HEADERS,
        requestId,
        cacheControl: "private, max-age=20",
        timings: [
          {
            name: "total",
            dur: Date.now() - startedAt,
            desc: "cache-hit",
          },
        ],
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const snapshotStart = Date.now();
    const snapshots = await fetchOddsSnapshots(supabase, matchId);
    timings.push({ name: "snapshots", dur: Date.now() - snapshotStart });

    const moves = computeMoves(snapshots.rows);
    const prompt = formatPrompt(body, {
      latestTotal: moves.latestTotal,
      move5m: moves.move5m,
      move15m: moves.move15m,
      table: snapshots.table,
      count: snapshots.rows.length,
    });

    const llmStart = Date.now();
    let card: CardPayload | null = null;
    try {
      const llmResult = await executeAnalyticalQuery(prompt, {
        model: MODEL,
        systemInstruction: SYSTEM_PROMPT,
        responseSchema: CARD_SCHEMA,
        thinkingLevel: "medium",
        maxOutputTokens: 1100,
      });
      card = sanitizeCard(safeJsonParse(llmResult.rawText || llmResult.text));
    } catch {
      card = null;
    }
    timings.push({ name: "llm", dur: Date.now() - llmStart });

    if (!card) {
      card = fallbackCard(body, {
        move5m: moves.move5m,
        move15m: moves.move15m,
      });
    }

    const response = {
      success: true as const,
      state_hash: stateHash,
      cached: false,
      generated_at: new Date().toISOString(),
      card,
      odds_context: {
        snapshots_table: snapshots.table,
        snapshots_count: snapshots.rows.length,
        latest_total: moves.latestTotal,
        move_5m: moves.move5m,
        move_15m: moves.move15m,
      },
    };

    responseCache.set(stateHash, {
      expiresAt: now + CACHE_TTL_MS,
      response,
    });

    timings.push({ name: "total", dur: Date.now() - startedAt });
    return jsonResponse(response, {
      cors: CORS_HEADERS,
      requestId,
      cacheControl: "private, max-age=20",
      timings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    timings.push({ name: "total", dur: Date.now() - startedAt });
    return jsonResponse(
      { success: false, error: message },
      {
        status: 500,
        cors: CORS_HEADERS,
        requestId,
        timings,
      },
    );
  }
});

