declare const Deno: any;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateCanonicalGameId } from "../_shared/match-registry.ts";

type Endpoint = "officials" | "plays" | "odds" | "statistics";

interface ClaimedBackfillItem {
  match_id: string;
  league_id: string;
  sport: string;
  endpoint: Endpoint;
}

interface LeagueContext {
  espnLeague: string;
  dbLeagueId: string;
  enrichmentLeagueId: string;
  sport: string;
  eventId: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ESPN_SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball";
const ESPN_CORE_BASE = "https://sports.core.api.espn.com/v2/sports/basketball";
const REQUEST_TIMEOUT_MS = 12000;
const ITEM_DELAY_MS = 500;

const VALID_ENDPOINTS: Endpoint[] = ["officials", "plays", "odds", "statistics"];

function ensureEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function toFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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
    return parsePoints(v.value) ?? parsePoints(v.points) ?? parsePoints(v.line) ?? parsePoints(v.american) ?? null;
  }
  return null;
}

function toInt32Sequence(value: unknown): number | null {
  const parsed = toInt(value);
  if (parsed === null || parsed <= 0 || parsed > 2_147_483_647) return null;
  return parsed;
}

function computePlaySequence(play: any, index: number): number {
  const fromSequence = toInt32Sequence(play?.sequenceNumber) ?? toInt32Sequence(play?.sequence);
  if (fromSequence !== null) return fromSequence;

  const idDigits = String(play?.id ?? "").replace(/\D/g, "");
  const fromId = toInt32Sequence(idDigits.slice(-9));
  if (fromId !== null) return fromId;

  return index + 1;
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

function resolveLeagueContext(item: ClaimedBackfillItem): LeagueContext {
  const parts = String(item.match_id || "").split("_");
  const eventId = parts[0];
  const suffix = (parts[1] ?? "").toLowerCase();
  const baseLeague = (item.league_id || "").toLowerCase();

  const normalized = baseLeague || suffix;
  let espnLeague = "nba";
  let dbLeagueId = item.league_id || "nba";
  let enrichmentLeagueId = suffix || "nba";

  if (normalized === "mens-college-basketball" || normalized === "ncaab" || suffix === "ncaab") {
    espnLeague = "mens-college-basketball";
    dbLeagueId = "mens-college-basketball";
    enrichmentLeagueId = "ncaab";
  } else if (normalized === "wnba") {
    espnLeague = "wnba";
    dbLeagueId = "wnba";
    enrichmentLeagueId = "wnba";
  } else {
    espnLeague = "nba";
    dbLeagueId = "nba";
    enrichmentLeagueId = "nba";
  }

  return {
    espnLeague,
    dbLeagueId,
    enrichmentLeagueId,
    sport: item.sport || "basketball",
    eventId,
  };
}

function summaryUrl(league: string, eventId: string): string {
  return `${ESPN_SITE_BASE}/${league}/summary?event=${eventId}`;
}

function coreOddsUrl(league: string, eventId: string): string {
  return `${ESPN_CORE_BASE}/${league}/events/${eventId}/competitions/${eventId}/odds`;
}

function buildCoreCompetitionBase(league: string, eventId: string): string {
  return `${ESPN_CORE_BASE}/${league}/events/${eventId}/competitions/${eventId}`;
}

function findCompetitors(summary: any): { home: any; away: any; competition: any } {
  const competition =
    summary?.header?.competitions?.[0] ??
    summary?.competitions?.[0] ??
    summary?.boxscore?.teams?.[0]?.competition ??
    null;

  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = competitors.find((c: any) => c?.homeAway === "home") ?? competitors[0] ?? null;
  const away = competitors.find((c: any) => c?.homeAway === "away") ?? competitors[1] ?? null;

  return { home, away, competition };
}

function extractOddsSnapshot(source: any, type: "open" | "close" | "current") {
  const payload = source?.[type] ?? {};
  const homeTeamOdds = payload?.homeTeamOdds ?? source?.homeTeamOdds?.[type] ?? source?.homeTeamOdds ?? {};
  const awayTeamOdds = payload?.awayTeamOdds ?? source?.awayTeamOdds?.[type] ?? source?.awayTeamOdds ?? {};

  const homeSpread =
    parsePoints(homeTeamOdds?.spread) ??
    parsePoints(homeTeamOdds?.pointSpread?.value) ??
    parsePoints(payload?.spread) ??
    parsePoints(source?.spread);
  const awaySpreadDirect =
    parsePoints(awayTeamOdds?.spread) ??
    parsePoints(awayTeamOdds?.pointSpread?.value) ??
    parsePoints(payload?.awayTeamOdds?.spread);
  const awaySpread = awaySpreadDirect ?? (typeof homeSpread === "number" ? -homeSpread : null);

  return {
    home_ml:
      parsePrice(homeTeamOdds?.moneyLine) ??
      parsePrice(source?.homeTeamOdds?.moneyLine) ??
      parsePrice(payload?.moneyLine),
    away_ml:
      parsePrice(awayTeamOdds?.moneyLine) ??
      parsePrice(source?.awayTeamOdds?.moneyLine),
    home_spread: homeSpread,
    away_spread: awaySpread,
    total:
      parsePoints(payload?.overUnder) ??
      parsePoints(source?.overUnder) ??
      parsePoints(payload?.total?.value) ??
      null,
    over_odds:
      parsePrice(payload?.overOdds) ??
      parsePrice(payload?.over?.odds) ??
      parsePrice(source?.overOdds),
    under_odds:
      parsePrice(payload?.underOdds) ??
      parsePrice(payload?.under?.odds) ??
      parsePrice(source?.underOdds),
    home_spread_odds:
      parsePrice(homeTeamOdds?.spreadOdds) ??
      parsePrice(source?.homeTeamOdds?.spreadOdds),
    away_spread_odds:
      parsePrice(awayTeamOdds?.spreadOdds) ??
      parsePrice(source?.awayTeamOdds?.spreadOdds),
    provider: source?.provider?.name ?? "ESPN",
    provider_id: source?.provider?.id ? String(source.provider.id) : null,
  };
}

function snapshotHasOdds(snapshot: Record<string, unknown> | null): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const values = Object.values(snapshot);
  return values.some((value) => value !== null && value !== undefined && value !== "");
}

