import type { Match } from "@/types";
import { supabase } from "@/lib/supabase";

export type LiveIntelligenceLean = "OVER" | "UNDER" | "HOME" | "AWAY" | "PASS";
export type LiveIntelligenceMarket = "TOTAL" | "SPREAD" | "MONEYLINE";

export interface LiveIntelligenceCardPayload {
  headline: string;
  thesis: string;
  confidence: number;
  lean: LiveIntelligenceLean;
  market: LiveIntelligenceMarket;
  trends: string[];
  drivers: string[];
  watchouts: string[];
}

export interface LiveIntelligenceResponse {
  success: boolean;
  state_hash: string;
  cached: boolean;
  generated_at: string;
  card: LiveIntelligenceCardPayload;
  odds_context?: {
    snapshots_table: string | null;
    snapshots_count: number;
    latest_total: number | null;
    move_5m: number | null;
    move_15m: number | null;
  };
}

type LiveIntelligenceRequest = {
  match_id: string;
  sport?: string;
  league_id?: string;
  snapshot: {
    home_team: string;
    away_team: string;
    home_score: number;
    away_score: number;
    score: string;
    clock: string;
    period: number;
    status: string;
    market_total: number | string | null;
    fair_total: number | string | null;
    spread: number | string | null;
  };
  live_stats: Array<{
    label: string;
    home: number | string | null;
    away: number | string | null;
  }>;
  key_events: Array<{
    time: string;
    type: string;
    detail: string;
  }>;
  leaders: Array<{
    player: string;
    stat: string;
    value: number | string | null;
  }>;
};

const VALID_LEANS: LiveIntelligenceLean[] = ["OVER", "UNDER", "HOME", "AWAY", "PASS"];
const VALID_MARKETS: LiveIntelligenceMarket[] = ["TOTAL", "SPREAD", "MONEYLINE"];

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9+.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
}

function toConsumerCopy(value: string): string {
  return value
    .replace(/Live Market Is Balanced/gi, "Live Trend Pulse")
    .replace(
      /Trend profile is still stabilizing through the current game state\.?/gi,
      "No clear edge yet. Wait for the next big moment before adjusting your position.",
    )
    .replace(
      /Clock state\s*([^;]+);\s*re-grade after the next major swing\.?/gi,
      "$1 on the clock. Reassess after the next key event.",
    )
    .replace(
      /Monitor clock and possession state before sizing\.?/gi,
      "Wait for the next key event before increasing stake size.",
    )
    .replace(/No recent event spike in feed\.?/gi, "No major momentum shift yet.")
    .replace(
      /Recheck after next score or major possession swing\.?/gi,
      "Reassess after the next goal or major possession swing.",
    )
    .trim();
}

