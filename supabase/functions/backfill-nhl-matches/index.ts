declare const Deno: any;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ESPN_SCOREBOARD_ROOT = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard";
const LEAGUE_ID = "nhl";
const SPORT = "hockey";
const MATCH_SUFFIX = "nhl";
const REQUEST_TIMEOUT_MS = 12000;
const POSTGAME_TIMEOUT_MS = 60000;
const INTER_DATE_DELAY_MS = 550;
const SCOREBOARD_LIMIT = 500;

const DEFAULT_FROM = "2025-10-07";
const DEFAULT_TO = "2026-01-03";
const DEFAULT_MAX_DATES = 20;
const MAX_MAX_DATES = 120;

type BackfillDateResult = {
  date: string;
  games_discovered: number;
  games_ingested: number;
  status: "completed" | "failed";
  error?: string;
};

type BackfillRequest = {
  from: string;
  to: string;
  start_date: string;
  max_dates: number;
  trigger_postgame: boolean;
  postgame_days: number;
  postgame_force: boolean;
  continue_on_error: boolean;
};

function ensureEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return defaultValue;
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return defaultValue;
}

function parseInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseDateOnly(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid date format "${raw}". Expected YYYY-MM-DD.`);
  }
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date "${raw}"`);
  }
  return raw;
}

function compareDateStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toScoreboardDate(date: string): string {
  return date.replaceAll("-", "");
}

function enumerateDates(from: string, to: string, startDate: string, limit: number): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (compareDateStrings(cursor, to) <= 0 && dates.length < limit) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates.filter((d) => compareDateStrings(d, from) >= 0 && compareDateStrings(d, to) <= 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseScore(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string") {
    const raw = value.trim().toUpperCase();
    if (!raw) return null;
    if (raw === "EV" || raw === "EVEN") return 100;
    const parsed = Number.parseInt(raw.replace(/[+,]/g, ""), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return (
      parsePrice(v.american) ??
      parsePrice(v.value) ??
      parsePrice(v.moneyLine) ??
      parsePrice(v.odds) ??
      null
    );
  }
  return null;
}

function parsePoints(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const raw = value.trim().toUpperCase();
    if (!raw) return null;
    if (raw === "PK" || raw === "PICK" || raw === "EVEN") return 0;
    if (/^[+-]\d{3,}$/.test(raw)) return null;
    const parsed = Number.parseFloat(raw.replace(/[+,]/g, ""));
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return (
      parsePoints(v.value) ??
      parsePoints(v.points) ??
      parsePoints(v.line) ??
      null
    );
  }
  return null;
}

function parseCurrentOdds(event: any): Record<string, unknown> | null {
  const competition = event?.competitions?.[0] ?? null;
  const odds = Array.isArray(competition?.odds) ? competition.odds[0] : null;
  if (!odds) return null;

  return {
    provider: odds?.provider?.name ?? null,
    spread: parsePoints(odds?.spread),
    total: parsePoints(odds?.overUnder),
    home_ml: parsePrice(odds?.homeTeamOdds?.moneyLine ?? odds?.moneyLine),
    away_ml: parsePrice(odds?.awayTeamOdds?.moneyLine),
    home_spread_odds: parsePrice(odds?.homeTeamOdds?.spreadOdds ?? odds?.spreadOdds),
    away_spread_odds: parsePrice(odds?.awayTeamOdds?.spreadOdds),
    over_odds: parsePrice(odds?.overOdds ?? odds?.overUnderOdds),
    under_odds: parsePrice(odds?.underOdds),
  };
}

function normalizeTeamToken(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replace(/[^a-z0-9]+/g, "");
}

function buildCanonicalGameId(
  startTime: unknown,
  awayTeam: unknown,
  homeTeam: unknown,
  fallback: string,
): string {
  const time = String(startTime ?? "");
  const datePart = time.length >= 10 ? time.slice(0, 10).replaceAll("-", "") : "";
  const awayToken = normalizeTeamToken(awayTeam);
  const homeToken = normalizeTeamToken(homeTeam);
  if (datePart && awayToken && homeToken) {
    return `${datePart}_${awayToken}_${homeToken}_${LEAGUE_ID}`.toLowerCase();
  }
  return fallback;
}