function readStatValue(statsMap: Record<string, string>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (statsMap[key] !== undefined) return statsMap[key];
  }
  return null;
}

function parseBoxscoreTeamStats(teamBox: any): Record<string, string> {
  const rows = Array.isArray(teamBox?.statistics) ? teamBox.statistics : [];
  const map: Record<string, string> = {};
  for (const row of rows) {
    const name = normalizeKey(String(row?.name ?? row?.label ?? row?.displayName ?? ""));
    const value = row?.displayValue ?? row?.value;
    if (!name || value === undefined || value === null) continue;
    map[name] = String(value);
  }
  return map;
}

function parseWinProbabilityTimeline(winProbData: any): Array<{ playId: string | null; tiePct: number; homeWinPct: number }> {
  if (!Array.isArray(winProbData)) return [];
  const rows = winProbData
    .map((row: any) => {
      const homeWinPct =
        toFloat(row?.homeWinPercentage) ??
        toFloat(row?.homeWinPct) ??
        toFloat(row?.homeTeamChance) ??
        null;
      if (homeWinPct === null) return null;
      return {
        playId: row?.playId ? String(row.playId) : row?.id ? String(row.id) : null,
        tiePct: toFloat(row?.tiePercentage) ?? toFloat(row?.tiePct) ?? 0,
        homeWinPct,
      };
    })
    .filter(Boolean) as Array<{ playId: string | null; tiePct: number; homeWinPct: number }>;
  return rows;
}

function parsePredictorStats(summary: any) {
  const predictor = summary?.predictor ?? null;
  if (!predictor) {
    return {
      homeWinPct: null as number | null,
      awayWinPct: null as number | null,
      homePredMov: null as number | null,
      awayPredMov: null as number | null,
      matchupQuality: null as number | null,
    };
  }

  const readTeamStat = (teamNode: any, aliases: string[]) => {
    const stats = Array.isArray(teamNode?.statistics)
      ? teamNode.statistics
      : Array.isArray(teamNode?.team?.statistics)
      ? teamNode.team.statistics
      : [];
    for (const stat of stats) {
      const key = normalizeKey(String(stat?.name ?? stat?.displayName ?? stat?.shortDisplayName ?? ""));
      if (!key) continue;
      if (aliases.some((alias) => normalizeKey(alias) === key)) {
        const parsed = toFloat(stat?.value ?? stat?.displayValue);
        if (parsed !== null) return parsed;
      }
    }
    return null;
  };

  const homeWinPct = toFloat(predictor?.homeTeam?.gameProjection) ?? readTeamStat(predictor?.homeTeam, ["gameProjection", "teamPredWinPct"]);
  const awayWinPct = toFloat(predictor?.awayTeam?.gameProjection) ?? readTeamStat(predictor?.awayTeam, ["gameProjection", "teamPredWinPct"]);
  const homePredMov = readTeamStat(predictor?.homeTeam, ["teamPredMov", "predPtDiff", "teamPredPtDiff"]);
  const awayPredMov = readTeamStat(predictor?.awayTeam, ["teamPredMov", "predPtDiff", "teamPredPtDiff"]);
  const matchupQuality =
    readTeamStat(predictor?.homeTeam, ["matchupQuality"]) ??
    readTeamStat(predictor?.awayTeam, ["matchupQuality"]);

  return { homeWinPct, awayWinPct, homePredMov, awayPredMov, matchupQuality };
}