function clampConfidence(value: unknown, fallback = 46): number {
  const parsed = normalizeNumber(value);
  if (parsed === null) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeLean(value: unknown, fallback: LiveIntelligenceLean): LiveIntelligenceLean {
  const text = normalizeText(value)?.toUpperCase() ?? "";
  return VALID_LEANS.includes(text as LiveIntelligenceLean)
    ? (text as LiveIntelligenceLean)
    : fallback;
}

function normalizeMarket(value: unknown, fallback: LiveIntelligenceMarket): LiveIntelligenceMarket {
  const text = normalizeText(value)?.toUpperCase() ?? "";
  if (text.includes("TOTAL")) return "TOTAL";
  if (text.includes("SPREAD")) return "SPREAD";
  if (text.includes("ML") || text.includes("MONEY")) return "MONEYLINE";
  return VALID_MARKETS.includes(text as LiveIntelligenceMarket)
    ? (text as LiveIntelligenceMarket)
    : fallback;
}

function parseClockToSeconds(value: unknown): number | null {
  const text = normalizeText(value);
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length !== 2) return null;
  const minutes = Number(parts[0]);
  const seconds = Number(parts[1]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return minutes * 60 + seconds;
}

function regulationMinutesForSport(sport: unknown): number | null {
  const normalized = normalizeText(sport)?.toUpperCase();
  if (!normalized) return null;
  if (normalized === "NBA" || normalized === "WNBA" || normalized === "BASKETBALL") return 48;
  if (normalized === "NFL" || normalized === "NCAAF" || normalized === "FOOTBALL") return 60;
  if (normalized === "NHL" || normalized === "HOCKEY") return 60;
  if (normalized === "SOCCER") return 90;
  return null;
}

function estimateProjectedTotal(match: Match): { projectedTotal: number; elapsedPct: number } | null {
  const homeScore = normalizeNumber(match.homeScore);
  const awayScore = normalizeNumber(match.awayScore);
  const currentTotal = homeScore !== null && awayScore !== null ? homeScore + awayScore : null;
  if (currentTotal === null || currentTotal <= 0) return null;

  const regulationMinutes = regulationMinutesForSport(match.sport);
  const period = normalizeNumber(match.period);
  const clockSeconds = parseClockToSeconds(match.displayClock || match.minute);
  if (regulationMinutes === null || period === null || clockSeconds === null) return null;

  const periodMinutes =
    regulationMinutes === 48 ? 12 :
    regulationMinutes === 90 ? 45 :
    regulationMinutes === 60 ? 15 :
    null;
  if (periodMinutes === null) return null;

  const elapsedMinutes = (Math.max(1, period) - 1) * periodMinutes + (periodMinutes - clockSeconds / 60);
  const elapsedPct = elapsedMinutes / regulationMinutes;
  if (!Number.isFinite(elapsedPct) || elapsedPct < 0.12 || elapsedPct > 0.98) return null;

  return {
    projectedTotal: currentTotal / elapsedPct,
    elapsedPct,
  };
}

function deriveStatDrivers(match: Match): string[] {
  return (match.stats || [])
    .map((stat) => {
      const home = normalizeNumber(stat.homeValue);
      const away = normalizeNumber(stat.awayValue);
      if (home === null || away === null) return null;
      const delta = Math.abs(home - away);
      if (!Number.isFinite(delta) || delta <= 0) return null;
      const label = normalizeText(stat.label) || "Stat";
      return {
        delta,
        line: `${label}: ${home} vs ${away}`,
      };
    })
    .filter((entry): entry is { delta: number; line: string } => Boolean(entry))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 2)
    .map((entry) => entry.line);
}

function isSoccerMatch(match: Match): boolean {
  const sport = normalizeText(match.sport)?.toLowerCase() || "";
  const league = normalizeText(match.leagueId)?.toLowerCase() || "";
  return (
    sport.includes("soccer") ||
    league.includes("uefa") ||
    league.includes("fifa") ||
    league.includes("mls") ||
    league.includes("premier") ||
    league.includes("laliga") ||
    league.includes("bundesliga") ||
    league.includes("serie") ||
    league.includes("ligue")
  );
}

function formatTrendTeamName(teamName: string, record?: string | null): string {
  const cleanRecord = normalizeText(record);
  return cleanRecord ? `${teamName} (${cleanRecord})` : teamName;
}

