declare const Deno: any;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ESPN_SCOREBOARD_ROOT = "https://site.api.espn.com/apis/site/v2/sports";
const REQUEST_TIMEOUT_MS = 12000;
const SCOREBOARD_LIMIT = 500;

type SeasonClaim = {
  backfill_date: string;
  league_id: string;
  sport: string;
};

type LeagueRuntime = {
  leagueId: string;
  dbSport: string;
  espnSportPath: string;
  espnLeagueId: string;
  groups?: string;
  matchSuffix: string;
};

const LEGACY_SUFFIX_MAP: Record<string, string> = {
  "mens-college-basketball": "ncaab",
  "college-football": "ncaaf",
};

function normalizeSport(raw: unknown): string {
  const sport = String(raw ?? "").trim().toLowerCase();
  return sport || "basketball";
}

function toEspnSportPath(dbSport: string): string {
  const sport = normalizeSport(dbSport);
  if (sport === "americanfootball") return "football";
  if (sport === "icehockey") return "hockey";
  return sport;
}

function resolveMatchSuffix(leagueId: string): string {
  const normalized = String(leagueId ?? "").trim().toLowerCase();
  return LEGACY_SUFFIX_MAP[normalized] ?? normalized;
}

function inferSportFromLeague(leagueId: string): string {
  const normalized = String(leagueId ?? "").trim().toLowerCase();
  if (
    normalized === "nba" ||
    normalized === "wnba" ||
    normalized === "mens-college-basketball"
  ) {
    return "basketball";
  }
  if (
    normalized === "nfl" ||
    normalized === "college-football"
  ) {
    return "americanfootball";
  }
  return "soccer";
}

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

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string") {
    const raw = value.trim().toUpperCase();
    if (!raw) return null;
    if (raw === "EV" || raw === "EVEN") return 100;
    const parsed = parseInt(raw.replace(/[+,]/g, ""), 10);
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
    const parsed = parseFloat(raw.replace(/[+,]/g, ""));
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return (
      parsePoints(v.value) ??
      parsePoints(v.points) ??
      parsePoints(v.line) ??
      parsePoints(v.american) ??
      null
    );
  }
  return null;
}

async function callRpcWithFallback<T>(
  supabase: ReturnType<typeof createClient>,
  functionName: string,
  payloads: Array<Record<string, unknown>>,
): Promise<{ data: T | null; error: any }> {
  let lastError: any = null;
  for (const payload of payloads) {
    const { data, error } = await supabase.rpc(functionName, payload);
    if (!error) {
      return { data: (data as T) ?? null, error: null };
    }
    lastError = error;
    const message = String(error?.message ?? "");
    if (!message.includes("Could not find the function")) {
      break;
    }
  }
  return { data: null, error: lastError };
}

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: parsed,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return { ok: true, status: response.status, data: parsed };
  } catch (error: any) {
    return { ok: false, status: 0, data: null, error: error?.message ?? String(error) };
  }
}

