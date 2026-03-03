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

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9+.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function fallbackIntelligence(match: Match): LiveIntelligenceResponse {
  const homeTeam = match.homeTeam?.shortName || match.homeTeam?.name || "Home";
  const awayTeam = match.awayTeam?.shortName || match.awayTeam?.name || "Away";

  return {
    success: true,
    state_hash: `${match.id}-fallback`,
    cached: false,
    generated_at: new Date().toISOString(),
    card: {
      headline: "Live Intelligence Syncing",
      thesis: `${awayTeam} vs ${homeTeam} is active. Waiting for enough synchronized live market context to grade a confident edge.`,
      confidence: 42,
      lean: "PASS",
      market: "TOTAL",
      drivers: ["Live context still stabilizing across score, clock, and line feeds."],
      watchouts: ["Avoid forcing exposure until a clear movement pattern appears."],
    },
    odds_context: {
      snapshots_table: null,
      snapshots_count: 0,
      latest_total: normalizeNumber(match.current_odds?.total ?? match.odds?.total ?? match.odds?.overUnder),
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
  try {
    const payload = buildLiveIntelligenceRequest(match);
    const { data, error } = await supabase.functions.invoke("live-intelligence-card", {
      body: payload,
    });

    if (error || !data?.card) {
      return fallbackIntelligence(match);
    }

    return data as LiveIntelligenceResponse;
  } catch {
    return fallbackIntelligence(match);
  }
}