function buildTrendLines(match: Match, totalEdge: number | null, fairEdge: number | null): string[] {
  const homeName = match.homeTeam?.shortName || match.homeTeam?.name || "Home";
  const awayName = match.awayTeam?.shortName || match.awayTeam?.name || "Away";
  const homeRecord = normalizeText(match.homeTeam?.record);
  const awayRecord = normalizeText(match.awayTeam?.record);
  const homeScore = normalizeNumber(match.homeScore);
  const awayScore = normalizeNumber(match.awayScore);
  const period = normalizeNumber(match.period) ?? 1;
  const stats = deriveStatDrivers(match);
  const trends: string[] = [];
  const soccer = isSoccerMatch(match);

  if (soccer && homeScore !== null && awayScore !== null && period >= 2) {
    if (homeScore !== awayScore) {
      const trailingIsHome = homeScore < awayScore;
      const trailingTeam = trailingIsHome ? homeName : awayName;
      const trailingRecord = trailingIsHome ? homeRecord : awayRecord;
      trends.push(`${formatTrendTeamName(trailingTeam, trailingRecord)}: Concedes in 2nd Half`);
    } else {
      trends.push(`${formatTrendTeamName(homeName, homeRecord)}: Late 2nd-half swing profile`);
    }
  }

  if (totalEdge !== null) {
    if (totalEdge >= 1.5) {
      trends.push(`Total trend: Pace tracking OVER by +${totalEdge.toFixed(1)}`);
    } else if (totalEdge <= -1.5) {
      trends.push(`Total trend: Pace tracking UNDER by ${totalEdge.toFixed(1)}`);
    }
  }

  if (fairEdge !== null && Math.abs(fairEdge) >= 1) {
    trends.push(
      `Model trend: Fair total ${fairEdge > 0 ? "+" : ""}${fairEdge.toFixed(1)} vs live market`,
    );
  }

  if (stats.length > 0) {
    trends.push(`Stat trend: ${stats[0]}`);
  }

  const uniqueTrends = Array.from(new Set(trends.filter((line) => line.trim().length > 0)));
  if (uniqueTrends.length > 0) return uniqueTrends.slice(0, 3);

  return [
    `${formatTrendTeamName(awayName, awayRecord)} vs ${formatTrendTeamName(homeName, homeRecord)}: No clear trend edge yet`,
  ];
}

function buildDeterministicCard(match: Match): LiveIntelligenceCardPayload {
  const homeTeam = match.homeTeam?.shortName || match.homeTeam?.name || "Home";
  const awayTeam = match.awayTeam?.shortName || match.awayTeam?.name || "Away";
  const marketTotal = normalizeNumber(
    match.current_odds?.total ?? match.odds?.total ?? match.odds?.overUnder,
  );
  const fairTotal = normalizeNumber(match.ai_signals?.deterministic_fair_total);
  const paceProjection = estimateProjectedTotal(match);
  const paceTotal = paceProjection ? Math.round(paceProjection.projectedTotal * 10) / 10 : null;
  const spread = normalizeNumber(
    match.current_odds?.homeSpread ?? match.current_odds?.spread ?? match.odds?.spread,
  );
  const homeScore = normalizeNumber(match.homeScore);
  const awayScore = normalizeNumber(match.awayScore);
  const fairEdge = marketTotal !== null && fairTotal !== null ? fairTotal - marketTotal : null;
  const paceEdge = marketTotal !== null && paceTotal !== null ? paceTotal - marketTotal : null;
  const totalEdgeCandidates = [fairEdge, paceEdge].filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  const totalEdge =
    totalEdgeCandidates.length > 0
      ? totalEdgeCandidates.reduce((sum, value) => sum + value, 0) / totalEdgeCandidates.length
      : null;

  let lean: LiveIntelligenceLean = "PASS";
  let market: LiveIntelligenceMarket = "TOTAL";
  if (totalEdge !== null && totalEdge >= 2) lean = "OVER";
  if (totalEdge !== null && totalEdge <= -2) lean = "UNDER";

  if (lean === "PASS" && spread !== null && homeScore !== null && awayScore !== null) {
    const margin = homeScore - awayScore;
    if (margin + spread >= 4) {
      lean = "HOME";
      market = "SPREAD";
    } else if (margin + spread <= -4) {
      lean = "AWAY";
      market = "SPREAD";
    }
  }

  const confidence =
    totalEdge === null
      ? 48
      : Math.max(52, Math.min(84, Math.round(52 + Math.abs(totalEdge) * 5)));

  const drivers = deriveStatDrivers(match);
  const events = match.events || [];
  const lastEvent = events[events.length - 1];
  const clockText = normalizeText(match.displayClock || match.minute);

  const contextDrivers: string[] = [];
  if (marketTotal !== null && fairTotal !== null) {
    contextDrivers.push(
      `Projected total ${fairTotal.toFixed(1)} vs line ${marketTotal.toFixed(1)} (${fairEdge && fairEdge > 0 ? "+" : ""}${fairEdge?.toFixed(1) ?? "0.0"}).`,
    );
  }
  if (marketTotal !== null && paceTotal !== null && paceProjection) {
    contextDrivers.push(
      `Live pace projection ${paceTotal.toFixed(1)} with ${(paceProjection.elapsedPct * 100).toFixed(0)}% elapsed.`,
    );
  }

  const trends = buildTrendLines(match, totalEdge, fairEdge);

  return {
    headline: lean === "PASS" ? "Live Trend Pulse" : `Live ${lean} Trend Signal`,
    thesis:
      totalEdge === null
        ? `${awayTeam} vs ${homeTeam} is active. No clear edge yet, so wait for the next major event before changing your position.`
        : `${awayTeam} @ ${homeTeam}: composite total edge ${totalEdge > 0 ? "+" : ""}${totalEdge.toFixed(1)} using live pace and fair-value anchors.`,
    confidence,
    lean,
    market,
    trends,
    drivers:
      [...contextDrivers, ...drivers].length > 0
        ? [...contextDrivers, ...drivers].slice(0, 4)
        : ["No clear live stat dominance in the current state sample."],
    watchouts: [
      clockText ? `${clockText} on the clock. Reassess after the next key event.` : "Wait for the next key event before increasing stake size.",
      lastEvent
        ? `Last event: ${normalizeText(lastEvent.type) || "play"} ${normalizeText(lastEvent.time || lastEvent.clock) || ""}`.trim()
        : "No major momentum shift yet.",
      "Reassess after the next goal or major possession swing.",
    ],
  };
}