function deriveStatusState(status: string): "pre" | "live" | "post" {
  const normalized = String(status ?? "").toUpperCase();
  if (
    normalized.includes("FINAL") ||
    normalized.includes("CANCELED") ||
    normalized.includes("CANCELLED") ||
    normalized.includes("POSTPONED")
  ) {
    return "post";
  }
  if (
    normalized.includes("IN_PROGRESS") ||
    normalized.includes("END_PERIOD") ||
    normalized.includes("HALFTIME")
  ) {
    return "live";
  }
  return "pre";
}

function buildMatchPayload(event: any): { id: string; payload: Record<string, unknown> } | null {
  const competition = event?.competitions?.[0] ?? {};
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = competitors.find((c: any) => c?.homeAway === "home") ?? competitors[0] ?? null;
  const away = competitors.find((c: any) => c?.homeAway === "away") ?? competitors[1] ?? null;
  if (!event?.id || !home || !away) return null;

  const status = competition?.status?.type?.name ?? event?.status?.type?.name ?? "STATUS_SCHEDULED";
  const homeScore = parseScore(home?.score);
  const awayScore = parseScore(away?.score);
  const currentOdds = parseCurrentOdds(event);
  const id = `${event.id}_${MATCH_SUFFIX}`;
  const startTime = event?.date ?? competition?.date ?? null;
  const homeTeam = home?.team?.displayName ?? home?.team?.shortDisplayName ?? null;
  const awayTeam = away?.team?.displayName ?? away?.team?.shortDisplayName ?? null;

  const payload: Record<string, unknown> = {
    id,
    league_id: LEAGUE_ID,
    sport: SPORT,
    status,
    status_state: deriveStatusState(status),
    start_time: startTime,
    home_team: homeTeam,
    away_team: awayTeam,
    home_team_id: home?.team?.id ? String(home.team.id) : null,
    away_team_id: away?.team?.id ? String(away.team.id) : null,
  };

  if (homeScore !== null) payload.home_score = homeScore;
  if (awayScore !== null) payload.away_score = awayScore;
  if (currentOdds) payload.current_odds = currentOdds;

  return { id, payload };
}

