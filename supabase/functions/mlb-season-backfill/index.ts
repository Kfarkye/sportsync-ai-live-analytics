import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DRAIN_VERSION = "backfill-2025-v1";
const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard";
const ESPN_SUMMARY_URL =
  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary";
const FETCH_TIMEOUT_MS = 15000;
const ESPN_DELAY_MS = 200;
const DEFAULT_START_DATE = "2025-03-27";
const DEFAULT_END_DATE = "2025-11-01";
const DEFAULT_BATCH_SIZE = 15;
const MAX_BATCH_SIZE = 100;

type ScoreboardEventCandidate = {
  eventId: string;
  matchId: string;
  date: string;
  startTime: string | null;
  statusName: string | null;
  statusDetail: string | null;
};

type CanonicalMatchInfo = {
  canonical_game_id: string | null;
  canonical_id: string | null;
};

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[,%$]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asInt(value: unknown): number | null {
  const number = asNumber(value);
  return number === null ? null : Math.trunc(number);
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return null;
}

function normalizeKey(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
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
    const payload = value as Record<string, unknown>;
    return (
      parsePrice(payload.american) ??
      parsePrice(payload.value) ??
      parsePrice(payload.moneyLine) ??
      parsePrice(payload.odds) ??
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
    const payload = value as Record<string, unknown>;
    return (
      parsePoints(payload.value) ??
      parsePoints(payload.points) ??
      parsePoints(payload.line) ??
      parsePoints(payload.american) ??
      null
    );
  }
  return null;
}

function toIsoDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toISOString().slice(0, 10);
}

