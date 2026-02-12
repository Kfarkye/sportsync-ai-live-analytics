// lib/tool-handlers.ts
import { sanitizeToolError } from "./tool-error-sanitizer.js";
function getTodayET() {
  return (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function getFutureET(daysAhead) {
  const d = /* @__PURE__ */ new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
var TOOL_HANDLERS = {
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
      const daysAhead = typeof args.days_ahead === "number" ? Math.min(Math.max(args.days_ahead, 0), 14) : 0;
      const endDate = daysAhead > 0 ? getFutureET(daysAhead) : date;
      const sport = typeof args.sport === "string" ? args.sport : null;
      const team = typeof args.team === "string" ? args.team : null;
      let query = ctx.supabase.from("matches").select("id, home_team, away_team, start_time, sport, league_id, status, home_score, away_score").gte("start_time", `${date}T00:00:00Z`).lte("start_time", `${endDate}T23:59:59Z`).order("start_time", { ascending: true }).limit(100);
      if (sport) {
        query = query.eq("sport", sport);
      }
      if (team) {
        query = query.or(`home_team.ilike.%${team}%,away_team.ilike.%${team}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return {
        success: true,
        data: {
          matches: data || [],
          count: data?.length || 0,
          date_range: `${date} to ${endDate}`
        }
      };
    } catch (err) {
      return {
        success: false,
        data: null,
        error: sanitizeToolError("get_schedule", err, ctx.requestId)
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
      const { data, error } = await ctx.supabase.from("team_game_context").select("team, injury_notes, injury_impact, situation, rest_days, fatigue_score, game_date").ilike("team", `%${team}%`).eq("game_date", today).maybeSingle();
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
            message: `No injury/context data found for ${team} on ${today}.`
          }
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
          game_date: data.game_date
        }
      };
    } catch (err) {
      return {
        success: false,
        data: null,
        error: sanitizeToolError("get_team_injuries", err, ctx.requestId)
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
      const teams = Array.isArray(args.teams) ? args.teams.filter(Boolean) : [];
      if (teams.length === 0) {
        return { success: false, data: null, error: "At least one team name is required." };
      }
      const { data, error } = await ctx.supabase.from("team_tempo").select("team, pace, ortg, drtg, net_rtg, ats_record, ats_l10, over_record, under_record, over_l10, under_l10, rank").in("team", teams);
      if (error) throw error;
      return {
        success: true,
        data: {
          teams: data || [],
          count: data?.length || 0,
          requested: teams
        }
      };
    } catch (err) {
      return {
        success: false,
        data: null,
        error: sanitizeToolError("get_team_tempo", err, ctx.requestId)
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
      const [matchRes, liveRes] = await Promise.all([
        ctx.supabase.from("matches").select("id, home_team, away_team, current_odds, status, start_time").eq("id", matchId).maybeSingle(),
        ctx.supabase.from("live_game_state").select("odds, t0_snapshot, t60_snapshot").eq("id", matchId).maybeSingle()
      ]);
      if (matchRes.error) throw matchRes.error;
      if (!matchRes.data) {
        return {
          success: false,
          data: null,
          error: `Match ${matchId} not found.`
        };
      }
      const match = matchRes.data;
      const liveState = liveRes.data;
      const currentOdds = match.current_odds || {};
      const openingOdds = liveState?.t0_snapshot?.odds || {};
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
            home: currentOdds.homeSpread ?? null,
            away: currentOdds.awaySpread ?? null,
            open_home: openingOdds.homeSpread ?? null,
            open_away: openingOdds.awaySpread ?? null
          },
          total: {
            current: currentOdds.total ?? null,
            open: openingOdds.total ?? null
          },
          moneyline: {
            home: currentOdds.homeML ?? null,
            away: currentOdds.awayML ?? null
          },
          t60_odds: liveState?.t60_snapshot?.odds ?? null
        }
      };
    } catch (err) {
      return {
        success: false,
        data: null,
        error: sanitizeToolError("get_live_odds", err, ctx.requestId)
      };
    }
  }
};
export {
  TOOL_HANDLERS
};