async function fetchScoreboardEvents(date: string): Promise<any[]> {
  const url = `${ESPN_SCOREBOARD_ROOT}?dates=${toScoreboardDate(date)}&limit=${SCOREBOARD_LIMIT}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(`scoreboard ${date} failed (${response.status}): ${response.statusText}`);
  }
  return Array.isArray(parsed?.events) ? parsed.events : [];
}

async function upsertScheduleRow(
  supabase: ReturnType<typeof createClient>,
  date: string,
  status: "pending" | "in_progress" | "completed",
  gamesDiscovered: number | null,
  gamesIngested: number | null,
  errorMessage: string | null,
) {
  const row = {
    backfill_date: date,
    league_id: LEAGUE_ID,
    sport: SPORT,
    status,
    games_discovered: gamesDiscovered,
    games_ingested: gamesIngested,
    error_message: errorMessage ? errorMessage.slice(0, 500) : null,
    processed_at: status === "completed" ? new Date().toISOString() : null,
  };

  const { error } = await supabase.from("season_backfill_schedule").upsert(row, {
    onConflict: "backfill_date,league_id",
  });

  if (error) {
    throw new Error(`season_backfill_schedule upsert failed for ${date}: ${error.message}`);
  }
}

function parseRequest(url: URL): BackfillRequest {
  const query = url.searchParams;

  const base: Partial<BackfillRequest> = {};
  if (query.has("from")) base.from = query.get("from") ?? "";
  if (query.has("to")) base.to = query.get("to") ?? "";
  if (query.has("start_date")) base.start_date = query.get("start_date") ?? "";
  if (query.has("max_dates")) base.max_dates = parseInteger(query.get("max_dates"), DEFAULT_MAX_DATES, 1, MAX_MAX_DATES);
  if (query.has("trigger_postgame")) base.trigger_postgame = parseBoolean(query.get("trigger_postgame"), false);
  if (query.has("postgame_days")) base.postgame_days = parseInteger(query.get("postgame_days"), 200, 1, 365);
  if (query.has("postgame_force")) base.postgame_force = parseBoolean(query.get("postgame_force"), false);
  if (query.has("continue_on_error")) base.continue_on_error = parseBoolean(query.get("continue_on_error"), true);

  return {
    from: parseDateOnly(base.from ?? DEFAULT_FROM, DEFAULT_FROM),
    to: parseDateOnly(base.to ?? DEFAULT_TO, DEFAULT_TO),
    start_date: parseDateOnly(base.start_date ?? (base.from ?? DEFAULT_FROM), base.from ?? DEFAULT_FROM),
    max_dates: base.max_dates ?? DEFAULT_MAX_DATES,
    trigger_postgame: base.trigger_postgame ?? false,
    postgame_days: base.postgame_days ?? 200,
    postgame_force: base.postgame_force ?? false,
    continue_on_error: base.continue_on_error ?? true,
  };
}

async function triggerPostgameDrain(
  days: number,
  force: boolean,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${SUPABASE_URL}/functions/v1/nhl-postgame-drain?days=${days}&force=${force ? "true" : "false"}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(POSTGAME_TIMEOUT_MS),
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST" && request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    ensureEnv();
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const req = parseRequest(new URL(request.url));

    // Body values override query params when provided.
    const finalRequest: BackfillRequest = {
      ...req,
      from: parseDateOnly((body as any)?.from ?? req.from, req.from),
      to: parseDateOnly((body as any)?.to ?? req.to, req.to),
      start_date: parseDateOnly((body as any)?.start_date ?? req.start_date, req.start_date),
      max_dates: parseInteger((body as any)?.max_dates ?? req.max_dates, req.max_dates, 1, MAX_MAX_DATES),
      trigger_postgame: parseBoolean((body as any)?.trigger_postgame ?? req.trigger_postgame, req.trigger_postgame),
      postgame_days: parseInteger((body as any)?.postgame_days ?? req.postgame_days, req.postgame_days, 1, 365),
      postgame_force: parseBoolean((body as any)?.postgame_force ?? req.postgame_force, req.postgame_force),
      continue_on_error: parseBoolean((body as any)?.continue_on_error ?? req.continue_on_error, req.continue_on_error),
    };

    if (compareDateStrings(finalRequest.from, finalRequest.to) > 0) {
      return jsonResponse({ error: '"from" must be <= "to"' }, 400);
    }
    if (
      compareDateStrings(finalRequest.start_date, finalRequest.from) < 0 ||
      compareDateStrings(finalRequest.start_date, finalRequest.to) > 0
    ) {
      return jsonResponse({ error: '"start_date" must be inside the [from,to] range' }, 400);
    }

    const dates = enumerateDates(finalRequest.from, finalRequest.to, finalRequest.start_date, finalRequest.max_dates);
    if (!dates.length) {
      return jsonResponse({
        message: "no dates to process",
        request: finalRequest,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const dateResults: BackfillDateResult[] = [];
    let totalDiscovered = 0;
    let totalIngested = 0;

    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i];

      try {
        await upsertScheduleRow(supabase, date, "in_progress", null, null, null);
        const events = await fetchScoreboardEvents(date);
        const payloads = events
          .map(buildMatchPayload)
          .filter((item): item is { id: string; payload: Record<string, unknown> } => item !== null);

        const ids = payloads.map((item) => item.id);
        const payloadById = new Map(payloads.map((item) => [item.id, item.payload]));
        let existingCount = 0;
        if (ids.length > 0) {
          const canonicalRows = payloads.map((item) => {
            const canonicalId = buildCanonicalGameId(
              item.payload.start_time,
              item.payload.away_team,
              item.payload.home_team,
              item.id,
            );
            return {
              id: canonicalId,
              league_id: LEAGUE_ID,
              sport: SPORT,
              home_team_name: item.payload.home_team ?? null,
              away_team_name: item.payload.away_team ?? null,
              commence_time: item.payload.start_time ?? null,
              status: item.payload.status ?? "STATUS_SCHEDULED",
              game_uuid: crypto.randomUUID(),
            };
          });

          const { error: canonicalUpsertError } = await supabase
            .from("canonical_games")
            .upsert(canonicalRows, {
              onConflict: "id",
              ignoreDuplicates: true,
            });
          if (canonicalUpsertError) {
            throw new Error(`canonical_games upsert failed for ${date}: ${canonicalUpsertError.message}`);
          }

          const { data: existingRows, error: existingError } = await supabase
            .from("matches")
            .select("id,canonical_game_id")
            .in("id", ids);
          if (existingError) {
            throw new Error(`existing row check failed for ${date}: ${existingError.message}`);
          }
          existingCount = existingRows?.length ?? 0;

          const { error: upsertError } = await supabase.from("matches").upsert(
            payloads.map((item) => item.payload),
            {
              onConflict: "id",
              ignoreDuplicates: true,
            },
          );
          if (upsertError) {
            throw new Error(`matches upsert failed for ${date}: ${upsertError.message}`);
          }

          for (const id of ids) {
            const sourcePayload = payloadById.get(id);
            if (!sourcePayload) continue;
            const canonicalValue = String(
              buildCanonicalGameId(sourcePayload.start_time, sourcePayload.away_team, sourcePayload.home_team, id),
            ).trim();
            if (!canonicalValue) continue;

            const { error: repairError } = await supabase
              .from("matches")
              .update({
                canonical_game_id: canonicalValue,
                canonical_id: canonicalValue,
              })
              .eq("id", id)
              .is("canonical_game_id", null);
            if (repairError) {
              throw new Error(`canonical repair failed for ${id}: ${repairError.message}`);
            }
          }
        }

        const discovered = payloads.length;
        const ingested = Math.max(discovered - existingCount, 0);
        totalDiscovered += discovered;
        totalIngested += ingested;

        await upsertScheduleRow(supabase, date, "completed", discovered, ingested, null);
        dateResults.push({
          date,
          games_discovered: discovered,
          games_ingested: ingested,
          status: "completed",
        });
      } catch (error: any) {
        const message = error?.message ?? String(error);
        await upsertScheduleRow(supabase, date, "completed", null, null, message);
        dateResults.push({
          date,
          games_discovered: 0,
          games_ingested: 0,
          status: "failed",
          error: message.slice(0, 500),
        });
        if (!finalRequest.continue_on_error) {
          break;
        }
      }

      if (i < dates.length - 1) {
        await delay(INTER_DATE_DELAY_MS);
      }
    }

    const lastProcessed = dates[dates.length - 1];
    const nextStartDate = addDays(lastProcessed, 1);
    const hasMore = compareDateStrings(nextStartDate, finalRequest.to) <= 0;

    let postgameDrain: { ok: boolean; status: number; body: unknown } | null = null;
    if (finalRequest.trigger_postgame) {
      postgameDrain = await triggerPostgameDrain(finalRequest.postgame_days, finalRequest.postgame_force);
    }

    return jsonResponse({
      request: finalRequest,
      processed_dates: dates.length,
      has_more: hasMore,
      next_start_date: hasMore ? nextStartDate : null,
      totals: {
        games_discovered: totalDiscovered,
        games_ingested: totalIngested,
        completed_dates: dateResults.filter((d) => d.status === "completed").length,
        failed_dates: dateResults.filter((d) => d.status === "failed").length,
      },
      dates: dateResults,
      postgame_drain: postgameDrain,
    });
  } catch (error: any) {
    return jsonResponse({ error: error?.message ?? String(error) }, 500);
  }
});