function sanitizeCard(
  candidate: unknown,
  fallback: LiveIntelligenceCardPayload,
): LiveIntelligenceCardPayload {
  if (!candidate || typeof candidate !== "object") return fallback;
  const record = candidate as Record<string, unknown>;
  const drivers = asStringList(record.drivers);
  const watchouts = asStringList(record.watchouts);
  const trends = asStringList(record.trends);
  const headline =
    normalizeText(record.headline) ||
    fallback.headline;
  return {
    headline: /live market is balanced/i.test(headline) ? "Live Trend Pulse" : headline,
    thesis: toConsumerCopy(normalizeText(record.thesis) || fallback.thesis),
    confidence: clampConfidence(record.confidence, fallback.confidence),
    lean: normalizeLean(record.lean, fallback.lean),
    market: normalizeMarket(record.market, fallback.market),
    trends: (trends.length > 0 ? trends.slice(0, 3) : fallback.trends).map(toConsumerCopy),
    drivers: (drivers.length > 0 ? drivers.slice(0, 4) : fallback.drivers).map(toConsumerCopy),
    watchouts: (watchouts.length > 0 ? watchouts.slice(0, 3) : fallback.watchouts).map(toConsumerCopy),
  };
}

function mapAnalyzeMatchCard(
  data: unknown,
  fallback: LiveIntelligenceCardPayload,
): LiveIntelligenceCardPayload | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const sharpData = root.sharp_data;
  if (!sharpData || typeof sharpData !== "object") return null;
  const sharp = sharpData as Record<string, unknown>;

  const rec =
    sharp.recommendation && typeof sharp.recommendation === "object"
      ? (sharp.recommendation as Record<string, unknown>)
      : null;
  const bullets =
    sharp.executive_bullets && typeof sharp.executive_bullets === "object"
      ? (sharp.executive_bullets as Record<string, unknown>)
      : null;
  const sharpTrends = asStringList(sharp.trends);

  const candidate = {
    headline:
      normalizeText(sharp.headline) ||
      normalizeText(sharp.market_signal) ||
      fallback.headline,
    thesis:
      normalizeText(sharp.analysis) ||
      normalizeText(sharp.the_read) ||
      normalizeText(sharp.summary) ||
      fallback.thesis,
    confidence:
      normalizeNumber(sharp.confidence_level) ??
      normalizeNumber((sharp.confidence as Record<string, unknown> | null)?.score) ??
      fallback.confidence,
    lean:
      normalizeText(rec?.side) ||
      normalizeText(sharp.pick) ||
      fallback.lean,
    market:
      normalizeText(rec?.market_type) ||
      normalizeText(sharp.market) ||
      fallback.market,
    trends:
      sharpTrends.length > 0
        ? sharpTrends
        : [
            normalizeText(sharp.market_signal),
            normalizeText(sharp.the_read),
            normalizeText((sharp as Record<string, unknown>).key_trend),
          ].filter((entry): entry is string => Boolean(entry)),
    drivers: [
      normalizeText(bullets?.driver),
      normalizeText(bullets?.setup),
      normalizeText(sharp.edge_explanation),
    ].filter((entry): entry is string => Boolean(entry)),
    watchouts: [
      normalizeText(bullets?.caution),
      normalizeText(bullets?.monitor),
      normalizeText(sharp.risk),
    ].filter((entry): entry is string => Boolean(entry)),
  };

  return sanitizeCard(candidate, fallback);
}

