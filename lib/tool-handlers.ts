/* ============================================================================
   tool-handlers.ts
   Hybrid Tool-Calling Architecture — Tool Execution Handlers

   Implements: Spec Section 4.2

   Each handler:
   1. Checks ctx.signal.aborted before querying
   2. Queries Supabase for data
   3. Returns structured ToolResult
   4. All errors go through sanitizeToolError()

   CRITICAL: get_live_odds MUST include match_id in return data 
   (pick persistence depends on this for match-scoped odds binding).
============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeToolError } from "./tool-error-sanitizer.js";

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Result of a tool execution. Returned to the model as functionResponse.
 */
export interface ToolResult {
    success: boolean;
    data: Record<string, unknown> | null;
    error?: string;
    cached?: boolean;
    latency_ms?: number;
    fetched_at?: number;
}

/**
 * Context passed to every tool handler. Request-scoped.
 */
export interface ToolContext {
    supabase: SupabaseClient;
    matchId?: string;
    signal: AbortSignal;
    requestId?: string;
}

/**
 * Tool handler function signature.
 * All handlers receive parsed args and a shared context.
 */
export type ToolHandler = (
    args: Record<string, unknown>,
    ctx: ToolContext
) => Promise<ToolResult>;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Get today's date in ET timezone as YYYY-MM-DD.
 */