function parsePickcenterOdds(summary: any) {
  const pickcenter = Array.isArray(summary?.pickcenter) ? summary.pickcenter : [];
  const choice =
    pickcenter.find((o: any) => String(o?.provider?.id ?? "") === "100") ??
    pickcenter.find((o: any) => String(o?.provider?.name ?? "").toLowerCase().includes("draftkings")) ??
    pickcenter[0] ??
    null;
  if (!choice) return null;

  const spread =
    parsePoints(choice?.spread) ??
    parsePoints(choice?.details?.split(" ").slice(-1)[0]) ??
    parsePoints(choice?.homeTeamOdds?.spread);
  const total = parsePoints(choice?.overUnder) ?? parsePoints(choice?.total?.line);

  return {
    provider: choice?.provider?.name ?? null,
    spread,
    total,
    home_ml: parsePrice(choice?.homeTeamOdds?.moneyLine) ?? parsePrice(choice?.moneyline?.home?.close?.odds),
    away_ml: parsePrice(choice?.awayTeamOdds?.moneyLine) ?? parsePrice(choice?.moneyline?.away?.close?.odds),
    home_spread_price:
      parsePrice(choice?.homeTeamOdds?.spreadOdds) ??
      parsePrice(choice?.pointSpread?.home?.close?.odds),
    away_spread_price:
      parsePrice(choice?.awayTeamOdds?.spreadOdds) ??
      parsePrice(choice?.pointSpread?.away?.close?.odds),
    over_price: parsePrice(choice?.overOdds) ?? parsePrice(choice?.total?.over?.close?.odds),
    under_price: parsePrice(choice?.underOdds) ?? parsePrice(choice?.total?.under?.close?.odds),
  };
}

async function completeBackfillItem(
  supabase: ReturnType<typeof createClient>,
  item: ClaimedBackfillItem,
  success: boolean,
  errorMessage: string | null,
) {
  const truncated = errorMessage ? errorMessage.slice(0, 500) : null;
  const { error } = await callRpcWithFallback<any>(supabase, "complete_backfill_item", [
    {
      p_match_id: item.match_id,
      p_endpoint: item.endpoint,
      p_success: success,
      p_error: truncated,
    },
    {
      match_id: item.match_id,
      endpoint: item.endpoint,
      success,
      error: truncated,
    },
  ]);

  if (error) {
    console.error("complete_backfill_item failed", {
      match_id: item.match_id,
      endpoint: item.endpoint,
      error: error?.message ?? String(error),
    });
  }
}

async function processOfficials(
  supabase: ReturnType<typeof createClient>,
  item: ClaimedBackfillItem,
  league: LeagueContext,
) {
  const summaryRes = await fetchJson(summaryUrl(league.espnLeague, league.eventId));
  if (!summaryRes.ok) {
    throw new Error(`officials summary fetch failed: ${summaryRes.error ?? summaryRes.status}`);
  }

  const summary = summaryRes.data ?? {};
  const officialsRaw = Array.isArray(summary?.gameInfo?.officials) ? summary.gameInfo.officials : [];
  const officials = officialsRaw
    .map((official: any, index: number) => ({
      name: official?.displayName ?? official?.fullName ?? official?.name ?? null,
      position:
        official?.position?.name ??
        official?.position?.displayName ??
        (typeof official?.position === "string" ? official.position : null),
      order: toInt(official?.order) ?? index + 1,
      espn_id: official?.id ? String(official.id) : null,
    }))
    .filter((official: any) => !!official.name);

  if (officials.length === 0) {
    throw new Error("officials endpoint returned no crew");
  }

  const gameDate =
    summary?.header?.competitions?.[0]?.date ??
    summary?.gameInfo?.gameDate ??
    summary?.gameInfo?.date ??
    summary?.date ??
    new Date().toISOString();

  const { error } = await callRpcWithFallback<any>(supabase, "upsert_game_officials", [
    {
      p_match_id: item.match_id,
      p_game_date: gameDate,
      p_sport: league.sport,
      p_league_id: league.dbLeagueId,
      p_officials: officials,
    },
    {
      match_id: item.match_id,
      game_date: gameDate,
      sport: league.sport,
      league_id: league.dbLeagueId,
      officials,
    },
  ]);

  if (error) {
    throw new Error(`upsert_game_officials failed: ${error.message ?? String(error)}`);
  }
}