function fallbackIntelligence(match: Match): LiveIntelligenceResponse {
  const fallbackCard = buildDeterministicCard(match);
  return {
    success: true,
    state_hash: `${computeLiveIntelligenceQueryKey(match)}-fallback`,
    cached: false,
    generated_at: new Date().toISOString(),
    card: fallbackCard,
    odds_context: {
      snapshots_table: null,
      snapshots_count: 0,
      latest_total: normalizeNumber(
        match.current_odds?.total ?? match.odds?.total ?? match.odds?.overUnder,
      ),
      move_5m: null,
      move_15m: null,
    },
  };
}

export function buildLiveIntelligenceRequest(match: Match): LiveIntelligenceRequest {
  const homeName = match.homeTeam?.name || "Home";
  const awayName = match.awayTeam?.name || "Away";

  const liveStats = (match.stats || []).slice(0, 12).map((stat) => ({
    label: stat.label || "Stat",
    home: stat.homeValue ?? null,
    away: stat.awayValue ?? null,
  }));

  const keyEvents = (match.events || [])
    .filter((event) => event.type === "goal" || event.type === "score" || event.type === "card")
    .slice(-8)
    .map((event) => ({
      time: event.time || event.clock || "",
      type: event.type || "event",
      detail: event.detail || event.description || event.text || "",
    }));

  const leaders = (match.leaders || []).slice(0, 6).map((leader) => ({
    player:
      leader.leaders?.[0]?.athlete?.displayName ||
      leader.leaders?.[0]?.athlete?.fullName ||
      "",
    stat: leader.displayName || leader.name || "",
    value: leader.leaders?.[0]?.displayValue || null,
  }));

  return {
    match_id: match.id,
    sport: String(match.sport || ""),
    league_id: match.leagueId || "",
    snapshot: {
      home_team: homeName,
      away_team: awayName,
      home_score: match.homeScore ?? 0,
      away_score: match.awayScore ?? 0,
      score: `${match.awayScore ?? 0}-${match.homeScore ?? 0}`,
      clock: match.displayClock || match.minute || "0:00",
      period: match.period || 1,
      status: String(match.status || ""),
      market_total: match.current_odds?.total ?? match.odds?.total ?? match.odds?.overUnder ?? null,
      fair_total: match.ai_signals?.deterministic_fair_total ?? null,
      spread: match.current_odds?.homeSpread ?? match.current_odds?.spread ?? match.odds?.spread ?? null,
    },
    live_stats: liveStats,
    key_events: keyEvents,
    leaders,
  };
}

