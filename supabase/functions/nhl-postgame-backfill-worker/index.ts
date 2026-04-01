declare const Deno: any;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ESPN_SUMMARY_ROOT = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary";
const DEFAULT_FROM = "2025-10-08T00:00:00Z";
const DEFAULT_TO = "2025-10-23T00:00:00Z"; // exclusive upper bound
const DEFAULT_BATCH_SIZE = 15;
const MAX_BATCH_SIZE = 30;
const DEFAULT_SCAN_LIMIT = 220;
const MAX_SCAN_LIMIT = 500;
const FETCH_TIMEOUT_MS = 12000;
const BETWEEN_REQUEST_DELAY_MS = 500;
const DRAIN_VERSION = "v1-backfill-worker";

type CandidateRow = {
  id: string;
  start_time: string;
  status: string | null;
  home_team: string | null;
  away_team: string | null;
  canonical_game_id: string | null;
};

type WorkerRequest = {
  from: string;
  to: string;
  batch_size: number;
  scan_limit: number;
  force: boolean;
  dry_run: boolean;
  continue_on_error: boolean;
};

function ensureEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseIsoDate(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO date: ${raw}`);
  }
  return parsed.toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const cleaned = text.replace(/[^\d+.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntSafe(value: unknown): number | null {
  const n = parseNum(value);
  return n === null ? null : Math.trunc(n);
}

function parseOverUnderLine(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  const parsed = Number.parseFloat(text.replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function statMap(teamStats: any): Map<string, string> {
  const map = new Map<string, string>();
  const stats = Array.isArray(teamStats?.statistics) ? teamStats.statistics : [];
  for (const stat of stats) {
    const key = String(stat?.name ?? "").trim();
    const value = String(stat?.displayValue ?? "").trim();
    if (key) map.set(key, value);
  }
  return map;
}

function statInt(stats: Map<string, string>, key: string): number | null {
  return parseIntSafe(stats.get(key));
}

function statFloat(stats: Map<string, string>, key: string): number | null {
  return parseNum(stats.get(key));
}

function pickcenterOdds(data: any): any | null {
  const pick = Array.isArray(data?.pickcenter) && data.pickcenter.length > 0 ? data.pickcenter[0] : null;
  if (pick) return pick;

  const competition = data?.header?.competitions?.[0];
  const odds = Array.isArray(competition?.odds) && competition.odds.length > 0 ? competition.odds[0] : null;
  return odds ?? null;
}

function buildPostgamePayload(match: CandidateRow, data: any) {
  const eventId = String(match.id).split("_")[0];
  const competition = data?.header?.competitions?.[0] ?? null;
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = competitors.find((c: any) => c?.homeAway === "home") ?? competitors[0] ?? null;
  const away = competitors.find((c: any) => c?.homeAway === "away") ?? competitors[1] ?? null;

  const homeScore = parseIntSafe(home?.score);
  const awayScore = parseIntSafe(away?.score);
  const matchStatus = String(
    competition?.status?.type?.name ??
      data?.header?.competitions?.[0]?.status?.type?.name ??
      match.status ??
      "STATUS_FINAL",
  );

  const gameInfo = data?.gameInfo ?? {};
  const teams = Array.isArray(data?.boxscore?.teams) ? data.boxscore.teams : [];
  const homeBox = teams.find((t: any) => t?.homeAway === "home") ?? null;
  const awayBox = teams.find((t: any) => t?.homeAway === "away") ?? null;
  const homeStats = statMap(homeBox);
  const awayStats = statMap(awayBox);

  const pick = pickcenterOdds(data);

  const dkHomeMl = parseIntSafe(pick?.homeTeamOdds?.moneyLine ?? pick?.moneyline?.home?.close?.odds);
  const dkAwayMl = parseIntSafe(pick?.awayTeamOdds?.moneyLine ?? pick?.moneyline?.away?.close?.odds);
  const dkSpread =
    parseNum(pick?.spread) ??
    parseNum(pick?.pointSpread?.home?.close?.line) ??
    parseNum(pick?.pointSpread?.away?.close?.line);
  const dkTotal = parseNum(pick?.overUnder) ?? parseOverUnderLine(pick?.total?.over?.close?.line);
  const dkOverPrice = parseIntSafe(pick?.overOdds ?? pick?.total?.over?.close?.odds);
  const dkUnderPrice = parseIntSafe(pick?.underOdds ?? pick?.total?.under?.close?.odds);

  return {
    id: match.id,
    espn_event_id: eventId,
    home_team: home?.team?.displayName ?? match.home_team ?? null,
    away_team: away?.team?.displayName ?? match.away_team ?? null,
    home_score: homeScore,
    away_score: awayScore,
    match_status: matchStatus,
    start_time: match.start_time,
    venue: gameInfo?.venue?.fullName ?? null,
    attendance: parseIntSafe(gameInfo?.attendance),
    home_shots: statInt(homeStats, "shotsTotal"),
    away_shots: statInt(awayStats, "shotsTotal"),
    home_blocked_shots: statInt(homeStats, "blockedShots"),
    away_blocked_shots: statInt(awayStats, "blockedShots"),
    home_hits: statInt(homeStats, "hits"),
    away_hits: statInt(awayStats, "hits"),
    home_giveaways: statInt(homeStats, "giveaways"),
    away_giveaways: statInt(awayStats, "giveaways"),
    home_takeaways: statInt(homeStats, "takeaways"),
    away_takeaways: statInt(awayStats, "takeaways"),
    home_faceoffs_won: statInt(homeStats, "faceoffsWon"),
    away_faceoffs_won: statInt(awayStats, "faceoffsWon"),
    home_faceoff_pct: statFloat(homeStats, "faceoffPercent"),
    away_faceoff_pct: statFloat(awayStats, "faceoffPercent"),
    home_pp_goals: statInt(homeStats, "powerPlayGoals"),
    away_pp_goals: statInt(awayStats, "powerPlayGoals"),
    home_pp_opportunities: statInt(homeStats, "powerPlayOpportunities"),
    away_pp_opportunities: statInt(awayStats, "powerPlayOpportunities"),
    home_pp_pct: statFloat(homeStats, "powerPlayPct"),
    away_pp_pct: statFloat(awayStats, "powerPlayPct"),
    home_shg: statInt(homeStats, "shortHandedGoals"),
    away_shg: statInt(awayStats, "shortHandedGoals"),
    home_shootout_goals: statInt(homeStats, "shootoutGoals"),
    away_shootout_goals: statInt(awayStats, "shootoutGoals"),
    home_penalty_min: statInt(homeStats, "penaltyMinutes"),
    away_penalty_min: statInt(awayStats, "penaltyMinutes"),
    home_total_penalties: statInt(homeStats, "penalties"),
    away_total_penalties: statInt(awayStats, "penalties"),
    dk_home_ml: dkHomeMl,
    dk_away_ml: dkAwayMl,
    dk_spread: dkSpread,
    dk_total: dkTotal,
    dk_over_price: dkOverPrice,
    dk_under_price: dkUnderPrice,
    drain_version: DRAIN_VERSION,
    last_drained_at: new Date().toISOString(),
    canonical_game_id: match.canonical_game_id ?? null,
  };
}

async function fetchSummary(eventId: string) {
  const url = `${ESPN_SUMMARY_ROOT}?event=${eventId}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(`summary ${eventId} failed (${response.status}): ${response.statusText}`);
  }
  return body;
}