function parseDateInput(value: unknown, fallback: string): string {
  const candidate = asString(value);
  if (!candidate) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback;
  const date = new Date(`${candidate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return fallback;
  return toIsoDate(candidate);
}

function toScoreboardDate(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

function* dateRange(startDate: string, endDate: string): Generator<string> {
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string): Promise<{
  ok: boolean;
  status: number;
  data: any;
  error?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: payload,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    return { ok: true, status: response.status, data: payload };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.message ?? String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isFinalStatus(statusName: string | null, statusDetail: string | null): boolean {
  const name = String(statusName ?? "").toUpperCase();
  const detail = String(statusDetail ?? "").toUpperCase();
  const combined = `${name} ${detail}`;
  if (combined.includes("POSTPONED") || combined.includes("CANCEL")) return false;
  return (
    combined.includes("FINAL") ||
    combined.includes("STATUS_FINAL") ||
    combined.includes("FULL TIME") ||
    combined.includes("COMPLETED")
  );
}

function seasonTypeFromCode(code: number | null): "regular" | "postseason" | "preseason" {
  if (code === 2) return "regular";
  if (code === 3) return "postseason";
  return "preseason";
}

function resolveSeasonType(summary: any, startTime: string | null): "regular" | "postseason" | "preseason" {
  const code =
    asInt(summary?.header?.season?.type) ??
    asInt(summary?.season?.type) ??
    asInt(summary?.header?.competitions?.[0]?.season?.type);
  if (code !== null) return seasonTypeFromCode(code);

  if (!startTime) return "regular";
  const dt = new Date(startTime);
  if (Number.isNaN(dt.getTime())) return "regular";
  const month = dt.getUTCMonth() + 1;
  if (month >= 10) return "postseason";
  if (month <= 3) return "preseason";
  return "regular";
}

function extractFullCategory(stats: any[], categoryName: string): Record<string, unknown> | null {
  const category = (stats || []).find((entry) => {
    const name = normalizeKey(asString(entry?.name));
    const type = normalizeKey(asString(entry?.type));
    const target = normalizeKey(categoryName);
    return name === target || type === target;
  });
  if (!category?.stats || !Array.isArray(category.stats)) return null;
  const out: Record<string, unknown> = {};
  for (const stat of category.stats) {
    const key = asString(stat?.abbreviation) ?? asString(stat?.name);
    if (!key) continue;
    out[key] = stat?.displayValue ?? stat?.value ?? null;
  }
  return out;
}

function pickStatValue(statsObject: Record<string, unknown> | null, keys: string[]): unknown {
  if (!statsObject) return null;
  for (const key of keys) {
    if (statsObject[key] !== undefined && statsObject[key] !== null) return statsObject[key];
  }
  return null;
}

function pickStatNumber(statsObject: Record<string, unknown> | null, keys: string[]): number | null {
  return asNumber(pickStatValue(statsObject, keys));
}

function pickStatInt(statsObject: Record<string, unknown> | null, keys: string[]): number | null {
  return asInt(pickStatValue(statsObject, keys));
}

function getCompetitor(summary: any, side: "home" | "away"): any {
  return summary?.header?.competitions?.[0]?.competitors?.find((c: any) => c?.homeAway === side) ?? null;
}

function mapTeamSides(summary: any): {
  sideByTeamId: Map<string, "home" | "away">;
  sideByTeamName: Map<string, "home" | "away">;
} {
  const sideByTeamId = new Map<string, "home" | "away">();
  const sideByTeamName = new Map<string, "home" | "away">();
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  for (const competitor of competitors) {
    const side = competitor?.homeAway === "home" ? "home" : competitor?.homeAway === "away" ? "away" : null;
    if (!side) continue;
    const teamId = asString(competitor?.team?.id);
    const teamName = asString(competitor?.team?.displayName);
    if (teamId) sideByTeamId.set(teamId, side);
    if (teamName) sideByTeamName.set(teamName, side);
  }
  return { sideByTeamId, sideByTeamName };
}

function getTeamBox(summary: any, side: "home" | "away"): any {
  const competitor = getCompetitor(summary, side);
  const competitorTeamId = asString(competitor?.team?.id);
  const boxTeams = summary?.boxscore?.teams || [];
  if (competitorTeamId) {
    const byId = boxTeams.find((team: any) => asString(team?.team?.id) === competitorTeamId);
    if (byId) return byId;
  }
  return side === "away" ? boxTeams[0] ?? null : boxTeams[1] ?? null;
}

function getLinescoreRuns(linescores: any[]): number[] {
  return (linescores || []).map((entry: any) => asInt(entry?.value) ?? asInt(entry?.displayValue) ?? 0);
}

function sumRuns(values: number[], startInclusive: number, endExclusive: number): number {
  let total = 0;
  for (let i = startInclusive; i < Math.min(endExclusive, values.length); i += 1) {
    total += values[i] ?? 0;
  }
  return total;
}

function buildStatMap(labels: any[], values: any[]): Record<string, string | null> {
  const mapped: Record<string, string | null> = {};
  for (let idx = 0; idx < labels.length; idx += 1) {
    const rawKey = asString(labels[idx]);
    const value = asString(values?.[idx]);
    if (rawKey) mapped[rawKey] = value;
    const normalized = normalizeKey(rawKey);
    if (normalized) mapped[normalized] = value;
  }
  return mapped;
}

function pickCategory(playerGroup: any, mode: "pitching" | "batting"): any | null {
  const categories = playerGroup?.statistics;
  if (!Array.isArray(categories) || categories.length === 0) return null;
  if (mode === "pitching") {
    return (
      categories.find((cat: any) =>
        (cat?.labels || []).some((label: any) => normalizeKey(asString(label)) === "IP")) ??
      categories.find((cat: any) => normalizeKey(asString(cat?.name)).includes("PITCH")) ??
      categories[1] ??
      null
    );
  }
  return (
    categories.find((cat: any) =>
      (cat?.labels || []).some((label: any) => normalizeKey(asString(label)) === "AB")) ??
    categories.find((cat: any) => normalizeKey(asString(cat?.name)).includes("BATT")) ??
    categories[0] ??
    null
  );
}

function parsePitchSummary(raw: string | null): { pitches: number | null; strikes: number | null } {
  if (!raw) return { pitches: null, strikes: null };
  const numbers = raw
    .split(/[^0-9]+/)
    .map((part) => parseInt(part, 10))
    .filter((value) => Number.isFinite(value));
  return {
    pitches: numbers[0] ?? null,
    strikes: numbers[1] ?? null,
  };
}

function inningsToOuts(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  const [wholePart, fractionalPart = "0"] = cleaned.split(".");
  const whole = parseInt(wholePart, 10);
  if (Number.isNaN(whole)) return null;
  const fractional = parseInt(fractionalPart.slice(0, 1) || "0", 10);
  if (!Number.isFinite(fractional) || fractional < 0 || fractional > 2) return null;
  return whole * 3 + fractional;
}

function outsToInningsDecimal(outs: number | null): number | null {
  if (outs === null || outs <= 0) return null;
  return outs / 3;
}

function extractHomePlateUmpire(gameInfo: any): { name: string | null; id: string | null } {
  const officials = Array.isArray(gameInfo?.officials) ? gameInfo.officials : [];
  const homePlate = officials.find((official: any) => {
    const position = String(official?.position?.name ?? "").toLowerCase();
    return position.includes("home plate") || asInt(official?.order) === 1;
  });
  if (!homePlate) return { name: null, id: null };
  return {
    name:
      asString(homePlate?.displayName) ??
      asString(homePlate?.fullName) ??
      asString(homePlate?.name),
    id: asString(homePlate?.id),
  };
}

function getHourInTimeZone(date: Date, timeZone: string): number | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone,
    });
    const hour = parseInt(formatter.format(date), 10);
    return Number.isFinite(hour) ? hour : null;
  } catch {
    return null;
  }
}

function resolveDayNight(startTime: string | null, gameInfo: any): "day" | "night" | null {
  const provided = asString(gameInfo?.dayNight) ?? asString(gameInfo?.dayOrNight);
  if (provided) {
    const normalized = provided.toLowerCase();
    if (normalized.includes("day")) return "day";
    if (normalized.includes("night")) return "night";
  }
  if (!startTime) return null;
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return null;
  const timeZone =
    asString(gameInfo?.venue?.address?.timezone) ??
    asString(gameInfo?.venue?.timezone) ??
    asString(gameInfo?.timezone);
  const hour = timeZone ? getHourInTimeZone(date, timeZone) : date.getUTCHours();
  if (hour === null) return null;
  return hour < 17 ? "day" : "night";
}

function extractOdds(summary: any): {
  dk_home_ml: number | null;
  dk_away_ml: number | null;
  dk_spread: number | null;
  dk_total: number | null;
  dk_over_price: number | null;
  dk_under_price: number | null;
  home_run_line: number | null;
} {
  const pickcenter = summary?.pickcenter?.[0];
  if (!pickcenter) {
    return {
      dk_home_ml: null,
      dk_away_ml: null,
      dk_spread: null,
      dk_total: null,
      dk_over_price: null,
      dk_under_price: null,
      home_run_line: null,
    };
  }
  return {
    dk_home_ml: parsePrice(pickcenter?.homeTeamOdds?.moneyLine),
    dk_away_ml: parsePrice(pickcenter?.awayTeamOdds?.moneyLine),
    dk_spread: parsePoints(pickcenter?.spread),
    dk_total: parsePoints(pickcenter?.overUnder),
    dk_over_price: parsePrice(pickcenter?.overOdds),
    dk_under_price: parsePrice(pickcenter?.underOdds),
    home_run_line:
      parsePoints(pickcenter?.homeTeamOdds?.runLine) ??
      parsePoints(pickcenter?.homeTeamOdds?.spread) ??
      parsePoints(pickcenter?.spread),
  };
}

function buildInningScoreRow(
  summary: any,
  eventId: string,
  matchId: string,
  seasonType: "regular" | "postseason",
  startTime: string | null,
  homeTeam: string | null,
  awayTeam: string | null,
  homeScore: number | null,
  awayScore: number | null,
  homeHits: number | null,
  awayHits: number | null,
  homeErrors: number | null,
  awayErrors: number | null,
  drainedAt: string,
): Record<string, unknown> {
  const homeCompetitor = getCompetitor(summary, "home");
  const awayCompetitor = getCompetitor(summary, "away");
  const homeInnings = getLinescoreRuns(homeCompetitor?.linescores || []);
  const awayInnings = getLinescoreRuns(awayCompetitor?.linescores || []);
  const totalInnings = Math.max(homeInnings.length, awayInnings.length);

  return {
    id: eventId,
    match_id: matchId,
    espn_event_id: eventId,
    game_date: startTime ? startTime.slice(0, 10) : null,
    season_type: seasonType,
    home_team: homeTeam,
    away_team: awayTeam,
    home_score: homeScore,
    away_score: awayScore,
    home_runs: homeScore,
    away_runs: awayScore,
    total_runs:
      homeScore !== null && awayScore !== null ? homeScore + awayScore : null,
    home_hits: homeHits,
    away_hits: awayHits,
    home_errors: homeErrors,
    away_errors: awayErrors,
    home_innings: homeInnings,
    away_innings: awayInnings,
    home_first_inning_runs: homeInnings[0] ?? 0,
    away_first_inning_runs: awayInnings[0] ?? 0,
    home_f5_runs: sumRuns(homeInnings, 0, 5),
    away_f5_runs: sumRuns(awayInnings, 0, 5),
    total_f5_runs: sumRuns(homeInnings, 0, 5) + sumRuns(awayInnings, 0, 5),
    home_l4_runs: sumRuns(homeInnings, 5, 9),
    away_l4_runs: sumRuns(awayInnings, 5, 9),
    total_l4_runs: sumRuns(homeInnings, 5, 9) + sumRuns(awayInnings, 5, 9),
    total_innings: totalInnings,
    is_extra_innings: totalInnings > 9,
    drain_version: DRAIN_VERSION,
    last_drained_at: drainedAt,
    updated_at: drainedAt,
  };
}

function extractPitcherRows(
  summary: any,
  eventId: string,
  matchId: string,
  seasonType: "regular" | "postseason",
  startTime: string | null,
  homeTeam: string | null,
  awayTeam: string | null,
  drainedAt: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const groups = summary?.boxscore?.players || [];
  const { sideByTeamId, sideByTeamName } = mapTeamSides(summary);

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const teamId = asString(group?.team?.id);
    const teamName = asString(group?.team?.displayName);
    const side =
      (teamId && sideByTeamId.get(teamId)) ||
      (teamName && sideByTeamName.get(teamName)) ||
      (groupIndex === 0 ? "away" : groupIndex === 1 ? "home" : null);
    if (!side) continue;

    const category = pickCategory(group, "pitching");
    if (!category) continue;
    const labels = Array.isArray(category?.labels) ? category.labels : [];
    const athletes = Array.isArray(category?.athletes) ? category.athletes : [];
    const opponentTeam = side === "home" ? awayTeam : homeTeam;

    for (let athleteIndex = 0; athleteIndex < athletes.length; athleteIndex += 1) {
      const athleteRow = athletes[athleteIndex];
      const athleteId = asString(athleteRow?.athlete?.id);
      const athleteName =
        asString(athleteRow?.athlete?.displayName) ??
        asString(athleteRow?.athlete?.fullName);
      if (!athleteId || !athleteName) continue;

      const statMap = buildStatMap(labels, athleteRow?.stats || []);
      const pitchSummaryRaw =
        statMap.PCST ??
        statMap.PCS ??
        statMap.PS ??
        statMap.SP ??
        statMap.PITCHSTRIKE;
      const parsedPitch = parsePitchSummary(pitchSummaryRaw ?? null);
      const inningsPitched = statMap.IP ?? null;
      const inningsOuts = inningsToOuts(inningsPitched);

      const pitchesThrown = parsedPitch.pitches ?? asInt(statMap.PC) ?? asInt(statMap.P);
      const strikes = parsedPitch.strikes ?? asInt(statMap.S);
      const strikesThrown = strikes ?? asInt(statMap.STRIKES);
      const inningsDecimal = outsToInningsDecimal(inningsOuts);
      const strikePct =
        pitchesThrown && pitchesThrown > 0 && strikesThrown !== null
          ? Number((strikesThrown / pitchesThrown).toFixed(4))
          : asNumber(statMap.STRIKEPCT);

      const earnedRuns = asInt(statMap.ER);
      const isStarter = athleteRow?.starter === true || athleteIndex === 0;
      const qualityStart =
        inningsOuts !== null && earnedRuns !== null
          ? inningsOuts >= 18 && earnedRuns <= 3
          : asBoolean(statMap.QS);

      const rowId = `${eventId}_${athleteId}_mlb`;
      const now = drainedAt;

      rows.push({
        id: rowId,
        match_id: matchId,
        espn_event_id: eventId,
        game_date: startTime ? startTime.slice(0, 10) : null,
        season_type: seasonType,
        team: teamName,
        team_abbr: asString(group?.team?.abbreviation),
        home_away: side,
        is_home: side === "home",
        opponent: opponentTeam,
        opponent_team: opponentTeam,
        athlete_id: athleteId,
        athlete_name: athleteName,
        is_starter: isStarter,
        pitch_order: athleteIndex + 1,
        innings_pitched: inningsPitched,
        innings_outs: inningsOuts,
        hits_allowed: asInt(statMap.H),
        runs_allowed: asInt(statMap.R),
        earned_runs: earnedRuns,
        walks: asInt(statMap.BB),
        strikeouts: asInt(statMap.K) ?? asInt(statMap.SO),
        home_runs_allowed: asInt(statMap.HR),
        pitches_thrown: pitchesThrown,
        strikes: strikes,
        strikes_thrown: strikesThrown,
        era: asNumber(statMap.ERA),
        whip: asNumber(statMap.WHIP),
        decision:
          asString(athleteRow?.decision) ??
          asString(athleteRow?.note) ??
          asString(athleteRow?.result),
        ground_balls: asNumber(statMap.GB),
        fly_balls: asNumber(statMap.FB),
        line_drives: asNumber(statMap.LD),
        ground_balls_count: asInt(statMap.GB),
        fly_balls_count: asInt(statMap.FB),
        gb_fb_ratio: asNumber(statMap.GF) ?? asNumber(statMap.GFB),
        game_score: asNumber(statMap.GSC),
        game_score_value: asNumber(statMap.GSC),
        quality_start: qualityStart,
        total_batters_faced: asInt(statMap.TBF),
        inherited_runners: asInt(statMap.IR),
        inherited_runners_scored: asInt(statMap.IRS),
        holds: asInt(statMap.HLD),
        blown_saves: asInt(statMap.BLSV),
        save_opportunities: asInt(statMap.SVOP),
        opp_batting_avg: asNumber(statMap.OBA),
        opp_obp: asNumber(statMap.OOBP),
        opp_slg: asNumber(statMap.OSLUG),
        opp_ops: asNumber(statMap.OOPS),
        k_per_9: asNumber(statMap.K9),
        k_bb_ratio: asNumber(statMap.KBB),
        pitches_per_inning:
          pitchesThrown !== null && inningsDecimal !== null && inningsDecimal > 0
            ? Number((pitchesThrown / inningsDecimal).toFixed(4))
            : null,
        strike_pct: strikePct,
        war_value: asNumber(statMap.WAR),
        raw_stats: statMap,
        drain_version: DRAIN_VERSION,
        last_drained_at: now,
        created_at: now,
        updated_at: now,
      });
    }
  }

  return rows;
}

function extractBatterRows(
  summary: any,
  eventId: string,
  matchId: string,
  seasonType: "regular" | "postseason",
  startTime: string | null,
  homeTeam: string | null,
  awayTeam: string | null,
  drainedAt: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const groups = summary?.boxscore?.players || [];
  const { sideByTeamId, sideByTeamName } = mapTeamSides(summary);

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const teamId = asString(group?.team?.id);
    const teamName = asString(group?.team?.displayName);
    const side =
      (teamId && sideByTeamId.get(teamId)) ||
      (teamName && sideByTeamName.get(teamName)) ||
      (groupIndex === 0 ? "away" : groupIndex === 1 ? "home" : null);
    if (!side) continue;

    const category = pickCategory(group, "batting");
    if (!category) continue;
    const labels = Array.isArray(category?.labels) ? category.labels : [];
    const athletes = Array.isArray(category?.athletes) ? category.athletes : [];
    const opponentTeam = side === "home" ? awayTeam : homeTeam;

    for (let athleteIndex = 0; athleteIndex < athletes.length; athleteIndex += 1) {
      const athleteRow = athletes[athleteIndex];
      const athleteId = asString(athleteRow?.athlete?.id);
      const athleteName =
        asString(athleteRow?.athlete?.displayName) ??
        asString(athleteRow?.athlete?.fullName);
      if (!athleteId || !athleteName) continue;

      const statMap = buildStatMap(labels, athleteRow?.stats || []);
      const rowId = `${eventId}_${athleteId}_bat_mlb`;
      const now = drainedAt;

      rows.push({
        id: rowId,
        match_id: matchId,
        espn_event_id: eventId,
        game_date: startTime ? startTime.slice(0, 10) : null,
        season_type: seasonType,
        team: teamName,
        team_abbr: asString(group?.team?.abbreviation),
        opponent: opponentTeam,
        athlete_id: athleteId,
        athlete_name: athleteName,
        is_home: side === "home",
        batting_order:
          asInt(athleteRow?.battingOrder) ??
          asInt(athleteRow?.order) ??
          athleteIndex + 1,
        position:
          asString(athleteRow?.athlete?.position?.abbreviation) ??
          asString(athleteRow?.athlete?.position?.displayName) ??
          asString(athleteRow?.position?.abbreviation),
        at_bats: asInt(statMap.AB),
        runs: asInt(statMap.R),
        hits: asInt(statMap.H),
        doubles: asInt(statMap["2B"]),
        triples: asInt(statMap["3B"]),
        home_runs: asInt(statMap.HR),
        rbi: asInt(statMap.RBI),
        walks: asInt(statMap.BB),
        strikeouts: asInt(statMap.K) ?? asInt(statMap.SO),
        stolen_bases: asInt(statMap.SB),
        caught_stealing: asInt(statMap.CS),
        hit_by_pitch: asInt(statMap.HBP),
        total_bases: asInt(statMap.TB),
        extra_base_hits: asInt(statMap.XBH),
        batting_avg: asNumber(statMap.AVG),
        obp: asNumber(statMap.OBP),
        slg: asNumber(statMap.SLG),
        ops: asNumber(statMap.OPS),
        isolated_power: asNumber(statMap.ISOP),
        secondary_avg: asNumber(statMap.SECA),
        runs_created: asNumber(statMap.RC),
        runs_created_27: asNumber(statMap.RC27),
        bb_k_ratio: asNumber(statMap.BBK),
        ab_per_hr: asNumber(statMap.ABHR),
        go_fo_ratio: asNumber(statMap.GOFO),
        sb_pct: asNumber(statMap["SB%"]) ?? asNumber(statMap.SBPCT),
        war: asNumber(statMap.WAR),
        plate_appearances: asInt(statMap.PA),
        sac_flies: asInt(statMap.SF),
        sac_bunts: asInt(statMap.SH),
        gidp: asInt(statMap.GIDP),
        lob: asInt(statMap.LOB),
        raw_stats: statMap,
        drain_version: DRAIN_VERSION,
        last_drained_at: now,
        created_at: now,
        updated_at: now,
      });
    }
  }

  return rows;
}

async function ensureMatchAndCanonical(
  supabase: ReturnType<typeof createClient>,
  candidate: ScoreboardEventCandidate,
  summary: any,
  canonicalHint: string | null,
): Promise<string | null> {
  const competition = summary?.header?.competitions?.[0] ?? {};
  const homeCompetitor = getCompetitor(summary, "home");
  const awayCompetitor = getCompetitor(summary, "away");
  const startTime =
    asString(competition?.date) ??
    asString(summary?.header?.competitions?.[0]?.date) ??
    candidate.startTime;
  const status =
    asString(competition?.status?.type?.name) ??
    asString(summary?.header?.competitions?.[0]?.status?.type?.name) ??
    "STATUS_FINAL";
  const homeTeam = asString(homeCompetitor?.team?.displayName);
  const awayTeam = asString(awayCompetitor?.team?.displayName);
  const homeScore = asInt(homeCompetitor?.score);
  const awayScore = asInt(awayCompetitor?.score);

  const { error: matchUpsertError } = await supabase.from("matches").upsert(
    {
      id: candidate.matchId,
      home_team: homeTeam,
      away_team: awayTeam,
      league_id: "mlb",
      sport: "baseball",
      status,
      status_state: "post",
      start_time: startTime,
      home_score: homeScore,
      away_score: awayScore,
    },
    { onConflict: "id" },
  );
  if (matchUpsertError) return null;

  const canonicalGameId = canonicalHint ?? candidate.matchId;
  const { data: canonicalRow, error: canonicalLookupError } = await supabase
    .from("canonical_games")
    .select("id")
    .eq("id", canonicalGameId)
    .limit(1)
    .maybeSingle();
  if (canonicalLookupError) return null;

  if (!canonicalRow?.id) {
    const { error: canonicalInsertError } = await supabase.from("canonical_games").insert({
      id: canonicalGameId,
      league_id: "mlb",
      sport: "baseball",
      home_team_name: homeTeam,
      away_team_name: awayTeam,
      commence_time: startTime,
      status,
      game_uuid: crypto.randomUUID(),
    });
    if (canonicalInsertError) return null;
  }

  const { error: matchCanonicalError } = await supabase
    .from("matches")
    .update({
      canonical_id: canonicalGameId,
      canonical_game_id: canonicalGameId,
    })
    .eq("id", candidate.matchId);
  if (matchCanonicalError) return null;

  const { data: mappingRow, error: mappingLookupError } = await supabase
    .from("entity_mappings")
    .select("canonical_id")
    .eq("provider", "ESPN")
    .eq("external_id", candidate.eventId)
    .limit(1)
    .maybeSingle();
  if (!mappingLookupError && !mappingRow?.canonical_id) {
    await supabase.from("entity_mappings").insert({
      canonical_id: canonicalGameId,
      provider: "ESPN",
      external_id: candidate.eventId,
      confidence_score: 1,
      discovery_method: "mlb_2025_backfill",
    });
  }

  return canonicalGameId;
}

function buildPostgameRow(
  summary: any,
  candidate: ScoreboardEventCandidate,
  canonicalGameId: string | null,
  drainedAt: string,
): {
  postgame: Record<string, unknown>;
  inningScores: Record<string, unknown>;
  pitcherRows: Record<string, unknown>[];
  batterRows: Record<string, unknown>[];
} | null {
  const eventId = candidate.eventId;
  const matchId = candidate.matchId;
  const competition = summary?.header?.competitions?.[0] ?? {};
  const statusName =
    asString(competition?.status?.type?.name) ??
    asString(summary?.header?.competitions?.[0]?.status?.type?.name);
  const statusDetail = asString(competition?.status?.type?.detail);
  if (!isFinalStatus(statusName, statusDetail)) return null;

  const seasonType = resolveSeasonType(summary, candidate.startTime);
  if (seasonType === "preseason") return null;

  const gameInfo = summary?.gameInfo || {};
  const venue = gameInfo?.venue || {};
  const weather = gameInfo?.weather || {};
  const homeCompetitor = getCompetitor(summary, "home");
  const awayCompetitor = getCompetitor(summary, "away");
  const homeTeamBox = getTeamBox(summary, "home");
  const awayTeamBox = getTeamBox(summary, "away");
  const homeStats = homeTeamBox?.statistics || [];
  const awayStats = awayTeamBox?.statistics || [];
  const homeBattingStats = extractFullCategory(homeStats, "batting");
  const awayBattingStats = extractFullCategory(awayStats, "batting");
  const homePitchingStats = extractFullCategory(homeStats, "pitching");
  const awayPitchingStats = extractFullCategory(awayStats, "pitching");
  const homeFieldingStats = extractFullCategory(homeStats, "fielding");
  const awayFieldingStats = extractFullCategory(awayStats, "fielding");
  const umpire = extractHomePlateUmpire(gameInfo);
  const odds = extractOdds(summary);

  const homeTeam =
    asString(homeCompetitor?.team?.displayName) ??
    asString(homeTeamBox?.team?.displayName);
  const awayTeam =
    asString(awayCompetitor?.team?.displayName) ??
    asString(awayTeamBox?.team?.displayName);
  const homeScore = asInt(homeCompetitor?.score);
  const awayScore = asInt(awayCompetitor?.score);
  const homeHits = pickStatInt(homeBattingStats, ["H"]);
  const awayHits = pickStatInt(awayBattingStats, ["H"]);
  const homeErrors = pickStatInt(homeFieldingStats, ["E"]);
  const awayErrors = pickStatInt(awayFieldingStats, ["E"]);

  const predictor = Array.isArray(summary?.winprobability)
    ? summary.winprobability.map((entry: any) => ({
      playId: entry?.playId ?? null,
      homeWinPct: entry?.homeWinPercentage ?? null,
      tiePct: entry?.tiePercentage ?? null,
    }))
    : null;

  const startTime =
    asString(competition?.date) ??
    asString(summary?.header?.competitions?.[0]?.date) ??
    candidate.startTime;
  const dayNight = resolveDayNight(startTime, gameInfo);
  const seriesInfo = competition?.series || {};

  const postgame = {
    id: matchId,
    espn_event_id: eventId,
    canonical_game_id: canonicalGameId,
    home_team: homeTeam,
    away_team: awayTeam,
    home_score: homeScore,
    away_score: awayScore,
    match_status: statusName,
    start_time: startTime,
    venue: asString(venue?.fullName),
    venue_city: asString(venue?.city) ?? asString(venue?.address?.city),
    venue_state: asString(venue?.state) ?? asString(venue?.address?.state),
    venue_indoor: asBoolean(venue?.indoor),
    attendance: asInt(gameInfo?.attendance),
    weather_temp: asInt(weather?.temperature),
    weather_condition:
      asString(weather?.displayValue) ??
      asString(weather?.description) ??
      asString(weather?.condition),
    weather_gust: asInt(weather?.gust),
    weather_precipitation: asInt(weather?.precipitation),
    day_night: dayNight,
    season_type: seasonType,
    total_innings: Math.max(
      getLinescoreRuns(homeCompetitor?.linescores || []).length,
      getLinescoreRuns(awayCompetitor?.linescores || []).length,
    ),
    is_extra_innings:
      Math.max(
        getLinescoreRuns(homeCompetitor?.linescores || []).length,
        getLinescoreRuns(awayCompetitor?.linescores || []).length,
      ) > 9,
    home_plate_umpire: umpire.name,
    home_plate_umpire_id: umpire.id,
    series_game_number: asInt(seriesInfo?.gameNumber),
    series_length: asInt(seriesInfo?.maxGames),
    home_hits: homeHits,
    away_hits: awayHits,
    home_at_bats: pickStatInt(homeBattingStats, ["AB"]),
    away_at_bats: pickStatInt(awayBattingStats, ["AB"]),
    home_batting_avg: pickStatNumber(homeBattingStats, ["AVG"]),
    away_batting_avg: pickStatNumber(awayBattingStats, ["AVG"]),
    home_runs_batted_in: pickStatInt(homeBattingStats, ["RBI"]),
    away_runs_batted_in: pickStatInt(awayBattingStats, ["RBI"]),
    home_home_runs: pickStatInt(homeBattingStats, ["HR"]),
    away_home_runs: pickStatInt(awayBattingStats, ["HR"]),
    home_strikeouts_batting: pickStatInt(homeBattingStats, ["SO", "K"]),
    away_strikeouts_batting: pickStatInt(awayBattingStats, ["SO", "K"]),
    home_walks_batting: pickStatInt(homeBattingStats, ["BB"]),
    away_walks_batting: pickStatInt(awayBattingStats, ["BB"]),
    home_obp: pickStatNumber(homeBattingStats, ["OBP"]),
    away_obp: pickStatNumber(awayBattingStats, ["OBP"]),
    home_slg: pickStatNumber(homeBattingStats, ["SLG"]),
    away_slg: pickStatNumber(awayBattingStats, ["SLG"]),
    home_ops: pickStatNumber(homeBattingStats, ["OPS"]),
    away_ops: pickStatNumber(awayBattingStats, ["OPS"]),
    home_lob: pickStatInt(homeBattingStats, ["LOB"]),
    away_lob: pickStatInt(awayBattingStats, ["LOB"]),
    home_stolen_bases: pickStatInt(homeBattingStats, ["SB"]),
    away_stolen_bases: pickStatInt(awayBattingStats, ["SB"]),
    home_era: pickStatNumber(homePitchingStats, ["ERA"]),
    away_era: pickStatNumber(awayPitchingStats, ["ERA"]),
    home_innings_pitched: asString(pickStatValue(homePitchingStats, ["IP"])),
    away_innings_pitched: asString(pickStatValue(awayPitchingStats, ["IP"])),
    home_hits_allowed: pickStatInt(homePitchingStats, ["H"]),
    away_hits_allowed: pickStatInt(awayPitchingStats, ["H"]),
    home_earned_runs: pickStatInt(homePitchingStats, ["ER"]),
    away_earned_runs: pickStatInt(awayPitchingStats, ["ER"]),
    home_walks_pitching: pickStatInt(homePitchingStats, ["BB"]),
    away_walks_pitching: pickStatInt(awayPitchingStats, ["BB"]),
    home_strikeouts_pitching: pickStatInt(homePitchingStats, ["K", "SO"]),
    away_strikeouts_pitching: pickStatInt(awayPitchingStats, ["K", "SO"]),
    home_whip: pickStatNumber(homePitchingStats, ["WHIP"]),
    away_whip: pickStatNumber(awayPitchingStats, ["WHIP"]),
    home_pitches_thrown: pickStatInt(homePitchingStats, ["P", "NP", "PC"]),
    away_pitches_thrown: pickStatInt(awayPitchingStats, ["P", "NP", "PC"]),
    home_hr_allowed: pickStatInt(homePitchingStats, ["HR"]),
    away_hr_allowed: pickStatInt(awayPitchingStats, ["HR"]),
    home_batting_stats: homeBattingStats,
    away_batting_stats: awayBattingStats,
    home_pitching_stats: homePitchingStats,
    away_pitching_stats: awayPitchingStats,
    home_fielding_stats: homeFieldingStats,
    away_fielding_stats: awayFieldingStats,
    home_iso: pickStatNumber(homeBattingStats, ["ISOP"]),
    away_iso: pickStatNumber(awayBattingStats, ["ISOP"]),
    home_runs_created: pickStatNumber(homeBattingStats, ["RC"]),
    away_runs_created: pickStatNumber(awayBattingStats, ["RC"]),
    home_bb_k: pickStatNumber(homeBattingStats, ["BB/K"]),
    away_bb_k: pickStatNumber(awayBattingStats, ["BB/K"]),
    home_xbh: pickStatInt(homeBattingStats, ["XBH"]),
    away_xbh: pickStatInt(awayBattingStats, ["XBH"]),
    home_war_batting: pickStatNumber(homeBattingStats, ["WAR"]),
    away_war_batting: pickStatNumber(awayBattingStats, ["WAR"]),
    home_go_fo: pickStatNumber(homeBattingStats, ["GO/FO"]),
    away_go_fo: pickStatNumber(awayBattingStats, ["GO/FO"]),
    home_sb_pct: pickStatNumber(homeBattingStats, ["SB%"]),
    away_sb_pct: pickStatNumber(awayBattingStats, ["SB%"]),
    home_pa: pickStatInt(homeBattingStats, ["PA"]),
    away_pa: pickStatInt(awayBattingStats, ["PA"]),
    home_ground_balls: pickStatInt(homePitchingStats, ["GB"]),
    away_ground_balls: pickStatInt(awayPitchingStats, ["GB"]),
    home_fly_balls: pickStatInt(homePitchingStats, ["FB"]),
    away_fly_balls: pickStatInt(awayPitchingStats, ["FB"]),
    home_gb_fb_ratio: pickStatNumber(homePitchingStats, ["G/F"]),
    away_gb_fb_ratio: pickStatNumber(awayPitchingStats, ["G/F"]),
    home_k_9: pickStatNumber(homePitchingStats, ["K/9"]),
    away_k_9: pickStatNumber(awayPitchingStats, ["K/9"]),
    home_k_bb: pickStatNumber(homePitchingStats, ["K/BB"]),
    away_k_bb: pickStatNumber(awayPitchingStats, ["K/BB"]),
    home_opp_avg: pickStatNumber(homePitchingStats, ["OBA"]),
    away_opp_avg: pickStatNumber(awayPitchingStats, ["OBA"]),
    home_opp_obp: pickStatNumber(homePitchingStats, ["OOBP"]),
    away_opp_obp: pickStatNumber(awayPitchingStats, ["OOBP"]),
    home_opp_slg: pickStatNumber(homePitchingStats, ["OSLUG"]),
    away_opp_slg: pickStatNumber(awayPitchingStats, ["OSLUG"]),
    home_opp_ops: pickStatNumber(homePitchingStats, ["OOPS"]),
    away_opp_ops: pickStatNumber(awayPitchingStats, ["OOPS"]),
    home_quality_starts: pickStatInt(homePitchingStats, ["QS"]),
    away_quality_starts: pickStatInt(awayPitchingStats, ["QS"]),
    home_inherited_runners: pickStatInt(homePitchingStats, ["IR"]),
    away_inherited_runners: pickStatInt(awayPitchingStats, ["IR"]),
    home_inherited_scored: pickStatInt(homePitchingStats, ["IRS"]),
    away_inherited_scored: pickStatInt(awayPitchingStats, ["IRS"]),
    home_holds: pickStatInt(homePitchingStats, ["HLD"]),
    away_holds: pickStatInt(awayPitchingStats, ["HLD"]),
    home_blown_saves: pickStatInt(homePitchingStats, ["BLSV"]),
    away_blown_saves: pickStatInt(awayPitchingStats, ["BLSV"]),
    home_save_opps: pickStatInt(homePitchingStats, ["SVOP"]),
    away_save_opps: pickStatInt(awayPitchingStats, ["SVOP"]),
    home_tbf: pickStatInt(homePitchingStats, ["TBF"]),
    away_tbf: pickStatInt(awayPitchingStats, ["TBF"]),
    home_war_pitching: pickStatNumber(homePitchingStats, ["WAR"]),
    away_war_pitching: pickStatNumber(awayPitchingStats, ["WAR"]),
    home_run_support: pickStatNumber(homePitchingStats, ["RSA"]),
    away_run_support: pickStatNumber(awayPitchingStats, ["RSA"]),
    home_errors: pickStatInt(homeFieldingStats, ["E"]),
    away_errors: pickStatInt(awayFieldingStats, ["E"]),
    home_fielding_pct: pickStatNumber(homeFieldingStats, ["FP"]),
    away_fielding_pct: pickStatNumber(awayFieldingStats, ["FP"]),
    home_dwar: pickStatNumber(homeFieldingStats, ["DWAR"]),
    away_dwar: pickStatNumber(awayFieldingStats, ["DWAR"]),
    ...odds,
    run_line_result: null,
    win_probability: predictor,
    drain_version: DRAIN_VERSION,
    last_drained_at: drainedAt,
  };

  const inningScores = buildInningScoreRow(
    summary,
    eventId,
    matchId,
    seasonType,
    startTime,
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    homeHits,
    awayHits,
    homeErrors,
    awayErrors,
    drainedAt,
  );

  const pitcherRows = extractPitcherRows(
    summary,
    eventId,
    matchId,
    seasonType,
    startTime,
    homeTeam,
    awayTeam,
    drainedAt,
  );

  const batterRows = extractBatterRows(
    summary,
    eventId,
    matchId,
    seasonType,
    startTime,
    homeTeam,
    awayTeam,
    drainedAt,
  );

  return {
    postgame,
    inningScores,
    pitcherRows,
    batterRows,
  };
}

async function upsertRows(
  supabase: ReturnType<typeof createClient>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  errors: string[],
  batchSize = 200,
): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (let idx = 0; idx < rows.length; idx += batchSize) {
    const batch = rows.slice(idx, idx + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) {
      errors.push(`${table} upsert failed: ${error.message}`);
      continue;
    }
    written += batch.length;
  }
  return written;
}

async function fetchMatchCanonicalMap(
  supabase: ReturnType<typeof createClient>,
  matchIds: string[],
): Promise<Map<string, CanonicalMatchInfo>> {
  const map = new Map<string, CanonicalMatchInfo>();
  for (let i = 0; i < matchIds.length; i += 200) {
    const batchIds = matchIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("matches")
      .select("id, canonical_game_id, canonical_id")
      .in("id", batchIds);
    if (error || !data) continue;
    for (const row of data) {
      const id = asString(row?.id);
      if (!id) continue;
      map.set(id, {
        canonical_game_id: asString((row as any).canonical_game_id),
        canonical_id: asString((row as any).canonical_id),
      });
    }
  }
  return map;
}

async function fetchExistingDrainVersions(
  supabase: ReturnType<typeof createClient>,
  matchIds: string[],
): Promise<Map<string, string | null>> {
  const versions = new Map<string, string | null>();
  for (let i = 0; i < matchIds.length; i += 500) {
    const batch = matchIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from("mlb_postgame")
      .select("id, drain_version")
      .in("id", batch);
    if (error || !data) continue;
    for (const row of data) {
      const id = asString((row as any).id);
      if (!id) continue;
      versions.set(id, asString((row as any).drain_version));
    }
  }
  return versions;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseKey) {
    return response({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const body = await req.json().catch(() => ({}));
  const startDate = parseDateInput(body?.start_date, DEFAULT_START_DATE);
  const endDate = parseDateInput(body?.end_date, DEFAULT_END_DATE);
  const dryRun = body?.dry_run === true;
  const batchSizeRaw = asInt(body?.batch_size) ?? DEFAULT_BATCH_SIZE;
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, batchSizeRaw));

  if (startDate > endDate) {
    return response({
      error: "start_date must be <= end_date",
      start_date: startDate,
      end_date: endDate,
    }, 400);
  }

  const discoveryErrors: string[] = [];
  const perDate: Array<{
    date: string;
    found_events: number;
    final_candidates: number;
    processed_in_batch: number;
  }> = [];
  const discoveredMap = new Map<string, ScoreboardEventCandidate>();

  for (const date of dateRange(startDate, endDate)) {
    const scoreboardUrl = `${ESPN_SCOREBOARD_URL}?dates=${toScoreboardDate(date)}&limit=500`;
    const scoreboard = await fetchJson(scoreboardUrl);
    if (!scoreboard.ok) {
      discoveryErrors.push(`${date}: scoreboard failed (${scoreboard.error ?? "unknown"})`);
      perDate.push({
        date,
        found_events: 0,
        final_candidates: 0,
        processed_in_batch: 0,
      });
      await sleep(ESPN_DELAY_MS);
      continue;
    }

    const events = Array.isArray(scoreboard.data?.events) ? scoreboard.data.events : [];
    let finalCandidates = 0;
    for (const event of events) {
      const eventId = asString(event?.id);
      if (!eventId) continue;
      const competition = event?.competitions?.[0] ?? {};
      const statusName = asString(competition?.status?.type?.name) ?? asString(event?.status?.type?.name);
      const statusDetail = asString(competition?.status?.type?.detail) ?? asString(event?.status?.type?.detail);
      const seasonCode =
        asInt(event?.season?.type) ??
        asInt(competition?.season?.type);

      if (!isFinalStatus(statusName, statusDetail)) continue;
      if (seasonCode !== null && seasonCode === 1) continue;

      finalCandidates += 1;
      const matchId = `${eventId}_mlb`;
      discoveredMap.set(matchId, {
        eventId,
        matchId,
        date,
        startTime: asString(event?.date) ?? asString(competition?.date),
        statusName,
        statusDetail,
      });
    }

    perDate.push({
      date,
      found_events: events.length,
      final_candidates: finalCandidates,
      processed_in_batch: 0,
    });
    await sleep(ESPN_DELAY_MS);
  }

  const discovered = Array.from(discoveredMap.values()).sort((a, b) => {
    const aTs = a.startTime ? Date.parse(a.startTime) : 0;
    const bTs = b.startTime ? Date.parse(b.startTime) : 0;
    return aTs - bTs;
  });

  const existingVersionById = await fetchExistingDrainVersions(
    supabase,
    discovered.map((item) => item.matchId),
  );

  const pending = discovered.filter((item) => existingVersionById.get(item.matchId) !== DRAIN_VERSION);
  const toProcess = pending.slice(0, batchSize);

  const processPerDate = new Map<string, number>();
  for (const item of toProcess) {
    processPerDate.set(item.date, (processPerDate.get(item.date) ?? 0) + 1);
  }
  for (const row of perDate) {
    row.processed_in_batch = processPerDate.get(row.date) ?? 0;
  }

  if (dryRun) {
    return response({
      dry_run: true,
      drain_version: DRAIN_VERSION,
      start_date: startDate,
      end_date: endDate,
      dates_scanned: perDate.length,
      discovered_final_games: discovered.length,
      pending_games: pending.length,
      batch_size: batchSize,
      would_process: toProcess.length,
      remaining_after_batch: Math.max(0, pending.length - toProcess.length),
      sample_match_ids: toProcess.slice(0, 10).map((item) => item.matchId),
      per_date: perDate,
      discovery_errors: discoveryErrors.slice(0, 20),
    });
  }

  const canonicalMap = await fetchMatchCanonicalMap(
    supabase,
    toProcess.map((item) => item.matchId),
  );

  const processingErrors: string[] = [];
  const postgameRows: Record<string, unknown>[] = [];
  const inningRows: Record<string, unknown>[] = [];
  const pitcherRows: Record<string, unknown>[] = [];
  const batterRows: Record<string, unknown>[] = [];
  const processedGames: string[] = [];
  const skippedPreseason: string[] = [];

  for (const item of toProcess) {
    const summaryUrl = `${ESPN_SUMMARY_URL}?event=${item.eventId}`;
    const summary = await fetchJson(summaryUrl);
    if (!summary.ok) {
      processingErrors.push(`${item.matchId}: summary failed (${summary.error ?? "unknown"})`);
      await sleep(ESPN_DELAY_MS);
      continue;
    }

    const canonicalInfo = canonicalMap.get(item.matchId);
    const canonicalHint = canonicalInfo?.canonical_game_id ?? canonicalInfo?.canonical_id ?? null;
    const canonicalGameId = await ensureMatchAndCanonical(
      supabase,
      item,
      summary.data,
      canonicalHint,
    );
    if (!canonicalGameId) {
      processingErrors.push(`${item.matchId}: unable to ensure match/canonical linkage`);
      await sleep(ESPN_DELAY_MS);
      continue;
    }
    const drainedAt = new Date().toISOString();
    const payload = buildPostgameRow(summary.data, item, canonicalGameId, drainedAt);
    if (!payload) {
      const seasonType = resolveSeasonType(summary.data, item.startTime);
      if (seasonType === "preseason") {
        skippedPreseason.push(item.matchId);
      } else {
        processingErrors.push(`${item.matchId}: unable to extract summary payload`);
      }
      await sleep(ESPN_DELAY_MS);
      continue;
    }

    postgameRows.push(payload.postgame);
    inningRows.push(payload.inningScores);
    pitcherRows.push(...payload.pitcherRows);
    batterRows.push(...payload.batterRows);
    processedGames.push(item.matchId);
    await sleep(ESPN_DELAY_MS);
  }

  const writeErrors: string[] = [];
  const postgameWritten = await upsertRows(
    supabase,
    "mlb_postgame",
    postgameRows,
    "id",
    writeErrors,
    20,
  );
  const inningWritten = await upsertRows(
    supabase,
    "mlb_inning_scores",
    inningRows,
    "id",
    writeErrors,
    50,
  );
  const pitcherWritten = await upsertRows(
    supabase,
    "mlb_pitcher_game_logs",
    pitcherRows,
    "id",
    writeErrors,
    200,
  );
  const batterWritten = await upsertRows(
    supabase,
    "mlb_batter_game_logs",
    batterRows,
    "id",
    writeErrors,
    200,
  );

  const allErrors = [...discoveryErrors, ...processingErrors, ...writeErrors];

  return response({
    success: allErrors.length === 0,
    drain_version: DRAIN_VERSION,
    start_date: startDate,
    end_date: endDate,
    dates_scanned: perDate.length,
    discovered_final_games: discovered.length,
    pending_games_before_batch: pending.length,
    processed_games: processedGames.length,
    skipped_preseason: skippedPreseason.length,
    remaining_games: Math.max(0, pending.length - toProcess.length),
    rows_written: {
      mlb_postgame: postgameWritten,
      mlb_inning_scores: inningWritten,
      mlb_pitcher_game_logs: pitcherWritten,
      mlb_batter_game_logs: batterWritten,
    },
    batch_size: batchSize,
    sample_processed: processedGames.slice(0, 10),
    per_date: perDate,
    errors_count: allErrors.length,
    errors: allErrors.slice(0, 50),
  });
});