async function processPlays(
  supabase: ReturnType<typeof createClient>,
  item: ClaimedBackfillItem,
  league: LeagueContext,
) {
  const { count, error: countError } = await supabase
    .from("game_events")
    .select("id", { head: true, count: "exact" })
    .eq("match_id", item.match_id)
    .eq("event_type", "play");

  if (countError) {
    throw new Error(`plays existing-count query failed: ${countError.message}`);
  }

  if ((count ?? 0) > 0) {
    return;
  }

  const summaryRes = await fetchJson(summaryUrl(league.espnLeague, league.eventId));
  if (!summaryRes.ok) {
    throw new Error(`plays summary fetch failed: ${summaryRes.error ?? summaryRes.status}`);
  }

  const summary = summaryRes.data ?? {};
  const plays = Array.isArray(summary?.plays) ? summary.plays : [];
  if (plays.length === 0) {
    throw new Error("plays endpoint returned no events");
  }

  const rows = plays
    .filter((play: any) => !!play?.id || !!play?.text)
    .map((play: any, index: number) => ({
      match_id: item.match_id,
      league_id: league.dbLeagueId,
      sport: league.sport,
      event_type: "play",
      sequence: computePlaySequence(play, index),
      period: toInt(play?.period?.number ?? play?.period),
      clock: play?.clock?.displayValue ?? play?.clock?.value ?? null,
      home_score: toInt(play?.homeScore) ?? 0,
      away_score: toInt(play?.awayScore) ?? 0,
      play_data: {
        id: play?.id ?? null,
        text: play?.text ?? null,
        type: play?.type?.text ?? play?.type ?? null,
        scoringPlay: !!play?.scoringPlay,
        scoreValue: toInt(play?.scoreValue),
      },
      source: "backfill-endpoint-worker",
    }));

  if (rows.length === 0) {
    throw new Error("plays endpoint had no valid rows");
  }

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error: upsertError } = await supabase.from("game_events").upsert(chunk, {
      onConflict: "match_id,event_type,sequence",
      ignoreDuplicates: true,
    });
    if (upsertError) {
      throw new Error(`plays upsert failed: ${upsertError.message}`);
    }
  }
}