function parseRequest(request: Request, body: Record<string, unknown>): WorkerRequest {
  const query = new URL(request.url).searchParams;

  const from = parseIsoDate(body.from ?? query.get("from"), DEFAULT_FROM);
  const to = parseIsoDate(body.to ?? query.get("to"), DEFAULT_TO);
  if (from >= to) {
    throw new Error('"from" must be earlier than "to"');
  }

  return {
    from,
    to,
    batch_size: parseInteger(body.batch_size ?? query.get("batch_size"), DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
    scan_limit: parseInteger(body.scan_limit ?? query.get("scan_limit"), DEFAULT_SCAN_LIMIT, 20, MAX_SCAN_LIMIT),
    force: parseBoolean(body.force ?? query.get("force"), false),
    dry_run: parseBoolean(body.dry_run ?? query.get("dry_run"), false),
    continue_on_error: parseBoolean(body.continue_on_error ?? query.get("continue_on_error"), true),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST" && request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    ensureEnv();
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const req = parseRequest(request, body);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: scannedRows, error: scanError } = await supabase
      .from("matches")
      .select("id,start_time,status,home_team,away_team,canonical_game_id")
      .eq("league_id", "nhl")
      .eq("status", "STATUS_FINAL")
      .gte("start_time", req.from)
      .lt("start_time", req.to)
      .order("start_time", { ascending: true })
      .limit(req.scan_limit);

    if (scanError) {
      throw new Error(`matches scan failed: ${scanError.message}`);
    }

    const candidates = (scannedRows ?? []) as CandidateRow[];
    const ids = candidates.map((row) => row.id);

    let existingIds = new Set<string>();
    if (!req.force && ids.length > 0) {
      const { data: existing, error: existingError } = await supabase
        .from("nhl_postgame")
        .select("id")
        .in("id", ids);
      if (existingError) {
        throw new Error(`nhl_postgame existing check failed: ${existingError.message}`);
      }
      existingIds = new Set((existing ?? []).map((row: any) => String(row.id)));
    }

    const missing = req.force ? candidates : candidates.filter((row) => !existingIds.has(row.id));
    const queue = missing.slice(0, req.batch_size);

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];
    const upsertRows: any[] = [];

    for (const item of queue) {
      processed += 1;
      const eventId = String(item.id).split("_")[0];
      try {
        const summary = await fetchSummary(eventId);
        const payload = buildPostgamePayload(item, summary);
        upsertRows.push(payload);
        succeeded += 1;
      } catch (error: any) {
        failed += 1;
        errors.push({
          id: item.id,
          error: (error?.message ?? String(error)).slice(0, 300),
        });
        if (!req.continue_on_error) break;
      }

      if (processed < queue.length) {
        await sleep(BETWEEN_REQUEST_DELAY_MS);
      }
    }

    if (!req.dry_run && upsertRows.length > 0) {
      const { error: upsertError } = await supabase
        .from("nhl_postgame")
        .upsert(upsertRows, { onConflict: "id" });
      if (upsertError) {
        throw new Error(`nhl_postgame upsert failed: ${upsertError.message}`);
      }
    }

    return jsonResponse({
      request: req,
      scanned: candidates.length,
      missing_in_scan: missing.length,
      batch_attempted: queue.length,
      processed,
      succeeded,
      failed,
      dry_run: req.dry_run,
      remaining_after_run: Math.max(missing.length - queue.length, 0),
      first_scanned_start: candidates[0]?.start_time ?? null,
      last_scanned_start: candidates[candidates.length - 1]?.start_time ?? null,
      errors,
    });
  } catch (error: any) {
    return jsonResponse({ error: error?.message ?? String(error) }, 500);
  }
});