function toScoreboardDate(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

async function resolveLeagueRuntime(
  supabase: ReturnType<typeof createClient>,
  claim: SeasonClaim,
): Promise<LeagueRuntime> {
  const fallbackSport = normalizeSport(claim.sport) || inferSportFromLeague(claim.league_id);
  const fallbackLeague = String(claim.league_id ?? "").trim();
  const { data: configRow, error: configError } = await supabase
    .from("league_config")
    .select("id, sport, espn_league_id")
    .eq("id", fallbackLeague)
    .maybeSingle();

  if (configError) {
    throw new Error(`league_config lookup failed for ${fallbackLeague}: ${configError.message}`);
  }

  const dbSport = normalizeSport(configRow?.sport ?? fallbackSport);
  const espnLeagueId = String(configRow?.espn_league_id ?? fallbackLeague).trim();
  if (!espnLeagueId) {
    throw new Error(`missing espn league id for ${fallbackLeague}`);
  }

  return {
    leagueId: fallbackLeague,
    dbSport,
    espnSportPath: toEspnSportPath(dbSport),
    espnLeagueId,
    groups: fallbackLeague === "mens-college-basketball" ? "50" : undefined,
    matchSuffix: resolveMatchSuffix(fallbackLeague),
  };
}

async function fetchScoreboardEvents(
  scoreboardBase: string,
  scoreboardDate: string,
  groups?: string,
): Promise<{
  events: any[];
  variants: Array<{ url: string; event_count: number; status: number; ok: boolean; error?: string }>;
}> {
  const urls = groups
    ? [
        `${scoreboardBase}?groups=${encodeURIComponent(groups)}&dates=${scoreboardDate}&limit=${SCOREBOARD_LIMIT}`,
        `${scoreboardBase}?dates=${scoreboardDate}&limit=${SCOREBOARD_LIMIT}`,
      ]
    : [`${scoreboardBase}?dates=${scoreboardDate}&limit=${SCOREBOARD_LIMIT}`];

  const variants: Array<{ url: string; event_count: number; status: number; ok: boolean; error?: string }> = [];
  const merged = new Map<string, any>();

  for (const url of urls) {
    const res = await fetchJson(url);
    const events = Array.isArray(res.data?.events) ? res.data.events : [];
    variants.push({
      url,
      event_count: events.length,
      status: res.status,
      ok: res.ok,
      error: res.error,
    });

    if (!res.ok) continue;
    for (const event of events) {
      const id = String(event?.id ?? "").trim();
      if (!id) continue;
      if (!merged.has(id)) {
        merged.set(id, event);
      }
    }
  }

  const anySuccess = variants.some((v) => v.ok);
  if (!anySuccess) {
    const summary = variants.map((v) => `${v.status}:${v.error ?? "unknown"}`).join(" | ");
    throw new Error(`scoreboard fetch failed: ${summary}`);
  }

  return { events: Array.from(merged.values()), variants };
}

function parseScoreboardOdds(event: any): Record<string, unknown> | null {
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

function buildMatchPayload(event: any, runtime: LeagueRuntime) {
  const competition = event?.competitions?.[0] ?? {};
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = competitors.find((c: any) => c?.homeAway === "home") ?? competitors[0] ?? null;
  const away = competitors.find((c: any) => c?.homeAway === "away") ?? competitors[1] ?? null;
  if (!event?.id || !home || !away) return null;

  const matchId = `${event.id}_${runtime.matchSuffix}`;
  const homeScore = toInt(home?.score);
  const awayScore = toInt(away?.score);
  const currentOdds = parseScoreboardOdds(event);

  const payload: Record<string, unknown> = {
    id: matchId,
    home_team: home?.team?.displayName ?? null,
    away_team: away?.team?.displayName ?? null,
    league_id: runtime.leagueId,
    sport: runtime.dbSport,
    status: competition?.status?.type?.name ?? event?.status?.type?.name ?? "STATUS_SCHEDULED",
    start_time: event?.date ?? competition?.date ?? null,
    home_team_id: home?.team?.id ? String(home.team.id) : null,
    away_team_id: away?.team?.id ? String(away.team.id) : null,
  };

  if (homeScore !== null) payload.home_score = homeScore;
  if (awayScore !== null) payload.away_score = awayScore;
  if (currentOdds) payload.current_odds = currentOdds;

  return {
    matchId,
    payload,
  };
}

async function completeSeasonDate(
  supabase: ReturnType<typeof createClient>,
  claim: SeasonClaim,
  discovered: number,
  ingested: number,
  errorMessage: string | null,
) {
  const truncated = errorMessage ? errorMessage.slice(0, 500) : null;
  const { error } = await callRpcWithFallback<any>(supabase, "complete_season_backfill_date", [
    {
      p_date: claim.backfill_date,
      p_league_id: claim.league_id,
      p_games_discovered: discovered,
      p_games_ingested: ingested,
      p_error: truncated,
    },
    {
      date: claim.backfill_date,
      league_id: claim.league_id,
      games_discovered: discovered,
      games_ingested: ingested,
      error: truncated,
    },
  ]);

  if (error) {
    throw new Error(`complete_season_backfill_date failed: ${error.message ?? String(error)}`);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  ensureEnv();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let claim: SeasonClaim | null = null;
  try {
    const requestBody = await request.json().catch(() => ({}));
    const requestedLeagueId = typeof requestBody?.league_id === "string"
      ? String(requestBody.league_id).trim().toLowerCase()
      : "";

    let leagueToClaim = requestedLeagueId;
    if (!leagueToClaim) {
      const { data: pendingRow, error: pendingError } = await supabase
        .from("season_backfill_schedule")
        .select("league_id, backfill_date")
        .eq("status", "pending")
        .order("backfill_date", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (pendingError) {
        return jsonResponse({ error: `season queue lookup failed: ${pendingError.message}` }, 500);
      }

      leagueToClaim = String(pendingRow?.league_id ?? "").trim().toLowerCase();
      if (!leagueToClaim) {
        return jsonResponse({ claimed_date: null, message: "no pending dates" });
      }
    }

    const { data: claimedRows, error: claimError } = await callRpcWithFallback<SeasonClaim[]>(
      supabase,
      "claim_season_backfill_date",
      [
        { p_league_id: leagueToClaim },
        { league_id: leagueToClaim },
      ],
    );

    if (claimError) {
      return jsonResponse(
        { error: `claim_season_backfill_date failed: ${claimError.message ?? String(claimError)}` },
        500,
      );
    }

    claim = Array.isArray(claimedRows) && claimedRows.length > 0 ? claimedRows[0] : null;
    if (!claim) {
      return jsonResponse({
        claimed_date: null,
        claimed_league_id: leagueToClaim,
        message: "no pending dates for claimed league",
      });
    }

    const runtime = await resolveLeagueRuntime(supabase, claim);
    const scoreboardBase = `${ESPN_SCOREBOARD_ROOT}/${runtime.espnSportPath}/${runtime.espnLeagueId}/scoreboard`;
    const scoreboardDate = toScoreboardDate(claim.backfill_date);
    const scoreboard = await fetchScoreboardEvents(scoreboardBase, scoreboardDate, runtime.groups);
    const events = scoreboard.events;
    let gamesIngested = 0;
    const queuedRows: Array<Record<string, unknown>> = [];
    const perGameResults: Array<{ match_id: string; ingested: boolean; reason?: string }> = [];

    for (const event of events) {
      const built = buildMatchPayload(event, runtime);
      if (!built) {
        continue;
      }

      const { matchId, payload } = built;
      const { error: upsertError } = await supabase.from("matches").upsert(payload, { onConflict: "id" });
      if (upsertError) {
        perGameResults.push({ match_id: matchId, ingested: false, reason: upsertError.message });
        continue;
      }

      gamesIngested += 1;
      perGameResults.push({ match_id: matchId, ingested: true });

      queuedRows.push(
        {
          match_id: matchId,
          league_id: runtime.leagueId,
          sport: runtime.dbSport,
          endpoint: "officials",
          priority: 3,
        },
        {
          match_id: matchId,
          league_id: runtime.leagueId,
          sport: runtime.dbSport,
          endpoint: "plays",
          priority: 4,
        },
        {
          match_id: matchId,
          league_id: runtime.leagueId,
          sport: runtime.dbSport,
          endpoint: "odds",
          priority: 4,
        },
        {
          match_id: matchId,
          league_id: runtime.leagueId,
          sport: runtime.dbSport,
          endpoint: "statistics",
          priority: 5,
        },
      );
    }

    for (let i = 0; i < queuedRows.length; i += 500) {
      const chunk = queuedRows.slice(i, i + 500);
      const { error: queueError } = await supabase.from("backfill_queue").upsert(chunk, {
        onConflict: "match_id,endpoint",
        ignoreDuplicates: true,
      });
      if (queueError) {
        const message = `backfill_queue upsert failed: ${queueError.message}`;
        await completeSeasonDate(supabase, claim, events.length, gamesIngested, message);
        return jsonResponse({ claimed_date: claim.backfill_date, error: message }, 500);
      }
    }

    await completeSeasonDate(supabase, claim, events.length, gamesIngested, null);

    return jsonResponse({
      claimed_date: claim.backfill_date,
      claimed_league_id: claim.league_id,
      sport: runtime.dbSport,
      espn_league_id: runtime.espnLeagueId,
      games_discovered: events.length,
      games_ingested: gamesIngested,
      queue_rows_written: queuedRows.length,
      scoreboard_variants: scoreboard.variants,
      sample_results: perGameResults.slice(0, 20),
    });
  } catch (error: any) {
    if (claim) {
      try {
        await completeSeasonDate(supabase, claim, 0, 0, error?.message ?? String(error));
      } catch (completeError) {
        console.error("failed to complete claimed season date after error", completeError);
      }
    }
    return jsonResponse({ error: error?.message ?? String(error) }, 500);
  }
});