async function processOdds(
  supabase: ReturnType<typeof createClient>,
  item: ClaimedBackfillItem,
  league: LeagueContext,
) {
  const startedAt = Date.now();

  const summaryPromise = fetchJson(summaryUrl(league.espnLeague, league.eventId));
  const oddsPromise = fetchJson(coreOddsUrl(league.espnLeague, league.eventId));
  const probabilitiesPromise = fetchJson(`${buildCoreCompetitionBase(league.espnLeague, league.eventId)}/probabilities?limit=500`);
  const predictorPromise = fetchJson(`${buildCoreCompetitionBase(league.espnLeague, league.eventId)}/predictor`);

  const [summaryRes, oddsRes, probabilitiesRes, predictorRes] = await Promise.all([
    summaryPromise,
    oddsPromise,
    probabilitiesPromise,
    predictorPromise,
  ]);

  if (!summaryRes.ok && !oddsRes.ok) {
    throw new Error(
      `odds endpoints unavailable: summary=${summaryRes.status || 0} core_odds=${oddsRes.status || 0}`,
    );
  }

  const summary = summaryRes.data ?? {};
  const oddsData = oddsRes.data ?? {};
  const predictorData = predictorRes.ok ? predictorRes.data : summary?.predictor ?? null;
  const probabilitiesData = probabilitiesRes.ok ? probabilitiesRes.data : null;
  const { home, away, competition } = findCompetitors(summary);

  const coreOddsItems = Array.isArray(oddsData?.items)
    ? oddsData.items
    : Array.isArray(oddsData)
    ? oddsData
    : oddsData
    ? [oddsData]
    : [];
  const competitionOddsItems = Array.isArray(competition?.odds) ? competition.odds : [];
  const oddsItems = coreOddsItems.length > 0 ? coreOddsItems : competitionOddsItems;
  const selectedOdds =
    oddsItems.find((oddsItem: any) => !!oddsItem?.current || !!oddsItem?.open || !!oddsItem?.close) ??
    oddsItems[0] ??
    null;

  const coreOpenSnapshot = selectedOdds ? extractOddsSnapshot(selectedOdds, "open") : null;
  const coreCloseSnapshot = selectedOdds ? extractOddsSnapshot(selectedOdds, "close") : null;
  const coreLiveSnapshot = selectedOdds ? extractOddsSnapshot(selectedOdds, "current") : null;

  const pickcenter = parsePickcenterOdds(summary);
  const pickcenterSnapshot = pickcenter
    ? {
        home_ml: pickcenter.home_ml ?? null,
        away_ml: pickcenter.away_ml ?? null,
        home_spread: pickcenter.spread ?? null,
        away_spread:
          typeof pickcenter.spread === "number" ? -pickcenter.spread : null,
        total: pickcenter.total ?? null,
        over_odds: pickcenter.over_price ?? null,
        under_odds: pickcenter.under_price ?? null,
        home_spread_odds: pickcenter.home_spread_price ?? null,
        away_spread_odds: pickcenter.away_spread_price ?? null,
        provider: pickcenter.provider ?? "PickCenter",
        provider_id: "100",
      }
    : null;

  const openSnapshot = snapshotHasOdds(coreOpenSnapshot) ? coreOpenSnapshot : pickcenterSnapshot;
  const closeSnapshot = snapshotHasOdds(coreCloseSnapshot) ? coreCloseSnapshot : pickcenterSnapshot;
  const liveSnapshot = snapshotHasOdds(coreLiveSnapshot) ? coreLiveSnapshot : pickcenterSnapshot;

  if (!oddsRes.ok && [400, 404].includes(oddsRes.status) && !snapshotHasOdds(openSnapshot)) {
    throw new Error(`odds endpoint unavailable: ${oddsRes.status}`);
  }

  const predictorFromSummary = parsePredictorStats({ predictor: predictorData ?? summary?.predictor ?? null });
  const winProbTimeline = parseWinProbabilityTimeline(summary?.winprobability);
  const latestWinProb = winProbTimeline.length > 0 ? winProbTimeline[winProbTimeline.length - 1] : null;

  const homeWinPct =
    latestWinProb?.homeWinPct ??
    predictorFromSummary.homeWinPct ??
    null;
  const awayWinPct =
    homeWinPct !== null
      ? Math.max(0, 100 - homeWinPct)
      : predictorFromSummary.awayWinPct;

  const marketSpread = liveSnapshot?.home_spread ?? closeSnapshot?.home_spread ?? openSnapshot?.home_spread ?? null;
  const marketTotal = liveSnapshot?.total ?? closeSnapshot?.total ?? openSnapshot?.total ?? null;
  const impliedSpread = predictorFromSummary.homePredMov;

  const probabilitiesRaw =
    probabilitiesRes.ok && probabilitiesData
      ? probabilitiesData
      : Array.isArray(summary?.winprobability)
      ? summary.winprobability
      : {};

  const endpointsHit: string[] = [];
  if (oddsRes.ok) endpointsHit.push("odds_core");
  if (pickcenterSnapshot) endpointsHit.push("pickcenter");
  if (summaryRes.ok) endpointsHit.push("summary");
  if (predictorRes.ok || summary?.predictor) endpointsHit.push("predictor");
  if (probabilitiesRes.ok || Array.isArray(summary?.winprobability)) endpointsHit.push("probabilities");

  const upsertPayload = {
    id: item.match_id,
    espn_event_id: league.eventId,
    league_id: league.enrichmentLeagueId,
    sport: league.sport,
    home_team: home?.team?.displayName ?? null,
    away_team: away?.team?.displayName ?? null,
    home_team_id: home?.team?.id ? String(home.team.id) : null,
    away_team_id: away?.team?.id ? String(away.team.id) : null,
    start_time: competition?.date ?? summary?.header?.competitions?.[0]?.date ?? null,
    summary_raw: summaryRes.ok ? summary : null,
    predictor_raw: predictorData ?? null,
    odds_raw: coreOddsItems.length > 0 ? coreOddsItems : oddsItems,
    odds_movement_raw: {
      open: openSnapshot,
      close: closeSnapshot,
      current: liveSnapshot,
    },
    probabilities_raw: probabilitiesRaw ?? {},
    espn_win_prob:
      homeWinPct !== null || awayWinPct !== null
        ? {
            home: homeWinPct !== null ? homeWinPct / 100 : null,
            away: awayWinPct !== null ? awayWinPct / 100 : null,
          }
        : {},
    espn_projected_score: {
      home: predictorFromSummary.homePredMov,
      away:
        predictorFromSummary.awayPredMov ??
        (typeof predictorFromSummary.homePredMov === "number"
          ? -predictorFromSummary.homePredMov
          : null),
    },
    espn_power_index: {
      matchup_quality: predictorFromSummary.matchupQuality,
      home_win_pct: predictorFromSummary.homeWinPct,
      away_win_pct: predictorFromSummary.awayWinPct,
    },
    espn_implied_spread: impliedSpread,
    espn_implied_total: null,
    market_spread: marketSpread,
    market_total: marketTotal,
    spread_divergence:
      typeof marketSpread === "number" && typeof impliedSpread === "number"
        ? marketSpread - impliedSpread
        : null,
    total_divergence: null,
    drain_version: "backfill-endpoint-worker-v1",
    endpoints_hit: endpointsHit,
    drain_errors: [],
    drain_duration_ms: Date.now() - startedAt,
    last_drained_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase.from("espn_enrichment").upsert(upsertPayload, {
    onConflict: "id",
  });
  if (upsertError) {
    throw new Error(`espn_enrichment upsert failed: ${upsertError.message}`);
  }
}

function getBoxscoreTeamNode(teams: any[], competitor: any, fallbackIndex: number): any {
  if (!Array.isArray(teams) || teams.length === 0) return null;
  const competitorTeamId = competitor?.team?.id ? String(competitor.team.id) : null;
  if (competitorTeamId) {
    const byId = teams.find((team: any) => String(team?.team?.id ?? "") === competitorTeamId);
    if (byId) return byId;
  }

  const compName = String(competitor?.team?.displayName ?? "").trim().toLowerCase();
  if (compName) {
    const byName = teams.find(
      (team: any) => String(team?.team?.displayName ?? "").trim().toLowerCase() === compName,
    );
    if (byName) return byName;
  }

  return teams[fallbackIndex] ?? null;
}

async function processStatistics(
  supabase: ReturnType<typeof createClient>,
  item: ClaimedBackfillItem,
  league: LeagueContext,
) {
  const summaryRes = await fetchJson(summaryUrl(league.espnLeague, league.eventId));
  if (!summaryRes.ok) {
    throw new Error(`statistics summary fetch failed: ${summaryRes.error ?? summaryRes.status}`);
  }

  const summary = summaryRes.data ?? {};
  const { home, away, competition } = findCompetitors(summary);
  if (!home || !away) {
    throw new Error("statistics parse failed: missing competitors");
  }

  const teams = Array.isArray(summary?.boxscore?.teams) ? summary.boxscore.teams : [];
  const homeBox = getBoxscoreTeamNode(teams, home, 0);
  const awayBox = getBoxscoreTeamNode(teams, away, 1);
  const homeStats = parseBoxscoreTeamStats(homeBox);
  const awayStats = parseBoxscoreTeamStats(awayBox);

  const homeScore = toInt(home?.score);
  const awayScore = toInt(away?.score);
  const pickcenter = parsePickcenterOdds(summary);
  const winProbTimeline = parseWinProbabilityTimeline(summary?.winprobability);
  const startTime =
    competition?.date ??
    summary?.header?.competitions?.[0]?.date ??
    null;

  const { data: matchMeta } = await supabase
    .from("matches")
    .select("canonical_game_id,canonical_id,home_team,away_team,start_time,league_id")
    .eq("id", item.match_id)
    .maybeSingle();

  const canonicalFromDb =
    (typeof matchMeta?.canonical_game_id === "string" && matchMeta.canonical_game_id.trim().length > 0
      ? matchMeta.canonical_game_id
      : null) ??
    (typeof matchMeta?.canonical_id === "string" && matchMeta.canonical_id.trim().length > 0
      ? matchMeta.canonical_id
      : null);

  const canonicalGameId = (() => {
    if (canonicalFromDb) return canonicalFromDb;
    const homeTeamName = String(matchMeta?.home_team ?? home?.team?.displayName ?? "").trim();
    const awayTeamName = String(matchMeta?.away_team ?? away?.team?.displayName ?? "").trim();
    const gameStart = String(matchMeta?.start_time ?? startTime ?? "").trim();
    const leagueId = String(matchMeta?.league_id ?? league.dbLeagueId ?? "nba").trim();
    if (!homeTeamName || !awayTeamName || !gameStart) return item.match_id;
    try {
      return generateCanonicalGameId(homeTeamName, awayTeamName, gameStart, leagueId);
    } catch {
      return item.match_id;
    }
  })();

  const canonicalHomeTeam = String(matchMeta?.home_team ?? home?.team?.displayName ?? "").trim() || null;
  const canonicalAwayTeam = String(matchMeta?.away_team ?? away?.team?.displayName ?? "").trim() || null;
  const canonicalLeague = String(matchMeta?.league_id ?? league.dbLeagueId ?? "nba").trim();
  const canonicalSport = String(league.sport || "basketball").trim();
  const canonicalStartTime = String(matchMeta?.start_time ?? startTime ?? "").trim() || null;
  const canonicalStatus =
    competition?.status?.type?.name ??
    summary?.header?.competitions?.[0]?.status?.type?.name ??
    null;

  const { data: canonicalExisting, error: canonicalLookupError } = await supabase
    .from("canonical_games")
    .select("id")
    .eq("id", canonicalGameId)
    .maybeSingle();
  if (canonicalLookupError) {
    throw new Error(`canonical_games lookup failed: ${canonicalLookupError.message}`);
  }

  if (!canonicalExisting) {
    const { error: canonicalInsertError } = await supabase.from("canonical_games").insert({
      id: canonicalGameId,
      game_uuid: crypto.randomUUID(),
      league_id: canonicalLeague,
      sport: canonicalSport,
      home_team_name: canonicalHomeTeam,
      away_team_name: canonicalAwayTeam,
      commence_time: canonicalStartTime,
      status: canonicalStatus,
      updated_at: new Date().toISOString(),
    });
    if (canonicalInsertError && canonicalInsertError.code !== "23505") {
      throw new Error(`canonical_games insert failed: ${canonicalInsertError.message}`);
    }
  }

  const buildPct = (value: string | null) => {
    if (!value) return null;
    return toFloat(value);
  };

  const payload: Record<string, unknown> = {
    id: item.match_id,
    espn_event_id: league.eventId,
    home_team: home?.team?.displayName ?? null,
    away_team: away?.team?.displayName ?? null,
    home_score: homeScore,
    away_score: awayScore,
    match_status: competition?.status?.type?.name ?? summary?.header?.competitions?.[0]?.status?.type?.name ?? null,
    start_time: startTime,
    venue: summary?.gameInfo?.venue?.fullName ?? null,
    attendance: toInt(summary?.gameInfo?.attendance),
    home_fg: readStatValue(homeStats, ["fieldGoalsMadeFieldGoalsAttempted", "fieldGoals"]),
    away_fg: readStatValue(awayStats, ["fieldGoalsMadeFieldGoalsAttempted", "fieldGoals"]),
    home_fg_pct: buildPct(readStatValue(homeStats, ["fieldGoalPct", "fieldGoalsPercentage"])),
    away_fg_pct: buildPct(readStatValue(awayStats, ["fieldGoalPct", "fieldGoalsPercentage"])),
    home_3pt: readStatValue(homeStats, ["threePointFieldGoalsMadeThreePointFieldGoalsAttempted", "threePointFieldGoals"]),
    away_3pt: readStatValue(awayStats, ["threePointFieldGoalsMadeThreePointFieldGoalsAttempted", "threePointFieldGoals"]),
    home_3pt_pct: buildPct(readStatValue(homeStats, ["threePointFieldGoalPct", "threePointPercentage"])),
    away_3pt_pct: buildPct(readStatValue(awayStats, ["threePointFieldGoalPct", "threePointPercentage"])),
    home_ft: readStatValue(homeStats, ["freeThrowsMadeFreeThrowsAttempted", "freeThrows"]),
    away_ft: readStatValue(awayStats, ["freeThrowsMadeFreeThrowsAttempted", "freeThrows"]),
    home_ft_pct: buildPct(readStatValue(homeStats, ["freeThrowPct", "freeThrowsPercentage"])),
    away_ft_pct: buildPct(readStatValue(awayStats, ["freeThrowPct", "freeThrowsPercentage"])),
    home_rebounds: toInt(readStatValue(homeStats, ["rebounds", "totalRebounds"])),
    away_rebounds: toInt(readStatValue(awayStats, ["rebounds", "totalRebounds"])),
    home_off_rebounds: toInt(readStatValue(homeStats, ["offensiveRebounds"])),
    away_off_rebounds: toInt(readStatValue(awayStats, ["offensiveRebounds"])),
    home_def_rebounds: toInt(readStatValue(homeStats, ["defensiveRebounds"])),
    away_def_rebounds: toInt(readStatValue(awayStats, ["defensiveRebounds"])),
    home_assists: toInt(readStatValue(homeStats, ["assists"])),
    away_assists: toInt(readStatValue(awayStats, ["assists"])),
    home_steals: toInt(readStatValue(homeStats, ["steals"])),
    away_steals: toInt(readStatValue(awayStats, ["steals"])),
    home_blocks: toInt(readStatValue(homeStats, ["blocks"])),
    away_blocks: toInt(readStatValue(awayStats, ["blocks"])),
    home_turnovers: toInt(readStatValue(homeStats, ["turnovers"])),
    away_turnovers: toInt(readStatValue(awayStats, ["turnovers"])),
    home_total_turnovers: toInt(readStatValue(homeStats, ["totalTurnovers", "turnovers"])),
    away_total_turnovers: toInt(readStatValue(awayStats, ["totalTurnovers", "turnovers"])),
    home_fouls: toInt(readStatValue(homeStats, ["fouls", "personalFouls"])),
    away_fouls: toInt(readStatValue(awayStats, ["fouls", "personalFouls"])),
    home_tech_fouls: toInt(readStatValue(homeStats, ["technicalFouls"])),
    away_tech_fouls: toInt(readStatValue(awayStats, ["technicalFouls"])),
    home_flagrant_fouls: toInt(readStatValue(homeStats, ["flagrantFouls"])),
    away_flagrant_fouls: toInt(readStatValue(awayStats, ["flagrantFouls"])),
    home_pts_off_turnovers: toInt(readStatValue(homeStats, ["pointsOffTurnovers"])),
    away_pts_off_turnovers: toInt(readStatValue(awayStats, ["pointsOffTurnovers"])),
    home_fast_break_pts: toInt(readStatValue(homeStats, ["fastBreakPoints"])),
    away_fast_break_pts: toInt(readStatValue(awayStats, ["fastBreakPoints"])),
    home_pts_in_paint: toInt(readStatValue(homeStats, ["pointsInPaint"])),
    away_pts_in_paint: toInt(readStatValue(awayStats, ["pointsInPaint"])),
    home_largest_lead: toInt(readStatValue(homeStats, ["largestLead"])),
    away_largest_lead: toInt(readStatValue(awayStats, ["largestLead"])),
    lead_changes:
      toInt(summary?.boxscore?.leadChanges) ??
      toInt(summary?.gameInfo?.leadChanges) ??
      null,
    home_pct_led: buildPct(readStatValue(homeStats, ["timeLed", "pctLed", "percentageLed"])),
    away_pct_led: buildPct(readStatValue(awayStats, ["timeLed", "pctLed", "percentageLed"])),
    dk_home_ml: pickcenter?.home_ml ?? null,
    dk_away_ml: pickcenter?.away_ml ?? null,
    dk_spread: pickcenter?.spread ?? null,
    dk_home_spread_price: pickcenter?.home_spread_price ?? null,
    dk_away_spread_price: pickcenter?.away_spread_price ?? null,
    dk_total: pickcenter?.total ?? null,
    dk_over_price: pickcenter?.over_price ?? null,
    dk_under_price: pickcenter?.under_price ?? null,
    win_probability: winProbTimeline,
    drain_version: "backfill-endpoint-worker-v1",
    last_drained_at: new Date().toISOString(),
    canonical_game_id: canonicalGameId,
  };

  const { error: insertError } = await supabase.from("nba_postgame").upsert(payload, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (insertError) {
    throw new Error(`nba_postgame insert failed: ${insertError.message}`);
  }
}

async function processBackfillItem(
  supabase: ReturnType<typeof createClient>,
  item: ClaimedBackfillItem,
) {
  const league = resolveLeagueContext(item);
  if (!league.eventId) {
    throw new Error(`Invalid match_id format: ${item.match_id}`);
  }

  switch (item.endpoint) {
    case "officials":
      await processOfficials(supabase, item, league);
      return;
    case "plays":
      await processPlays(supabase, item, league);
      return;
    case "odds":
      await processOdds(supabase, item, league);
      return;
    case "statistics":
      await processStatistics(supabase, item, league);
      return;
    default:
      throw new Error(`Unsupported endpoint: ${item.endpoint}`);
  }
}

function parseRequestBody(raw: string): { endpoint: Endpoint; batchSize: number } {
  if (!raw) return { endpoint: "officials", batchSize: 20 };
  let body: any = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }

  const endpoint = VALID_ENDPOINTS.includes(body?.endpoint) ? body.endpoint : "officials";
  const batchSizeRaw = toInt(body?.batch_size) ?? toInt(body?.batchSize) ?? 20;
  const batchSize = Math.max(1, Math.min(batchSizeRaw, 100));
  return { endpoint, batchSize };
}

function classifyErrorDisposition(
  endpoint: Endpoint,
  message: string,
): { terminal: boolean; bucket: string | null } {
  const normalized = message.toLowerCase();
  if (endpoint === "officials" && normalized.includes("returned no crew")) {
    return { terminal: true, bucket: "terminal_officials_no_crew" };
  }
  if (endpoint === "plays" && normalized.includes("returned no events")) {
    return { terminal: true, bucket: "terminal_plays_no_events" };
  }
  return { terminal: false, bucket: null };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    ensureEnv();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const rawBody = await request.text();
    const { endpoint, batchSize } = parseRequestBody(rawBody);

    const { data: batch, error: claimError } = await callRpcWithFallback<ClaimedBackfillItem[]>(
      supabase,
      "claim_backfill_batch",
      [
        { p_endpoint: endpoint, p_batch_size: batchSize },
        { endpoint, batch_size: batchSize },
      ],
    );

    if (claimError) {
      return jsonResponse(
        { error: `claim_backfill_batch failed: ${claimError.message ?? String(claimError)}` },
        500,
      );
    }

    if (!Array.isArray(batch) || batch.length === 0) {
      return jsonResponse({ claimed: 0, succeeded: 0, failed: 0, message: "no pending items" });
    }

    let succeeded = 0;
    let failed = 0;
    let terminalSkipped = 0;
    const failures: Array<{ match_id: string; endpoint: string; error: string }> = [];
    const terminals: Array<{ match_id: string; endpoint: string; bucket: string; error: string }> = [];

    for (const item of batch) {
      try {
        await processBackfillItem(supabase, item);
        await completeBackfillItem(supabase, item, true, null);
        succeeded += 1;
      } catch (error: any) {
        const message = error?.message ?? String(error);
        const disposition = classifyErrorDisposition(item.endpoint, message);
        if (disposition.terminal && disposition.bucket) {
          await completeBackfillItem(supabase, item, true, null);
          terminalSkipped += 1;
          terminals.push({
            match_id: item.match_id,
            endpoint: item.endpoint,
            bucket: disposition.bucket,
            error: message,
          });
        } else {
          await completeBackfillItem(supabase, item, false, message);
          failed += 1;
          failures.push({
            match_id: item.match_id,
            endpoint: item.endpoint,
            error: message,
          });
        }
      }
      await sleep(ITEM_DELAY_MS);
    }

    return jsonResponse({
      claimed: batch.length,
      succeeded,
      failed,
      terminal_skipped: terminalSkipped,
      failures: failures.slice(0, 20),
      terminal_examples: terminals.slice(0, 20),
    });
  } catch (error: any) {
    return jsonResponse({ error: error?.message ?? String(error) }, 500);
  }
});