function stateSeed(match: Match): string {
  const statsSeed = (match.stats || [])
    .slice(0, 8)
    .map((stat) => `${stat.label}:${stat.homeValue}-${stat.awayValue}`)
    .join("|");

  return [
    match.id,
    match.homeScore ?? 0,
    match.awayScore ?? 0,
    match.period ?? 0,
    match.displayClock || "",
    match.current_odds?.total ?? match.odds?.total ?? match.odds?.overUnder ?? "",
    match.ai_signals?.deterministic_fair_total ?? "",
    statsSeed,
  ].join("::");
}

export function computeLiveIntelligenceQueryKey(match: Match): string {
  const seed = stateSeed(match);
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `liv-ai-${(hash >>> 0).toString(16)}`;
}

export async function fetchLiveIntelligenceCard(match: Match): Promise<LiveIntelligenceResponse> {
  const deterministicFallback = buildDeterministicCard(match);
  const requestKey = computeLiveIntelligenceQueryKey(match);

  try {
    const payload = buildLiveIntelligenceRequest(match);
    const { data, error } = await supabase.functions.invoke("live-intelligence-card", {
      body: payload,
    });

    if (!error && data?.card) {
      const record = data as Record<string, unknown>;
      return {
        success: true,
        state_hash:
          normalizeText(record.state_hash) ||
          `${requestKey}-edge`,
        cached: Boolean(record.cached),
        generated_at: normalizeText(record.generated_at) || new Date().toISOString(),
        card: sanitizeCard((record as { card: unknown }).card, deterministicFallback),
        odds_context:
          record.odds_context && typeof record.odds_context === "object"
            ? {
                snapshots_table:
                  normalizeText(
                    (record.odds_context as Record<string, unknown>).snapshots_table,
                  ) || null,
                snapshots_count:
                  normalizeNumber(
                    (record.odds_context as Record<string, unknown>).snapshots_count,
                  ) ?? 0,
                latest_total: normalizeNumber(
                  (record.odds_context as Record<string, unknown>).latest_total,
                ),
                move_5m: normalizeNumber(
                  (record.odds_context as Record<string, unknown>).move_5m,
                ),
                move_15m: normalizeNumber(
                  (record.odds_context as Record<string, unknown>).move_15m,
                ),
              }
            : {
                snapshots_table: null,
                snapshots_count: 0,
                latest_total: normalizeNumber(payload.snapshot.market_total),
                move_5m: null,
                move_15m: null,
              },
      };
    }

    const analyzePayload = {
      ...payload,
      predictor: match.predictor
        ? {
            homeChance: match.predictor.homeTeamChance,
            awayChance: match.predictor.awayTeamChance,
          }
        : null,
      advanced_metrics: match.advancedMetrics || null,
      last_play: match.lastPlay
        ? {
            text: match.lastPlay.text,
            clock: match.lastPlay.clock,
            type: match.lastPlay.type,
          }
        : null,
      ai_signals: match.ai_signals || null,
    };

    const { data: analyzeData, error: analyzeError } = await supabase.functions.invoke(
      "analyze-match",
      {
        body: analyzePayload,
      },
    );

    if (!analyzeError) {
      const mapped = mapAnalyzeMatchCard(analyzeData, deterministicFallback);
      if (mapped) {
        return {
          success: true,
          state_hash: `${requestKey}-legacy`,
          cached: false,
          generated_at: new Date().toISOString(),
          card: mapped,
          odds_context: {
            snapshots_table: null,
            snapshots_count: 0,
            latest_total: normalizeNumber(payload.snapshot.market_total),
            move_5m: null,
            move_15m: null,
          },
        };
      }
    }

    return fallbackIntelligence(match);
  } catch {
    return fallbackIntelligence(match);
  }
}