function getTodayET(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Get a future ET date as YYYY-MM-DD.
 */
function getFutureET(daysAhead: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function pickNumberFromRecord(record: Record<string, unknown> | null | undefined, keys: string[]): number | null {
    if (!record) return null;
    for (const key of keys) {
        const num = toNumber(record[key]);
        if (num !== null) return num;
    }
    return null;
}

function normalizeTeamName(value: unknown): string {
    return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

function resolveOddsSportKey(match: { sport?: string | null; league_id?: string | null }): string {
    if (match.league_id && typeof match.league_id === "string") return match.league_id.toLowerCase();
    if (match.sport && typeof match.sport === "string") return match.sport.toLowerCase();
    return "nba";
}

function extractHistoricalSnapshot(
    payload: unknown,
    oddsApiEventId: string | null,
    homeTeam: string | null,
    awayTeam: string | null,
    capturedAt: string,
): {
    home_spread: number | null;
    away_spread: number | null;
    total: number | null;
    home_ml: number | null;
    away_ml: number | null;
    bookmaker: string | null;
    captured_at: string;
} | null {
    const root = payload as Record<string, unknown>;
    const events = Array.isArray(root?.data)
        ? root.data as Array<Record<string, unknown>>
        : (Array.isArray(payload) ? payload as Array<Record<string, unknown>> : []);
    if (!events.length) return null;

    const homeNorm = normalizeTeamName(homeTeam);
    const awayNorm = normalizeTeamName(awayTeam);

    let event = oddsApiEventId
        ? events.find((e) => typeof e.id === "string" && e.id === oddsApiEventId)
        : undefined;

    if (!event && homeNorm && awayNorm) {
        event = events.find((e) => {
            const eventHome = normalizeTeamName(e.home_team);
            const eventAway = normalizeTeamName(e.away_team);
            return eventHome === homeNorm && eventAway === awayNorm;
        });
    }

    if (!event) event = events[0];

    const bookmakers = Array.isArray(event.bookmakers)
        ? event.bookmakers as Array<Record<string, unknown>>
        : [];
    if (!bookmakers.length) return null;

    const preferredBooks = ["pinnacle", "draftkings", "fanduel", "betmgm", "circa", "caesars"];
    const book = preferredBooks
        .map((key) => bookmakers.find((b) => b.key === key))
        .find(Boolean) || bookmakers[0];

    const markets = Array.isArray(book.markets)
        ? book.markets as Array<Record<string, unknown>>
        : [];

    const spreads = markets.find((m) => m.key === "spreads");
    const totals = markets.find((m) => m.key === "totals");
    const h2h = markets.find((m) => m.key === "h2h");

    const spreadOutcomes = Array.isArray(spreads?.outcomes)
        ? spreads.outcomes as Array<Record<string, unknown>>
        : [];
    const totalOutcomes = Array.isArray(totals?.outcomes)
        ? totals.outcomes as Array<Record<string, unknown>>
        : [];
    const h2hOutcomes = Array.isArray(h2h?.outcomes)
        ? h2h.outcomes as Array<Record<string, unknown>>
        : [];

    const homeSpreadOutcome = spreadOutcomes.find((o) => normalizeTeamName(o.name) === homeNorm) || spreadOutcomes[0];
    const awaySpreadOutcome = spreadOutcomes.find((o) => normalizeTeamName(o.name) === awayNorm) || spreadOutcomes[1];
    const overOutcome = totalOutcomes.find((o) => normalizeTeamName(o.name) === "over") || totalOutcomes[0];
    const homeMlOutcome = h2hOutcomes.find((o) => normalizeTeamName(o.name) === homeNorm) || h2hOutcomes[0];
    const awayMlOutcome = h2hOutcomes.find((o) => normalizeTeamName(o.name) === awayNorm) || h2hOutcomes[1];

    const snapshot = {
        home_spread: toNumber(homeSpreadOutcome?.point),
        away_spread: toNumber(awaySpreadOutcome?.point),
        total: toNumber(overOutcome?.point),
        home_ml: toNumber(homeMlOutcome?.price),
        away_ml: toNumber(awayMlOutcome?.price),
        bookmaker: typeof book.title === "string" ? book.title : null,
        captured_at: capturedAt,
    };

    const hasSignal = Object.values(snapshot).some((value) => typeof value === "number" && Number.isFinite(value));
    return hasSignal ? snapshot : null;
}

function hasOpeningLine(signal: { home_spread: number | null; total: number | null; home_ml: number | null }): boolean {
    return signal.home_spread !== null || signal.total !== null || signal.home_ml !== null;
}

// ── Handler Registry ─────────────────────────────────────────────────────

export const TOOL_HANDLERS: Record<string, ToolHandler> = {

    /**
     * Get upcoming and recent games for a sport on a date.
     * All parameters are optional — defaults to today's full slate.
     * 
     * Query: matches WHERE start_time in range, optional sport/team filter
     * LIMIT 100. ORDER BY start_time ASC.
     */
    get_schedule: async (args, ctx) => {
        if (ctx.signal.aborted) {
            return { success: false, data: null, error: "Request cancelled." };
        }

        try {
            const date = typeof args.date === "string" ? args.date : getTodayET();
            // days_ahead means "additional days beyond target date".
            // Default 0 = today only. Max 14.
            // OFF-BY-ONE FIX: previously defaulted to 1, which turned
            // "what games today?" into a 2-day window (today + tomorrow).
            const daysAhead = typeof args.days_ahead === "number"
                ? Math.min(Math.max(args.days_ahead, 0), 14)
                : 0;
            const endDate = daysAhead > 0 ? getFutureET(daysAhead) : date;
            const sport = typeof args.sport === "string" ? args.sport : null;
            const team = typeof args.team === "string" ? args.team : null;

            let query = ctx.supabase
                .from("matches")
                .select("id, home_team, away_team, start_time, sport, league_id, status, home_score, away_score")
                .gte("start_time", `${date}T00:00:00Z`)
                .lte("start_time", `${endDate}T23:59:59Z`)
                .order("start_time", { ascending: true })
                .limit(100);

            if (sport) {
                query = query.eq("sport", sport);
            }

            if (team) {
                // Partial match on either team
                query = query.or(`home_team.ilike.%${team}%,away_team.ilike.%${team}%`);
            }

            const { data, error } = await query;
            if (error) throw error;

            return {
                success: true,
                data: {
                    matches: data || [],
                    count: data?.length || 0,
                    date_range: `${date} to ${endDate}`,
                },
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: sanitizeToolError("get_schedule", err, ctx.requestId),
            };
        }
    },

    /**
     * Get injury report, rest days, travel situation, fatigue data for a team.
     * Primary source: team_game_context table (pre-computed by sync cron).
     * 
     * Query: team_game_context WHERE team ilike $team AND game_date = today ET
     */
    get_team_injuries: async (args, ctx) => {
        if (ctx.signal.aborted) {
            return { success: false, data: null, error: "Request cancelled." };
        }

        try {
            const team = typeof args.team === "string" ? args.team : "";
            if (!team) {
                return { success: false, data: null, error: "Team name is required." };
            }

            const today = getTodayET();

            const { data, error } = await ctx.supabase
                .from("team_game_context")
                .select("team, injury_notes, injury_impact, situation, rest_days, fatigue_score, game_date")
                .ilike("team", `%${team}%`)
                .eq("game_date", today)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                return {
                    success: true,
                    data: {
                        team,
                        injury_notes: null,
                        injury_impact: null,
                        situation: null,
                        rest_days: null,
                        fatigue_score: null,
                        message: `No injury/context data found for ${team} on ${today}.`,
                    },
                };
            }

            return {
                success: true,
                data: {
                    team: data.team,
                    injury_notes: data.injury_notes,
                    injury_impact: data.injury_impact,
                    situation: data.situation,
                    rest_days: data.rest_days,
                    fatigue_score: data.fatigue_score,
                    game_date: data.game_date,
                },
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: sanitizeToolError("get_team_injuries", err, ctx.requestId),
            };
        }
    },

    /**
     * Get pace, offensive/defensive efficiency, ATS record, over/under trends.
     * 
     * Query: team_tempo WHERE team IN ($teams)
     */
    get_team_tempo: async (args, ctx) => {
        if (ctx.signal.aborted) {
            return { success: false, data: null, error: "Request cancelled." };
        }

        try {
            const teams = Array.isArray(args.teams) ? args.teams.filter(Boolean) as string[] : [];
            if (teams.length === 0) {
                return { success: false, data: null, error: "At least one team name is required." };
            }

            const { data, error } = await ctx.supabase
                .from("team_tempo")
                .select("team, pace, ortg, drtg, net_rtg, ats_record, ats_l10, over_record, under_record, over_l10, under_l10, rank")
                .in("team", teams);

            if (error) throw error;

            return {
                success: true,
                data: {
                    teams: data || [],
                    count: data?.length || 0,
                    requested: teams,
                },
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: sanitizeToolError("get_team_tempo", err, ctx.requestId),
            };
        }
    },

    /**
     * Get current and opening odds (spread, total, moneyline) for a match.
     * 
     * CRITICAL: Include match_id in return data for pick persistence binding.
     * 
     * Query: matches JOIN live_game_state for odds
     */
    get_live_odds: async (args, ctx) => {
        if (ctx.signal.aborted) {
            return { success: false, data: null, error: "Request cancelled." };
        }

        try {
            const matchId = typeof args.match_id === "string" ? args.match_id : "";
            if (!matchId) {
                return { success: false, data: null, error: "match_id is required." };
            }

            // Fetch from matches table (contains current_odds) and live_game_state (contains opening/live odds)
            const [matchRes, liveRes, openingRes] = await Promise.all([
                ctx.supabase
                    .from("matches")
                    .select("id, home_team, away_team, current_odds, status, start_time, sport, league_id, odds_api_event_id")
                    .eq("id", matchId)
                    .maybeSingle(),
                ctx.supabase
                    .from("live_game_state")
                    .select("odds, t0_snapshot, t60_snapshot")
                    .eq("id", matchId)
                    .maybeSingle(),
                ctx.supabase
                    .from("opening_lines")
                    .select("home_spread, away_spread, total, home_ml, away_ml, provider, created_at")
                    .eq("match_id", matchId)
                    .maybeSingle(),
            ]);

            if (matchRes.error) throw matchRes.error;

            if (!matchRes.data) {
                return {
                    success: false,
                    data: null,
                    error: `Match ${matchId} not found.`,
                };
            }

            const match = matchRes.data;
            const liveState = liveRes.data;
            const currentOdds = (match.current_odds || {}) as Record<string, unknown>;
            const openingFromSnapshot = (liveState?.t0_snapshot?.odds || {}) as Record<string, unknown>;
            const openingFromTable = (openingRes.data || {}) as Record<string, unknown>;

            const currentHomeSpread = pickNumberFromRecord(currentOdds, ["homeSpread", "home_spread", "spread"]);
            const currentAwaySpread = pickNumberFromRecord(currentOdds, ["awaySpread", "away_spread"]);
            const currentTotal = pickNumberFromRecord(currentOdds, ["total", "overUnder"]);
            const currentHomeML = pickNumberFromRecord(currentOdds, ["homeML", "moneylineHome", "home_ml"]);
            const currentAwayML = pickNumberFromRecord(currentOdds, ["awayML", "moneylineAway", "away_ml"]);

            let openingSignal = {
                home_spread: pickNumberFromRecord(openingFromTable, ["home_spread", "homeSpread", "spread"]),
                away_spread: pickNumberFromRecord(openingFromTable, ["away_spread", "awaySpread"]),
                total: pickNumberFromRecord(openingFromTable, ["total"]),
                home_ml: pickNumberFromRecord(openingFromTable, ["home_ml", "homeML"]),
                away_ml: pickNumberFromRecord(openingFromTable, ["away_ml", "awayML"]),
                source: "opening_lines",
                captured_at: typeof openingFromTable.created_at === "string" ? openingFromTable.created_at : null as string | null,
                bookmaker: typeof openingFromTable.provider === "string" ? openingFromTable.provider : null as string | null,
            };

            if (!hasOpeningLine(openingSignal)) {
                openingSignal = {
                    home_spread: pickNumberFromRecord(openingFromSnapshot, ["homeSpread", "home_spread", "spread"]),
                    away_spread: pickNumberFromRecord(openingFromSnapshot, ["awaySpread", "away_spread"]),
                    total: pickNumberFromRecord(openingFromSnapshot, ["total", "overUnder"]),
                    home_ml: pickNumberFromRecord(openingFromSnapshot, ["homeML", "moneylineHome", "home_ml"]),
                    away_ml: pickNumberFromRecord(openingFromSnapshot, ["awayML", "moneylineAway", "away_ml"]),
                    source: "live_game_state.t0_snapshot",
                    captured_at: typeof liveState?.t0_snapshot?.timestamp === "string" ? liveState.t0_snapshot.timestamp : null,
                    bookmaker: null,
                };
            }

            if (!hasOpeningLine(openingSignal) && match.start_time) {
                const kickoffMs = new Date(match.start_time).getTime();
                if (Number.isFinite(kickoffMs)) {
                    const probeOffsetsHours = [24, 8];
                    for (const offset of probeOffsetsHours) {
                        if (ctx.signal.aborted) break;
                        const probeDate = new Date(kickoffMs - offset * 60 * 60 * 1000).toISOString();
                        try {
                            const { data } = await ctx.supabase.functions.invoke("get-odds", {
                                body: {
                                    action: "historical",
                                    sport: resolveOddsSportKey({ sport: match.sport, league_id: match.league_id }),
                                    date: probeDate,
                                },
                            });

                            const historical = extractHistoricalSnapshot(
                                data,
                                typeof match.odds_api_event_id === "string" ? match.odds_api_event_id : null,
                                typeof match.home_team === "string" ? match.home_team : null,
                                typeof match.away_team === "string" ? match.away_team : null,
                                probeDate,
                            );

                            if (historical) {
                                openingSignal = {
                                    ...historical,
                                    source: "odds_api_historical",
                                };
                                break;
                            }
                        } catch {
                            // Historical probe is best-effort; continue to next probe.
                        }
                    }
                }
            }

            if (!hasOpeningLine(openingSignal)) {
                openingSignal.source = "unavailable";
            }

            const spreadDelta = currentHomeSpread !== null && openingSignal.home_spread !== null
                ? Number((currentHomeSpread - openingSignal.home_spread).toFixed(2))
                : null;
            const totalDelta = currentTotal !== null && openingSignal.total !== null
                ? Number((currentTotal - openingSignal.total).toFixed(2))
                : null;
            const homeMlDelta = currentHomeML !== null && openingSignal.home_ml !== null
                ? Number((currentHomeML - openingSignal.home_ml).toFixed(0))
                : null;

            return {
                success: true,
                data: {
                    // CRITICAL: match_id included for pick persistence binding
                    match_id: matchId,
                    home_team: match.home_team,
                    away_team: match.away_team,
                    status: match.status,
                    start_time: match.start_time,
                    spread: {
                        home: currentHomeSpread,
                        away: currentAwaySpread,
                        open_home: openingSignal.home_spread,
                        open_away: openingSignal.away_spread,
                    },
                    total: {
                        current: currentTotal,
                        open: openingSignal.total,
                    },
                    moneyline: {
                        home: currentHomeML,
                        away: currentAwayML,
                        open_home: openingSignal.home_ml,
                        open_away: openingSignal.away_ml,
                    },
                    line_movement: {
                        available: hasOpeningLine(openingSignal),
                        source: openingSignal.source,
                        opening_timestamp: openingSignal.captured_at,
                        spread_home_delta: spreadDelta,
                        total_delta: totalDelta,
                        home_ml_delta: homeMlDelta,
                    },
                    line_notes: hasOpeningLine(openingSignal)
                        ? "Opening and current lines are sourced from captured market data."
                        : "Opening line unavailable from opening_lines, t0 snapshot, and Odds API historical probes.",
                    t60_odds: liveState?.t60_snapshot?.odds ?? null,
                },
            };
        } catch (err) {
            return {
                success: false,
                data: null,
                error: sanitizeToolError("get_live_odds", err, ctx.requestId),
            };
        }
    },
};
