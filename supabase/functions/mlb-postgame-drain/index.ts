// supabase/functions/mlb-postgame-drain/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
var DRAIN_VERSION = "v4";
var MAX_CONCURRENT = 3;
var INTER_BATCH_MS = 400;
var FETCH_TIMEOUT_MS = 15e3;
var ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary";
var WEATHER_CONDITIONS = {
  1: "Sunny",
  2: "Partly Cloudy",
  3: "Cloudy",
  4: "Rain",
  5: "Snow",
  6: "Thunderstorms",
  7: "Windy",
  8: "Clear",
  9: "Drizzle",
  10: "Fog"
};
function asString(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/^(\.\d+)$/, "0$1");
    if (cleaned.length === 0) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function parsePrice(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const raw = value.trim().toUpperCase();
    if (!raw) return null;
    if (raw === "EV" || raw === "EVEN") return 100;
    const parsed = parseInt(raw.replace(/[+,]/g, ""), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    return parsePrice(value?.american) ?? parsePrice(value?.value) ?? parsePrice(value?.moneyLine) ?? parsePrice(value?.odds) ?? null;
  }
  return null;
}
function parsePoints(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const raw = value.trim().toUpperCase();
    if (!raw) return null;
    if (raw === "PK" || raw === "PICK" || raw === "EVEN") return 0;
    if (/^[+-]\d{3,}$/.test(raw)) return null;
    const parsed = parseFloat(raw.replace(/[+,]/g, ""));
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    return parsePoints(value?.value) ?? parsePoints(value?.points) ?? parsePoints(value?.line) ?? parsePoints(value?.american) ?? null;
  }
  return null;
}
function asInt(value) {
  const num = asNumber(value);
  return num === null ? null : Math.trunc(num);
}
function asBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return null;
}
async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function processBatch(items, batchSize, delayMs, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn));
    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value) results.push(result.value);
    }
    if (i + batchSize < items.length) await sleep(delayMs);
  }
  return results;
}
function chunk(items, size) {
  if (size <= 0) return items;
  return items.slice(0, size);
}
function stripLeagueSuffix(value) {
  if (!value) return null;
  return value.replace(/_[a-z0-9.]+$/i, "");
}
function normalizeKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function findStat(stats, catName, statName) {
  const category = stats?.find((item) => item?.name === catName || item?.type === catName);
  if (!category?.stats) return null;
  const target = normalizeKey(statName);
  const stat = category.stats.find((item) => {
    const keys = [
      item?.name,
      item?.label,
      item?.displayName,
      item?.shortDisplayName,
      item?.abbreviation
    ].map((entry) => normalizeKey(asString(entry)));
    return keys.includes(target);
  });
  return asString(stat?.displayValue) ?? asString(stat?.value);
}
function fsNum(stats, cat, name) {
  return asNumber(findStat(stats, cat, name));
}
function fsInt(stats, cat, name) {
  return asInt(findStat(stats, cat, name));
}
function extractOdds(data) {
  const pc = data.pickcenter?.[0];
  if (!pc) return {
    dk_home_ml: null,
    dk_away_ml: null,
    dk_spread: null,
    dk_total: null,
    dk_over_price: null,
    dk_under_price: null,
    home_run_line: null
  };
  return {
    dk_home_ml: parsePrice(pc.homeTeamOdds?.moneyLine),
    dk_away_ml: parsePrice(pc.awayTeamOdds?.moneyLine),
    dk_spread: parsePoints(pc.spread),
    dk_total: parsePoints(pc.overUnder),
    dk_over_price: parsePrice(pc.overOdds),
    dk_under_price: parsePrice(pc.underOdds),
    home_run_line: parsePoints(pc.homeTeamOdds?.runLine) ?? parsePoints(pc.homeTeamOdds?.spread) ?? parsePoints(pc.spread)
  };
}
function extractFullCategory(stats, catName) {
  const category = stats?.find((item) => item?.name === catName || item?.type === catName);
  if (!category?.stats) return null;
  const result = {};
  for (const stat of category.stats) {
    const key = asString(stat?.abbreviation) ?? asString(stat?.name);
    if (!key) continue;
    result[key] = stat?.displayValue ?? stat?.value ?? null;
  }
  return result;
}
function inningsToOuts(inningsText) {
  if (!inningsText) return null;
  const cleaned = inningsText.trim();
  if (!cleaned) return null;
  const [wholePart, fractionalPart = "0"] = cleaned.split(".");
  const whole = parseInt(wholePart, 10);
  if (Number.isNaN(whole)) return null;
  const fractional = parseInt(fractionalPart.slice(0, 1) || "0", 10);
  if (Number.isNaN(fractional) || fractional < 0 || fractional > 2) return null;
  return whole * 3 + fractional;
}
function getWeatherCondition(weather) {
  const described = asString(weather?.description) ?? asString(weather?.displayValue) ?? asString(weather?.condition);
  if (described) return described;
  const conditionId = asInt(weather?.conditionId);
  if (conditionId === null) return null;
  return WEATHER_CONDITIONS[conditionId] ?? String(conditionId);
}
function extractHomePlateUmpire(gameInfo) {
  const officials = Array.isArray(gameInfo?.officials) ? gameInfo.officials : [];
  const homePlate = officials.find((official) => {
    const position = String(official?.position?.name ?? "").toLowerCase();
    return position.includes("home plate") || asInt(official?.order) === 1;
  });
  if (!homePlate) return { name: null, id: null };
  return {
    name: asString(homePlate?.displayName) ?? asString(homePlate?.fullName) ?? asString(homePlate?.name),
    id: asString(homePlate?.id) ?? asString(homePlate?.position?.id)
  };
}
function getHourInTimeZone(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone
    });
    const hour = parseInt(formatter.format(date), 10);
    return Number.isFinite(hour) ? hour : null;
  } catch {
    return null;
  }
}
function resolveDayNight(startTime, gameInfo) {
  const provided = asString(gameInfo?.dayNight) ?? asString(gameInfo?.dayOrNight);
  if (provided) {
    const normalized = provided.toLowerCase();
    if (normalized.includes("day")) return "day";
    if (normalized.includes("night")) return "night";
  }
  if (!startTime) return null;
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return null;
  const timeZone = asString(gameInfo?.venue?.address?.timezone) ?? asString(gameInfo?.venue?.timezone) ?? asString(gameInfo?.timezone);
  const hour = timeZone ? getHourInTimeZone(date, timeZone) : date.getUTCHours();
  if (hour === null) return null;
  return hour < 17 ? "day" : "night";
}
function resolveRunLineResult(homeRunLine, homeScore, awayScore) {
  if (homeRunLine === null || homeScore === null || awayScore === null) return null;
  const margin = homeScore - awayScore;
  const graded = margin + homeRunLine;
  if (graded > 0) return "cover";
  if (graded < 0) return "miss";
  return "push";
}
function resolveSeasonType(data, startTime) {
  const espnType = asInt(data?.header?.season?.type) ?? asInt(data?.season?.type);
  if (espnType === 1) return "preseason";
  if (espnType === 2) return "regular";
  if (espnType === 3) return "postseason";
  const baseDate = startTime ? new Date(startTime) : /* @__PURE__ */ new Date();
  const month = baseDate.getUTCMonth() + 1;
  const day = baseDate.getUTCDate();
  if (month < 3 || month === 3 && day < 25) return "preseason";
  if (month >= 10) return "postseason";
  return "regular";
}
function getCompetitor(data, homeAway) {
  return data.header?.competitions?.[0]?.competitors?.find((competitor) => competitor?.homeAway === homeAway) ?? null;
}
function getLinescoreRuns(linescores) {
  return (linescores || []).map((entry) => asInt(entry?.value) ?? asInt(entry?.displayValue) ?? 0);
}
function sumRuns(values, startInclusive, endExclusive) {
  let total = 0;
  for (let index = startInclusive; index < Math.min(endExclusive, values.length); index += 1) {
    total += values[index] ?? 0;
  }
  return total;
}
function buildStatMap(labels, values) {
  const mapped = {};
  for (let index = 0; index < labels.length; index += 1) {
    mapped[normalizeKey(asString(labels[index]))] = asString(values?.[index]);
  }
  return mapped;
}
function parsePitchSummary(rawValue) {
  if (!rawValue) return { pitches: null, strikes: null };
  const numbers = rawValue.split(/[^0-9]+/).map((part) => parseInt(part, 10)).filter((value) => Number.isFinite(value));
  return {
    pitches: numbers[0] ?? null,
    strikes: numbers[1] ?? null
  };
}
function toNumericEventId(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function getPitchingCategory(playerGroup) {
  const stats = playerGroup?.statistics;
  if (!Array.isArray(stats)) return null;
  return stats.find((category) => (category?.labels || []).some((label) => normalizeKey(asString(label)) === "IP")) ?? stats[1] ?? null;
}
function resolveTeamSide(sideByTeamId, sideByName, teamId, teamName) {
  if (teamId && sideByTeamId.has(teamId)) return sideByTeamId.get(teamId) ?? null;
  if (teamName && sideByName.has(teamName)) return sideByName.get(teamName) ?? null;
  return null;
}
function extractStarterFromCompetitor(data, side) {
  const competitor = getCompetitor(data, side);
  const probable = (competitor?.probables || []).find((entry) => {
    const label = normalizeKey(asString(entry?.name) ?? asString(entry?.displayName) ?? asString(entry?.shortDisplayName));
    return label.includes("STARTER") || label.includes("PITCHER") || label === "SP";
  }) ?? competitor?.probables?.[0];
  const athlete = probable?.athlete;
  const id = asString(athlete?.id) ?? asString(probable?.playerId);
  const name = asString(athlete?.displayName) ?? asString(athlete?.fullName) ?? asString(probable?.displayName);
  if (!id && !name) return null;
  return { id, name };
}
function extractPitcherDetails(data, matchId, eventId, startTime, seasonType, homeTeam, awayTeam) {
  const groups = data.boxscore?.players || [];
  const sideByTeamId = /* @__PURE__ */ new Map();
  const sideByName = /* @__PURE__ */ new Map();
  for (const competitor of data.header?.competitions?.[0]?.competitors || []) {
    const homeAway = competitor?.homeAway === "home" ? "home" : competitor?.homeAway === "away" ? "away" : null;
    if (!homeAway) continue;
    const teamId = asString(competitor?.team?.id);
    const teamName = asString(competitor?.team?.displayName);
    if (teamId) sideByTeamId.set(teamId, homeAway);
    if (teamName) sideByName.set(teamName, homeAway);
  }
  const rows = [];
  const starters = {
    home: { id: null, name: null },
    away: { id: null, name: null }
  };
  const gameDate = startTime?.slice(0, 10) ?? null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  groups.forEach((group, groupIndex) => {
    const teamId = asString(group?.team?.id);
    const teamName = asString(group?.team?.displayName);
    const side = resolveTeamSide(sideByTeamId, sideByName, teamId, teamName) ?? (groupIndex === 0 ? "away" : groupIndex === 1 ? "home" : null);
    if (!side) return;
    const pitchingCategory = getPitchingCategory(group);
    const athletes = pitchingCategory?.athletes || [];
    const labels = pitchingCategory?.labels || [];
    const opponentTeam = side === "home" ? awayTeam : homeTeam;
    athletes.forEach((athleteRow, athleteIndex) => {
      const athleteId = asString(athleteRow?.athlete?.id);
      const athleteName = asString(athleteRow?.athlete?.displayName);
      if (!athleteId || !athleteName) return;
      const numericEventId = toNumericEventId(eventId);
      const rowId = numericEventId === null ? null : numericEventId * 1e3 + (side === "home" ? 500 : 0) + athleteIndex + 1;
      const statMap = buildStatMap(labels, athleteRow?.stats || []);
      const pitchSummary = parsePitchSummary(statMap.PCST ?? null);
      const inningsPitched = statMap.IP ?? null;
      const isStarter = athleteRow?.starter === true || athleteIndex === 0;
      if (isStarter && !starters[side].name) {
        starters[side] = { id: athleteId, name: athleteName };
      }
      rows.push({
        id: rowId,
        match_id: matchId,
        espn_event_id: eventId,
        game_date: gameDate,
        season_type: seasonType,
        team: teamName,
        team_abbr: asString(group?.team?.abbreviation),
        home_away: side,
        opponent_team: opponentTeam,
        athlete_id: athleteId,
        athlete_name: athleteName,
        is_starter: isStarter,
        pitch_order: athleteIndex + 1,
        innings_pitched: inningsPitched,
        innings_outs: inningsToOuts(inningsPitched),
        hits_allowed: asInt(statMap.H),
        runs_allowed: asInt(statMap.R),
        earned_runs: asInt(statMap.ER),
        walks: asInt(statMap.BB),
        strikeouts: asInt(statMap.K),
        home_runs_allowed: asInt(statMap.HR),
        pitches_thrown: pitchSummary.pitches ?? asInt(statMap.PC),
        strikes_thrown: pitchSummary.strikes,
        era: asNumber(statMap.ERA),
        whip: asNumber(statMap.WHIP),
        decision: asString(athleteRow?.decision) ?? asString(athleteRow?.note) ?? asString(athleteRow?.result),
        created_at: now,
        updated_at: now
      });
    });
  });
  return { starters, rows };
}
function mapTeamSides(data) {
  const sideByTeamId = /* @__PURE__ */ new Map();
  const sideByTeamName = /* @__PURE__ */ new Map();
  for (const competitor of data?.header?.competitions?.[0]?.competitors || []) {
    const side = competitor?.homeAway === "home" ? "home" : competitor?.homeAway === "away" ? "away" : null;
    if (!side) continue;
    const teamId = asString(competitor?.team?.id);
    const teamName = asString(competitor?.team?.displayName);
    if (teamId) sideByTeamId.set(teamId, side);
    if (teamName) sideByTeamName.set(teamName, side);
  }
  return { sideByTeamId, sideByTeamName };
}
function getBattingCategory(playerGroup) {
  const stats = playerGroup?.statistics;
  if (!Array.isArray(stats)) return null;
  return stats.find((category) => (category?.labels || []).some((label) => normalizeKey(asString(label)) === "AB")) ?? stats[0] ?? null;
}
function extractBatterDetails(data, matchId, eventId, startTime, seasonType, homeTeam, awayTeam) {
  const groups = data.boxscore?.players || [];
  const { sideByTeamId, sideByTeamName } = mapTeamSides(data);
  const rows = [];
  const gameDate = startTime?.slice(0, 10) ?? null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  groups.forEach((group, groupIndex) => {
    const teamId = asString(group?.team?.id);
    const teamName = asString(group?.team?.displayName);
    const side = resolveTeamSide(sideByTeamId, sideByTeamName, teamId, teamName) ?? (groupIndex === 0 ? "away" : groupIndex === 1 ? "home" : null);
    if (!side) return;
    const battingCategory = getBattingCategory(group);
    if (!battingCategory) return;
    const athletes = battingCategory?.athletes || [];
    const labels = battingCategory?.labels || [];
    const opponentTeam = side === "home" ? awayTeam : homeTeam;
    athletes.forEach((athleteRow, athleteIndex) => {
      const athleteId = asString(athleteRow?.athlete?.id);
      const athleteName = asString(athleteRow?.athlete?.displayName) ?? asString(athleteRow?.athlete?.fullName);
      if (!athleteId || !athleteName) return;
      const statMap = buildStatMap(labels, athleteRow?.stats || []);
      rows.push({
        id: `${eventId}_${athleteId}_bat_mlb`,
        match_id: matchId,
        espn_event_id: eventId,
        game_date: gameDate,
        season_type: seasonType,
        team: teamName,
        team_abbr: asString(group?.team?.abbreviation),
        opponent: opponentTeam,
        is_home: side === "home",
        athlete_id: athleteId,
        athlete_name: athleteName,
        batting_order: asInt(athleteRow?.battingOrder) ?? asInt(athleteRow?.order) ?? athleteIndex + 1,
        position: asString(athleteRow?.athlete?.position?.abbreviation) ?? asString(athleteRow?.position?.abbreviation) ?? asString(athleteRow?.athlete?.position?.displayName),
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
        bb_k_ratio: asNumber(statMap.BBK) ?? asNumber(statMap["BB/K"]),
        ab_per_hr: asNumber(statMap.ABHR),
        go_fo_ratio: asNumber(statMap.GOFO) ?? asNumber(statMap["GO/FO"]),
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
        updated_at: now
      });
    });
  });
  return rows;
}
function extractPitchEvents(data, matchId, eventId) {
  const plays = Array.isArray(data?.plays) ? data.plays : [];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const rows = [];
  for (const play of plays) {
    const playId = asString(play?.id);
    const playType = asString(play?.type?.type);
    const hasPitchSignal = play?.atBatPitchNumber !== void 0 || play?.pitchType !== void 0 || play?.pitchVelocity !== void 0 || play?.pitchCoordinate !== void 0;
    if (!playId || !hasPitchSignal) continue;
    const participants = Array.isArray(play?.participants) ? play.participants : [];
    const pitcher = participants.find((item) => String(item?.type || "").toLowerCase() === "pitcher");
    const batter = participants.find((item) => String(item?.type || "").toLowerCase() === "batter");
    const lowerType = String(playType || "").toLowerCase();
    rows.push({
      id: playId,
      match_id: matchId,
      espn_event_id: eventId,
      sequence_number: asInt(play?.sequenceNumber),
      at_bat_id: asString(play?.atBatId),
      at_bat_pitch_number: asInt(play?.atBatPitchNumber),
      inning_number: asInt(play?.period?.number),
      inning_half: asString(play?.period?.type),
      wallclock: asString(play?.wallclock),
      pitcher_athlete_id: asString(pitcher?.athlete?.id),
      batter_athlete_id: asString(batter?.athlete?.id),
      batter_side: asString(play?.bats?.abbreviation) ?? asString(play?.bats?.type),
      pitch_type_id: asString(play?.pitchType?.id),
      pitch_type: asString(play?.pitchType?.text),
      pitch_type_abbr: asString(play?.pitchType?.abbreviation),
      pitch_velocity: asInt(play?.pitchVelocity),
      pitch_coord_x: asNumber(play?.pitchCoordinate?.x),
      pitch_coord_y: asNumber(play?.pitchCoordinate?.y),
      trajectory: asString(play?.trajectory),
      pre_balls: asInt(play?.pitchCount?.balls),
      pre_strikes: asInt(play?.pitchCount?.strikes),
      post_balls: asInt(play?.resultCount?.balls),
      post_strikes: asInt(play?.resultCount?.strikes),
      outs: asInt(play?.outs),
      play_type: playType,
      play_text: asString(play?.text),
      scoring_play: play?.scoringPlay === true,
      score_value: asInt(play?.scoreValue),
      away_score: asInt(play?.awayScore),
      home_score: asInt(play?.homeScore),
      is_called_strike: lowerType === "strike-looking",
      is_ball: lowerType === "ball",
      is_swinging_strike: lowerType === "strike-swinging",
      is_foul: lowerType.includes("foul"),
      is_in_play: lowerType === "single" || lowerType === "double" || lowerType === "triple" || lowerType === "home-run" || lowerType === "groundout" || lowerType === "flyout" || lowerType === "lineout",
      drain_version: DRAIN_VERSION,
      last_drained_at: now,
      created_at: now,
      updated_at: now
    });
  }
  return rows;
}
function derivePitchMixStats(pitchEvents, pitcherSideById, side) {
  const sideEvents = pitchEvents.filter((row) => {
    const pitcherId = asString(row?.pitcher_athlete_id);
    return pitcherId && pitcherSideById.get(pitcherId) === side;
  });
  if (sideEvents.length === 0) {
    return {
      pitchTypesUsed: 0,
      pitchPctVsLhb: null,
      pitchPctVsRhb: null,
      primaryPitch: null,
      primaryPitchShare: null
    };
  }
  const typeCounts = /* @__PURE__ */ new Map();
  let vsL = 0;
  let vsR = 0;
  let recognizedHandedness = 0;
  for (const row of sideEvents) {
    const pitchType = asString(row?.pitch_type_abbr) ?? asString(row?.pitch_type) ?? "UNK";
    typeCounts.set(pitchType, (typeCounts.get(pitchType) || 0) + 1);
    const batterSide = String(asString(row?.batter_side) || "").toUpperCase();
    if (batterSide.startsWith("L")) {
      vsL += 1;
      recognizedHandedness += 1;
    } else if (batterSide.startsWith("R")) {
      vsR += 1;
      recognizedHandedness += 1;
    }
  }
  let primaryPitch = null;
  let primaryPitchCount = 0;
  for (const [pitch, count] of typeCounts.entries()) {
    if (count > primaryPitchCount) {
      primaryPitch = pitch;
      primaryPitchCount = count;
    }
  }
  return {
    pitchTypesUsed: typeCounts.size,
    pitchPctVsLhb: recognizedHandedness > 0 ? Number((vsL / recognizedHandedness).toFixed(4)) : null,
    pitchPctVsRhb: recognizedHandedness > 0 ? Number((vsR / recognizedHandedness).toFixed(4)) : null,
    primaryPitch,
    primaryPitchShare: sideEvents.length > 0 ? Number((primaryPitchCount / sideEvents.length).toFixed(4)) : null
  };
}
function leashBucket(starterPitches, starterOuts) {
  if (starterPitches === null || starterOuts === null) return null;
  if (starterOuts < 15 && starterPitches <= 80) return "SHORT";
  if (starterPitches >= 100 || starterOuts >= 21) return "LONG";
  return "STANDARD";
}
function deriveContextLayerRow(postgame, pitcherRows, pitchEvents) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const homeStarter = pitcherRows.find((row) => row?.home_away === "home" && row?.is_starter === true) ?? null;
  const awayStarter = pitcherRows.find((row) => row?.home_away === "away" && row?.is_starter === true) ?? null;
  const homeBullpenRows = pitcherRows.filter((row) => row?.home_away === "home" && row?.is_starter !== true);
  const awayBullpenRows = pitcherRows.filter((row) => row?.home_away === "away" && row?.is_starter !== true);
  const calledStrikeCount = pitchEvents.reduce((sum, row) => sum + (row?.is_called_strike ? 1 : 0), 0);
  const calledBallCount = pitchEvents.reduce((sum, row) => sum + (row?.is_ball ? 1 : 0), 0);
  const calledTotal = calledStrikeCount + calledBallCount;
  const pitcherSideById = /* @__PURE__ */ new Map();
  for (const row of pitcherRows) {
    const pitcherId = asString(row?.athlete_id);
    const side = asString(row?.home_away);
    if (pitcherId && side) pitcherSideById.set(pitcherId, side);
  }
  const homePitchMix = derivePitchMixStats(pitchEvents, pitcherSideById, "home");
  const awayPitchMix = derivePitchMixStats(pitchEvents, pitcherSideById, "away");
  const homeStarterPitches = asInt(homeStarter?.pitches_thrown);
  const awayStarterPitches = asInt(awayStarter?.pitches_thrown);
  const homeStarterOuts = asInt(homeStarter?.innings_outs);
  const awayStarterOuts = asInt(awayStarter?.innings_outs);
  const homeStarterPitchesPerOut = homeStarterPitches !== null && homeStarterOuts && homeStarterOuts > 0 ? Number((homeStarterPitches / homeStarterOuts).toFixed(4)) : null;
  const awayStarterPitchesPerOut = awayStarterPitches !== null && awayStarterOuts && awayStarterOuts > 0 ? Number((awayStarterPitches / awayStarterOuts).toFixed(4)) : null;
  const pitchEventCount = pitchEvents.length;
  const dataQualityTier = pitchEventCount >= 200 && homeStarterPitches !== null && awayStarterPitches !== null && asString(postgame?.home_plate_umpire) ? "A" : pitchEventCount >= 100 ? "B" : pitchEventCount > 0 ? "C" : "D";
  return {
    match_id: asString(postgame?.id),
    espn_event_id: asString(postgame?.espn_event_id),
    start_time: asString(postgame?.start_time),
    game_date: asString(postgame?.start_time)?.slice(0, 10) ?? null,
    season_type: asString(postgame?.season_type),
    home_team: asString(postgame?.home_team),
    away_team: asString(postgame?.away_team),
    venue: asString(postgame?.venue),
    venue_city: asString(postgame?.venue_city),
    venue_state: asString(postgame?.venue_state),
    venue_indoor: postgame?.venue_indoor === true,
    weather_temp: asInt(postgame?.weather_temp),
    weather_condition: asString(postgame?.weather_condition),
    weather_gust: asInt(postgame?.weather_gust),
    weather_precipitation: asInt(postgame?.weather_precipitation),
    home_plate_umpire: asString(postgame?.home_plate_umpire),
    home_plate_umpire_id: asString(postgame?.home_plate_umpire_id),
    umpire_called_strike_rate: calledTotal > 0 ? Number((calledStrikeCount / calledTotal).toFixed(4)) : null,
    umpire_ball_rate: calledTotal > 0 ? Number((calledBallCount / calledTotal).toFixed(4)) : null,
    umpire_total_called_pitches: calledTotal,
    home_starter_id: asString(homeStarter?.athlete_id) ?? asString(postgame?.home_starter_id),
    home_starter_name: asString(homeStarter?.athlete_name) ?? asString(postgame?.home_starter_name),
    away_starter_id: asString(awayStarter?.athlete_id) ?? asString(postgame?.away_starter_id),
    away_starter_name: asString(awayStarter?.athlete_name) ?? asString(postgame?.away_starter_name),
    home_starter_pitch_count: homeStarterPitches,
    away_starter_pitch_count: awayStarterPitches,
    home_starter_outs: homeStarterOuts,
    away_starter_outs: awayStarterOuts,
    home_starter_pitches_per_out: homeStarterPitchesPerOut,
    away_starter_pitches_per_out: awayStarterPitchesPerOut,
    home_starter_leash_bucket: leashBucket(homeStarterPitches, homeStarterOuts),
    away_starter_leash_bucket: leashBucket(awayStarterPitches, awayStarterOuts),
    home_bullpen_pitchers_used: homeBullpenRows.length,
    away_bullpen_pitchers_used: awayBullpenRows.length,
    home_bullpen_outs: homeBullpenRows.reduce((sum, row) => sum + (asInt(row?.innings_outs) || 0), 0),
    away_bullpen_outs: awayBullpenRows.reduce((sum, row) => sum + (asInt(row?.innings_outs) || 0), 0),
    home_bullpen_pitches: homeBullpenRows.reduce((sum, row) => sum + (asInt(row?.pitches_thrown) || 0), 0),
    away_bullpen_pitches: awayBullpenRows.reduce((sum, row) => sum + (asInt(row?.pitches_thrown) || 0), 0),
    home_pitch_types_used: homePitchMix.pitchTypesUsed,
    away_pitch_types_used: awayPitchMix.pitchTypesUsed,
    home_pitch_pct_vs_lhb: homePitchMix.pitchPctVsLhb,
    home_pitch_pct_vs_rhb: homePitchMix.pitchPctVsRhb,
    away_pitch_pct_vs_lhb: awayPitchMix.pitchPctVsLhb,
    away_pitch_pct_vs_rhb: awayPitchMix.pitchPctVsRhb,
    home_primary_pitch: homePitchMix.primaryPitch,
    away_primary_pitch: awayPitchMix.primaryPitch,
    home_primary_pitch_share: homePitchMix.primaryPitchShare,
    away_primary_pitch_share: awayPitchMix.primaryPitchShare,
    pitch_events_count: pitchEventCount,
    data_quality_tier: dataQualityTier,
    source: "mlb_postgame_drain_v4",
    drain_version: DRAIN_VERSION,
    last_drained_at: now,
    created_at: now,
    updated_at: now
  };
}
function buildInningScoreRow(data, matchId, eventId, startTime, seasonType, homeTeam, awayTeam, homeScore, awayScore) {
  const homeCompetitor = getCompetitor(data, "home");
  const awayCompetitor = getCompetitor(data, "away");
  const homeInnings = getLinescoreRuns(homeCompetitor?.linescores || []);
  const awayInnings = getLinescoreRuns(awayCompetitor?.linescores || []);
  const totalInnings = Math.max(homeInnings.length, awayInnings.length);
  const numericEventId = toNumericEventId(eventId);
  return {
    id: numericEventId,
    match_id: matchId,
    espn_event_id: eventId,
    game_date: startTime?.slice(0, 10) ?? null,
    season_type: seasonType,
    home_team: homeTeam,
    away_team: awayTeam,
    home_score: homeScore,
    away_score: awayScore,
    home_innings: homeInnings,
    away_innings: awayInnings,
    home_first_inning_runs: homeInnings[0] ?? 0,
    away_first_inning_runs: awayInnings[0] ?? 0,
    home_f5_runs: sumRuns(homeInnings, 0, 5),
    away_f5_runs: sumRuns(awayInnings, 0, 5),
    home_l4_runs: sumRuns(homeInnings, 5, 9),
    away_l4_runs: sumRuns(awayInnings, 5, 9),
    total_innings: totalInnings,
    is_extra_innings: totalInnings > 9,
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function buildHalftimeScoreRow(postgame, inningScores) {
  const matchId = asString(postgame.id);
  const league = "mlb";
  const gameDate = asString(inningScores.game_date ?? null);
  const homeTeam = asString(postgame.home_team);
  const awayTeam = asString(postgame.away_team);
  if (!matchId || !gameDate || !homeTeam || !awayTeam) return null;
  const homeInnings = Array.isArray(inningScores.home_innings) ? inningScores.home_innings : [];
  const awayInnings = Array.isArray(inningScores.away_innings) ? inningScores.away_innings : [];
  return {
    match_id: matchId,
    league,
    game_date: gameDate,
    home_team: homeTeam,
    away_team: awayTeam,
    h1_home_score: sumRuns(homeInnings, 0, 4),
    h1_away_score: sumRuns(awayInnings, 0, 5),
    ft_home_score: asInt(postgame.home_score),
    ft_away_score: asInt(postgame.away_score),
    source: "mlb_postgame_drain_v4"
  };
}
function extractPostgamePayload(data, eventId, matchId, startTime, canonicalGameId) {
  const boxTeams = data.boxscore?.teams || [];
  if (boxTeams.length < 2) return null;
  const awayTeamBox = boxTeams[0];
  const homeTeamBox = boxTeams[1];
  const homeStats = homeTeamBox?.statistics || [];
  const awayStats = awayTeamBox?.statistics || [];
  const homeCompetitor = getCompetitor(data, "home");
  const awayCompetitor = getCompetitor(data, "away");
  const competition = data?.header?.competitions?.[0] || {};
  const gameInfo = data.gameInfo || {};
  const venue = gameInfo?.venue || {};
  const weather = gameInfo?.weather || {};
  const seriesInfo = competition?.series || {};
  const odds = extractOdds(data);
  const seasonType = resolveSeasonType(data, startTime);
  const dayNight = resolveDayNight(startTime, gameInfo);
  const umpire = extractHomePlateUmpire(gameInfo);
  const homeTeam = asString(homeCompetitor?.team?.displayName) ?? asString(homeTeamBox?.team?.displayName);
  const awayTeam = asString(awayCompetitor?.team?.displayName) ?? asString(awayTeamBox?.team?.displayName);
  const homeScore = asInt(homeCompetitor?.score);
  const awayScore = asInt(awayCompetitor?.score);
  const winProbability = Array.isArray(data.winprobability) ? data.winprobability.map((entry) => ({
    playId: entry?.playId ?? null,
    homeWinPct: entry?.homeWinPercentage ?? null,
    tiePct: entry?.tiePercentage ?? null
  })) : null;
  const { starters, rows: pitcherLogs } = extractPitcherDetails(
    data,
    matchId,
    eventId,
    startTime,
    seasonType,
    homeTeam,
    awayTeam
  );
  const homeStarterFallback = extractStarterFromCompetitor(data, "home");
  const awayStarterFallback = extractStarterFromCompetitor(data, "away");
  if (!starters.home.name && homeStarterFallback) starters.home = homeStarterFallback;
  if (!starters.away.name && awayStarterFallback) starters.away = awayStarterFallback;
  const batterLogs = extractBatterDetails(
    data,
    matchId,
    eventId,
    startTime,
    seasonType,
    homeTeam,
    awayTeam
  );
  const pitchEvents = extractPitchEvents(data, matchId, eventId);
  const inningScores = buildInningScoreRow(
    data,
    matchId,
    eventId,
    startTime,
    seasonType,
    homeTeam,
    awayTeam,
    homeScore,
    awayScore
  );
  const totalInnings = asInt(inningScores.total_innings);
  const postgame = {
    id: matchId,
    espn_event_id: eventId,
    canonical_game_id: canonicalGameId,
    home_team: homeTeam,
    away_team: awayTeam,
    home_score: homeScore,
    away_score: awayScore,
    match_status: asString(data.header?.competitions?.[0]?.status?.type?.name),
    start_time: startTime,
    venue: asString(venue?.fullName),
    attendance: asInt(gameInfo?.attendance),
    venue_city: asString(venue?.city) ?? asString(venue?.address?.city),
    venue_state: asString(venue?.state) ?? asString(venue?.address?.state),
    venue_indoor: asBoolean(venue?.indoor),
    weather_temp: asInt(weather?.temperature),
    weather_condition: getWeatherCondition(weather),
    weather_gust: asInt(weather?.gust),
    weather_precipitation: asInt(weather?.precipitation),
    day_night: dayNight,
    home_starter_name: starters.home.name,
    away_starter_name: starters.away.name,
    home_starter_id: starters.home.id,
    away_starter_id: starters.away.id,
    home_plate_umpire: umpire.name,
    home_plate_umpire_id: umpire.id,
    series_game_number: asInt(seriesInfo?.gameNumber),
    series_length: asInt(seriesInfo?.maxGames),
    total_innings: totalInnings,
    is_extra_innings: totalInnings !== null ? totalInnings > 9 : null,
    season_type: seasonType,
    home_hits: fsInt(homeStats, "batting", "H") ?? fsInt(homeStats, "batting", "hits"),
    away_hits: fsInt(awayStats, "batting", "H") ?? fsInt(awayStats, "batting", "hits"),
    home_at_bats: fsInt(homeStats, "batting", "AB") ?? fsInt(homeStats, "batting", "atBats"),
    away_at_bats: fsInt(awayStats, "batting", "AB") ?? fsInt(awayStats, "batting", "atBats"),
    home_batting_avg: fsNum(homeStats, "batting", "AVG") ?? fsNum(homeStats, "batting", "avg"),
    away_batting_avg: fsNum(awayStats, "batting", "AVG") ?? fsNum(awayStats, "batting", "avg"),
    home_runs_batted_in: fsInt(homeStats, "batting", "RBI") ?? fsInt(homeStats, "batting", "RBIs"),
    away_runs_batted_in: fsInt(awayStats, "batting", "RBI") ?? fsInt(awayStats, "batting", "RBIs"),
    home_home_runs: fsInt(homeStats, "batting", "HR") ?? fsInt(homeStats, "batting", "homeRuns"),
    away_home_runs: fsInt(awayStats, "batting", "HR") ?? fsInt(awayStats, "batting", "homeRuns"),
    home_strikeouts_batting: fsInt(homeStats, "batting", "SO") ?? fsInt(homeStats, "batting", "strikeouts"),
    away_strikeouts_batting: fsInt(awayStats, "batting", "SO") ?? fsInt(awayStats, "batting", "strikeouts"),
    home_walks_batting: fsInt(homeStats, "batting", "BB") ?? fsInt(homeStats, "batting", "walks"),
    away_walks_batting: fsInt(awayStats, "batting", "BB") ?? fsInt(awayStats, "batting", "walks"),
    home_obp: fsNum(homeStats, "batting", "OBP") ?? fsNum(homeStats, "batting", "onBasePct"),
    away_obp: fsNum(awayStats, "batting", "OBP") ?? fsNum(awayStats, "batting", "onBasePct"),
    home_slg: fsNum(homeStats, "batting", "SLG") ?? fsNum(homeStats, "batting", "slugAvg"),
    away_slg: fsNum(awayStats, "batting", "SLG") ?? fsNum(awayStats, "batting", "slugAvg"),
    home_ops: fsNum(homeStats, "batting", "OPS") ?? fsNum(homeStats, "batting", "OPS"),
    away_ops: fsNum(awayStats, "batting", "OPS") ?? fsNum(awayStats, "batting", "OPS"),
    home_lob: fsInt(homeStats, "batting", "LOB") ?? fsInt(homeStats, "batting", "leftOnBase"),
    away_lob: fsInt(awayStats, "batting", "LOB") ?? fsInt(awayStats, "batting", "leftOnBase"),
    home_stolen_bases: fsInt(homeStats, "batting", "SB") ?? fsInt(homeStats, "batting", "stolenBases"),
    away_stolen_bases: fsInt(awayStats, "batting", "SB") ?? fsInt(awayStats, "batting", "stolenBases"),
    home_iso: fsNum(homeStats, "batting", "ISO") ?? fsNum(homeStats, "batting", "isolatedPower"),
    away_iso: fsNum(awayStats, "batting", "ISO") ?? fsNum(awayStats, "batting", "isolatedPower"),
    home_runs_created: fsNum(homeStats, "batting", "RC") ?? fsNum(homeStats, "batting", "runsCreated"),
    away_runs_created: fsNum(awayStats, "batting", "RC") ?? fsNum(awayStats, "batting", "runsCreated"),
    home_bb_k: fsNum(homeStats, "batting", "BB/K") ?? fsNum(homeStats, "batting", "bbk"),
    away_bb_k: fsNum(awayStats, "batting", "BB/K") ?? fsNum(awayStats, "batting", "bbk"),
    home_xbh: fsInt(homeStats, "batting", "XBH") ?? fsInt(homeStats, "batting", "extraBaseHits"),
    away_xbh: fsInt(awayStats, "batting", "XBH") ?? fsInt(awayStats, "batting", "extraBaseHits"),
    home_war_batting: fsNum(homeStats, "batting", "WAR") ?? fsNum(homeStats, "batting", "war"),
    away_war_batting: fsNum(awayStats, "batting", "WAR") ?? fsNum(awayStats, "batting", "war"),
    home_go_fo: fsNum(homeStats, "batting", "GO/FO") ?? fsNum(homeStats, "batting", "goFo"),
    away_go_fo: fsNum(awayStats, "batting", "GO/FO") ?? fsNum(awayStats, "batting", "goFo"),
    home_sb_pct: fsNum(homeStats, "batting", "SB%") ?? fsNum(homeStats, "batting", "stolenBasePct"),
    away_sb_pct: fsNum(awayStats, "batting", "SB%") ?? fsNum(awayStats, "batting", "stolenBasePct"),
    home_pa: fsInt(homeStats, "batting", "PA") ?? fsInt(homeStats, "batting", "plateAppearances"),
    away_pa: fsInt(awayStats, "batting", "PA") ?? fsInt(awayStats, "batting", "plateAppearances"),
    home_era: fsNum(homeStats, "pitching", "ERA") ?? fsNum(homeStats, "pitching", "era"),
    away_era: fsNum(awayStats, "pitching", "ERA") ?? fsNum(awayStats, "pitching", "era"),
    home_innings_pitched: findStat(homeStats, "pitching", "IP") ?? findStat(homeStats, "pitching", "innings"),
    away_innings_pitched: findStat(awayStats, "pitching", "IP") ?? findStat(awayStats, "pitching", "innings"),
    home_hits_allowed: fsInt(homeStats, "pitching", "H") ?? fsInt(homeStats, "pitching", "hits"),
    away_hits_allowed: fsInt(awayStats, "pitching", "H") ?? fsInt(awayStats, "pitching", "hits"),
    home_earned_runs: fsInt(homeStats, "pitching", "ER") ?? fsInt(homeStats, "pitching", "earnedRuns"),
    away_earned_runs: fsInt(awayStats, "pitching", "ER") ?? fsInt(awayStats, "pitching", "earnedRuns"),
    home_walks_pitching: fsInt(homeStats, "pitching", "BB") ?? fsInt(homeStats, "pitching", "walks"),
    away_walks_pitching: fsInt(awayStats, "pitching", "BB") ?? fsInt(awayStats, "pitching", "walks"),
    home_strikeouts_pitching: fsInt(homeStats, "pitching", "K") ?? fsInt(homeStats, "pitching", "strikeouts"),
    away_strikeouts_pitching: fsInt(awayStats, "pitching", "K") ?? fsInt(awayStats, "pitching", "strikeouts"),
    home_whip: fsNum(homeStats, "pitching", "WHIP"),
    away_whip: fsNum(awayStats, "pitching", "WHIP"),
    home_pitches_thrown: fsInt(homeStats, "pitching", "P") ?? fsInt(homeStats, "pitching", "NP") ?? fsInt(homeStats, "pitching", "numberOfPitches"),
    away_pitches_thrown: fsInt(awayStats, "pitching", "P") ?? fsInt(awayStats, "pitching", "NP") ?? fsInt(awayStats, "pitching", "numberOfPitches"),
    home_hr_allowed: fsInt(homeStats, "pitching", "HR") ?? fsInt(homeStats, "pitching", "homeRuns"),
    away_hr_allowed: fsInt(awayStats, "pitching", "HR") ?? fsInt(awayStats, "pitching", "homeRuns"),
    home_ground_balls: fsInt(homeStats, "pitching", "GB") ?? fsInt(homeStats, "pitching", "groundBalls"),
    away_ground_balls: fsInt(awayStats, "pitching", "GB") ?? fsInt(awayStats, "pitching", "groundBalls"),
    home_fly_balls: fsInt(homeStats, "pitching", "FB") ?? fsInt(homeStats, "pitching", "flyBalls"),
    away_fly_balls: fsInt(awayStats, "pitching", "FB") ?? fsInt(awayStats, "pitching", "flyBalls"),
    home_gb_fb_ratio: fsNum(homeStats, "pitching", "GB/FB") ?? fsNum(homeStats, "pitching", "gbFbRatio"),
    away_gb_fb_ratio: fsNum(awayStats, "pitching", "GB/FB") ?? fsNum(awayStats, "pitching", "gbFbRatio"),
    home_k_9: fsNum(homeStats, "pitching", "K/9") ?? fsNum(homeStats, "pitching", "k9"),
    away_k_9: fsNum(awayStats, "pitching", "K/9") ?? fsNum(awayStats, "pitching", "k9"),
    home_k_bb: fsNum(homeStats, "pitching", "K/BB") ?? fsNum(homeStats, "pitching", "kbb"),
    away_k_bb: fsNum(awayStats, "pitching", "K/BB") ?? fsNum(awayStats, "pitching", "kbb"),
    home_opp_avg: fsNum(homeStats, "pitching", "OBA") ?? fsNum(homeStats, "pitching", "oppAvg"),
    away_opp_avg: fsNum(awayStats, "pitching", "OBA") ?? fsNum(awayStats, "pitching", "oppAvg"),
    home_opp_obp: fsNum(homeStats, "pitching", "OOBP") ?? fsNum(homeStats, "pitching", "oppObp"),
    away_opp_obp: fsNum(awayStats, "pitching", "OOBP") ?? fsNum(awayStats, "pitching", "oppObp"),
    home_opp_slg: fsNum(homeStats, "pitching", "OSLG") ?? fsNum(homeStats, "pitching", "oppSlg"),
    away_opp_slg: fsNum(awayStats, "pitching", "OSLG") ?? fsNum(awayStats, "pitching", "oppSlg"),
    home_opp_ops: fsNum(homeStats, "pitching", "OOPS") ?? fsNum(homeStats, "pitching", "oppOps"),
    away_opp_ops: fsNum(awayStats, "pitching", "OOPS") ?? fsNum(awayStats, "pitching", "oppOps"),
    home_quality_starts: fsInt(homeStats, "pitching", "QS") ?? fsInt(homeStats, "pitching", "qualityStarts"),
    away_quality_starts: fsInt(awayStats, "pitching", "QS") ?? fsInt(awayStats, "pitching", "qualityStarts"),
    home_inherited_runners: fsInt(homeStats, "pitching", "IR") ?? fsInt(homeStats, "pitching", "inheritedRunners"),
    away_inherited_runners: fsInt(awayStats, "pitching", "IR") ?? fsInt(awayStats, "pitching", "inheritedRunners"),
    home_inherited_scored: fsInt(homeStats, "pitching", "IRS") ?? fsInt(homeStats, "pitching", "inheritedScored"),
    away_inherited_scored: fsInt(awayStats, "pitching", "IRS") ?? fsInt(awayStats, "pitching", "inheritedScored"),
    home_holds: fsInt(homeStats, "pitching", "HLD") ?? fsInt(homeStats, "pitching", "holds"),
    away_holds: fsInt(awayStats, "pitching", "HLD") ?? fsInt(awayStats, "pitching", "holds"),
    home_blown_saves: fsInt(homeStats, "pitching", "BS") ?? fsInt(homeStats, "pitching", "blownSaves"),
    away_blown_saves: fsInt(awayStats, "pitching", "BS") ?? fsInt(awayStats, "pitching", "blownSaves"),
    home_save_opps: fsInt(homeStats, "pitching", "SVO") ?? fsInt(homeStats, "pitching", "saveOpportunities"),
    away_save_opps: fsInt(awayStats, "pitching", "SVO") ?? fsInt(awayStats, "pitching", "saveOpportunities"),
    home_tbf: fsInt(homeStats, "pitching", "BF") ?? fsInt(homeStats, "pitching", "TBF") ?? fsInt(homeStats, "pitching", "battersFaced"),
    away_tbf: fsInt(awayStats, "pitching", "BF") ?? fsInt(awayStats, "pitching", "TBF") ?? fsInt(awayStats, "pitching", "battersFaced"),
    home_war_pitching: fsNum(homeStats, "pitching", "WAR") ?? fsNum(homeStats, "pitching", "war"),
    away_war_pitching: fsNum(awayStats, "pitching", "WAR") ?? fsNum(awayStats, "pitching", "war"),
    home_run_support: fsNum(homeStats, "pitching", "RSA") ?? fsNum(homeStats, "pitching", "runSupport"),
    away_run_support: fsNum(awayStats, "pitching", "RSA") ?? fsNum(awayStats, "pitching", "runSupport"),
    home_errors: fsInt(homeStats, "fielding", "E") ?? fsInt(homeStats, "fielding", "errors"),
    away_errors: fsInt(awayStats, "fielding", "E") ?? fsInt(awayStats, "fielding", "errors"),
    home_fielding_pct: fsNum(homeStats, "fielding", "FPCT") ?? fsNum(homeStats, "fielding", "fieldingPct"),
    away_fielding_pct: fsNum(awayStats, "fielding", "FPCT") ?? fsNum(awayStats, "fielding", "fieldingPct"),
    home_dwar: fsNum(homeStats, "fielding", "DWAR") ?? fsNum(homeStats, "fielding", "dwar"),
    away_dwar: fsNum(awayStats, "fielding", "DWAR") ?? fsNum(awayStats, "fielding", "dwar"),
    home_batting_stats: extractFullCategory(homeStats, "batting"),
    away_batting_stats: extractFullCategory(awayStats, "batting"),
    home_pitching_stats: extractFullCategory(homeStats, "pitching"),
    away_pitching_stats: extractFullCategory(awayStats, "pitching"),
    home_fielding_stats: extractFullCategory(homeStats, "fielding"),
    away_fielding_stats: extractFullCategory(awayStats, "fielding"),
    ...odds,
    run_line_result: resolveRunLineResult(odds.home_run_line, homeScore, awayScore),
    win_probability: winProbability,
    drain_version: DRAIN_VERSION,
    last_drained_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const contextLayer = deriveContextLayerRow(postgame, pitcherLogs, pitchEvents);
  return {
    postgame,
    inningScores,
    pitcherLogs,
    batterLogs,
    pitchEvents,
    contextLayer,
    halftimeRow: buildHalftimeScoreRow(postgame, inningScores)
  };
}
async function replaceRowsByMatchId(supabase, table, matchIds, rows, errors, insertBatchSize) {
  if (matchIds.length === 0) return;
  for (let index = 0; index < matchIds.length; index += 100) {
    const idBatch = matchIds.slice(index, index + 100);
    const { error } = await supabase.from(table).delete().in("match_id", idBatch);
    if (error) {
      errors.push(`${table} delete: ${error.message}`);
      return;
    }
  }
  if (rows.length === 0) return;
  for (let index = 0; index < rows.length; index += insertBatchSize) {
    const batch = rows.slice(index, index + insertBatchSize);
    const { error } = await supabase.from(table).insert(batch);
    if (error) errors.push(`${table} insert: ${error.message}`);
  }
}
async function upsertPostgameRows(supabase, rows, errors) {
  const successfulMatchIds = [];
  if (rows.length === 0) return successfulMatchIds;
  for (let index = 0; index < rows.length; index += 20) {
    const batch = rows.slice(index, index + 20);
    const { error } = await supabase.from("mlb_postgame").upsert(batch, { onConflict: "id" });
    if (!error) {
      for (const row of batch) {
        const matchId = asString(row?.id);
        if (matchId) successfulMatchIds.push(matchId);
      }
      continue;
    }
    for (const row of batch) {
      const { error: rowError } = await supabase.from("mlb_postgame").upsert(row, { onConflict: "id" });
      if (rowError) {
        const matchId = asString(row?.id) ?? "unknown_match";
        const espnEventId = asString(row?.espn_event_id) ?? "unknown_event";
        errors.push(`mlb_postgame upsert ${matchId}/${espnEventId}: ${rowError.message}`);
        continue;
      }
      const matchId = asString(row?.id);
      if (matchId) successfulMatchIds.push(matchId);
    }
  }
  return successfulMatchIds;
}
async function ensureCanonicalGameId(supabase, matchRow, payload, errors) {
  const matchId = asString(matchRow?.id) ?? asString(payload?.postgame?.id);
  const eventId = asString(payload?.postgame?.espn_event_id) ?? stripLeagueSuffix(matchId);
  if (!matchId) return null;
  let canonicalGameId = asString(matchRow?.canonical_game_id) ?? asString(matchRow?.canonical_id) ?? asString(payload?.postgame?.canonical_game_id);
  let mappingCanonicalId = null;
  if (!canonicalGameId && eventId) {
    const { data: mappingRow, error: mappingLookupError } = await supabase.from("entity_mappings").select("canonical_id").eq("provider", "ESPN").eq("external_id", eventId).limit(1).maybeSingle();
    if (mappingLookupError) {
      errors.push(`entity_mappings lookup ${matchId}/${eventId}: ${mappingLookupError.message}`);
      return null;
    }
    mappingCanonicalId = asString(mappingRow?.canonical_id);
    canonicalGameId = mappingCanonicalId ?? matchId;
  }
  if (!canonicalGameId) return null;
  const { data: canonicalRow, error: canonicalLookupError } = await supabase.from("canonical_games").select("id").eq("id", canonicalGameId).limit(1).maybeSingle();
  if (canonicalLookupError) {
    errors.push(`canonical_games lookup ${matchId}/${canonicalGameId}: ${canonicalLookupError.message}`);
    return null;
  }
  if (!canonicalRow?.id) {
    const commenceTime = asString(matchRow?.start_time) ?? asString(payload?.postgame?.start_time);
    if (!commenceTime) {
      errors.push(`canonical_games insert ${matchId}/${canonicalGameId}: missing commence_time`);
      return null;
    }
    const { error: canonicalInsertError } = await supabase.from("canonical_games").insert({
      id: canonicalGameId,
      league_id: "mlb",
      sport: "baseball",
      home_team_name: asString(payload?.postgame?.home_team) ?? asString(matchRow?.home_team),
      away_team_name: asString(payload?.postgame?.away_team) ?? asString(matchRow?.away_team),
      commence_time: commenceTime,
      status: asString(payload?.postgame?.match_status) ?? asString(matchRow?.status) ?? "STATUS_FINAL",
      game_uuid: crypto.randomUUID()
    });
    if (canonicalInsertError) {
      errors.push(`canonical_games insert ${matchId}/${canonicalGameId}: ${canonicalInsertError.message}`);
      return null;
    }
  }
  if (eventId && !mappingCanonicalId) {
    const { error: mappingInsertError } = await supabase.from("entity_mappings").insert({
      canonical_id: canonicalGameId,
      provider: "ESPN",
      external_id: eventId,
      confidence_score: 1,
      discovery_method: "mlb_postgame_canonical_heal"
    });
    if (mappingInsertError && !mappingInsertError.message.toLowerCase().includes("duplicate")) {
      errors.push(`entity_mappings insert ${matchId}/${eventId}: ${mappingInsertError.message}`);
      return null;
    }
  }
  const { error: matchUpdateError } = await supabase.from("matches").update({
    canonical_id: canonicalGameId,
    canonical_game_id: canonicalGameId
  }).eq("id", matchId);
  if (matchUpdateError) {
    errors.push(`matches canonical sync ${matchId}/${canonicalGameId}: ${matchUpdateError.message}`);
    return null;
  }
  return canonicalGameId;
}
async function insertMissingHalftimeRows(supabase, rows, errors) {
  if (rows.length === 0) return 0;
  const matchIds = rows.map((row) => asString(row.match_id)).filter((value) => Boolean(value));
  if (matchIds.length === 0) return 0;
  const { data: existing, error: existingError } = await supabase.from("match_halftime_scores").select("match_id").in("match_id", matchIds);
  if (existingError) {
    errors.push(`match_halftime_scores lookup: ${existingError.message}`);
    return 0;
  }
  const existingIds = new Set((existing || []).map((row) => asString(row?.match_id)).filter((value) => Boolean(value)));
  const missingRows = rows.filter((row) => {
    const matchId = asString(row.match_id);
    return matchId && !existingIds.has(matchId);
  });
  if (missingRows.length === 0) return 0;
  for (let index = 0; index < missingRows.length; index += 100) {
    const batch = missingRows.slice(index, index + 100);
    const { error } = await supabase.from("match_halftime_scores").insert(batch);
    if (error) {
      errors.push(`match_halftime_scores insert: ${error.message}`);
      return 0;
    }
  }
  return missingRows.length;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );
  const url = new URL(req.url);
  const daysBack = parseInt(url.searchParams.get("days") || "60", 10);
  const batchLimit = parseInt(url.searchParams.get("limit") || "30", 10);
  const dry = url.searchParams.get("dry") === "true";
  const force = url.searchParams.get("force") === "true";
  const errors = [];
  const cutoff = /* @__PURE__ */ new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const { data: matchRows, error: matchErr } = await supabase.from("matches").select("id, home_team, away_team, start_time, status, canonical_game_id, canonical_id").eq("league_id", "mlb").eq("status", "STATUS_FINAL").gte("start_time", cutoff.toISOString()).order("start_time", { ascending: false });
  if (matchErr) {
    return new Response(JSON.stringify({ error: matchErr.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
  const found = matchRows?.length || 0;
  let toDrain = matchRows || [];
  if (!force && toDrain.length > 0) {
    const ids = toDrain.map((row) => row.id);
    const { data: existing, error: existingError } = await supabase.from("mlb_postgame").select("id, drain_version, home_starter_name, away_starter_name, total_innings, home_at_bats, away_at_bats, home_iso, away_iso, home_k_9, away_k_9, home_errors, away_errors").in("id", ids);
    if (existingError) {
      errors.push(`mlb_postgame lookup: ${existingError.message}`);
    } else {
      const existingById = new Map((existing || []).map((row) => [row.id, row]));
      toDrain = toDrain.filter((row) => {
        const existingRow = existingById.get(row.id);
        if (!existingRow) return true;
        const hasCoreBatting = existingRow.home_at_bats !== null && existingRow.away_at_bats !== null;
        const missingV4Derived = hasCoreBatting && existingRow.home_iso === null && existingRow.away_iso === null && existingRow.home_k_9 === null && existingRow.away_k_9 === null && existingRow.home_errors === null && existingRow.away_errors === null;
        return existingRow.drain_version !== DRAIN_VERSION || !existingRow.home_starter_name || !existingRow.away_starter_name || existingRow.total_innings === null || existingRow.total_innings === void 0 || missingV4Derived;
      });
    }
  }
  const totalEligible = toDrain.length;
  toDrain = toDrain.slice(0, batchLimit);
  const skipped = found - totalEligible;
  if (dry) {
    return new Response(JSON.stringify({
      dryRun: true,
      found,
      totalEligible,
      wouldDrain: toDrain.length,
      skipped,
      batchLimit,
      remaining: totalEligible - toDrain.length,
      targetVersion: DRAIN_VERSION
    }, null, 2), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
  const drainResults = await processBatch(toDrain, MAX_CONCURRENT, INTER_BATCH_MS, async (row) => {
    const eventId = stripLeagueSuffix(asString(row.id));
    if (!eventId) {
      errors.push(`${row.id}: unable to derive ESPN event id`);
      return null;
    }
    try {
      const response = await fetchWithTimeout(`${ESPN_BASE}?event=${eventId}`, FETCH_TIMEOUT_MS);
      if (!response.ok) {
        errors.push(`${eventId}: ESPN ${response.status}`);
        return null;
      }
      const data = await response.json();
      if ((data.boxscore?.teams || []).length < 2) {
        errors.push(`${eventId}: no boxscore teams`);
        return null;
      }
      const payload = extractPostgamePayload(data, eventId, row.id, row.start_time, row.canonical_game_id ?? row.canonical_id ?? null);
      if (!payload) {
        errors.push(`${eventId}: unable to extract postgame payload`);
        return null;
      }
      const canonicalGameId = await ensureCanonicalGameId(supabase, row, payload, errors);
      if (!canonicalGameId) {
        errors.push(`${eventId}: unable to ensure canonical game id`);
        return null;
      }
      payload.postgame.canonical_game_id = canonicalGameId;
      return payload;
    } catch (error) {
      errors.push(`${eventId}: ${error.message}`);
      return null;
    }
  });
  const valid = drainResults.filter(Boolean);
  const postgameRows = valid.map((item) => item.postgame);
  const persistedMatchIds = new Set(await upsertPostgameRows(supabase, postgameRows, errors));
  const persistedValid = valid.filter((item) => {
    const matchId = asString(item?.postgame?.id);
    return matchId ? persistedMatchIds.has(matchId) : false;
  });
  const inningRows = persistedValid.map((item) => item.inningScores);
  const pitcherRows = persistedValid.flatMap((item) => item.pitcherLogs);
  const batterRows = persistedValid.flatMap((item) => item.batterLogs || []);
  const pitchEventRows = persistedValid.flatMap((item) => item.pitchEvents || []);
  const contextRows = persistedValid.map((item) => item.contextLayer).filter((row) => {
    const matchId = asString(row?.match_id);
    return Boolean(matchId);
  });
  const halftimeRows = persistedValid.map((item) => item.halftimeRow).filter(Boolean);
  const drainedMatchIds = Array.from(persistedMatchIds);
  await replaceRowsByMatchId(supabase, "mlb_inning_scores", drainedMatchIds, inningRows, errors, 50);
  await replaceRowsByMatchId(supabase, "mlb_pitcher_game_logs", drainedMatchIds, pitcherRows, errors, 100);
  await replaceRowsByMatchId(supabase, "mlb_batter_game_logs", drainedMatchIds, batterRows, errors, 150);
  await replaceRowsByMatchId(supabase, "mlb_pitch_events", drainedMatchIds, pitchEventRows, errors, 500);
  await replaceRowsByMatchId(supabase, "mlb_game_context_layers", drainedMatchIds, contextRows, errors, 100);
  const halftimeInserted = await insertMissingHalftimeRows(supabase, halftimeRows, errors);
  let rollingFormRefreshed = false;
  if (drainedMatchIds.length > 0) {
    const { error: refreshError } = await supabase.rpc("refresh_mlb_team_rolling_form");
    if (refreshError) {
      errors.push(`refresh_mlb_team_rolling_form: ${refreshError.message}`);
    } else {
      rollingFormRefreshed = true;
    }
  }
  const samplePostgame = postgameRows[0] ?? null;
  const sampleInnings = inningRows[0] ?? null;
  const samplePitcher = pitcherRows.find((row) => row.is_starter === true) ?? pitcherRows[0] ?? null;
  const sampleBatter = batterRows[0] ?? null;
  const samplePitchEvent = pitchEventRows.find((row) => row.pitch_type || row.play_type) ?? pitchEventRows[0] ?? null;
  const sampleContext = contextRows[0] ?? null;
  const sample = samplePostgame ? {
    match: `${samplePostgame.away_team} @ ${samplePostgame.home_team}: ${samplePostgame.away_score}-${samplePostgame.home_score}`,
    starters: `${samplePostgame.away_starter_name || "n/a"} vs ${samplePostgame.home_starter_name || "n/a"}`,
    venue_weather: `${samplePostgame.venue || "Unknown venue"} | ${samplePostgame.venue_city || "n/a"}, ${samplePostgame.venue_state || "n/a"} | temp ${samplePostgame.weather_temp ?? "n/a"} | cond ${samplePostgame.weather_condition ?? "n/a"}`,
    inning_shape: sampleInnings ? `F5 ${sampleInnings.away_f5_runs}-${sampleInnings.home_f5_runs} | L4 ${sampleInnings.away_l4_runs}-${sampleInnings.home_l4_runs} | innings ${sampleInnings.total_innings}` : null,
    pitcher_log_sample: samplePitcher ? `${samplePitcher.athlete_name} ${samplePitcher.innings_pitched || "n/a"} IP | K ${samplePitcher.strikeouts ?? "n/a"} | BB ${samplePitcher.walks ?? "n/a"} | ERA ${samplePitcher.era ?? "n/a"}` : null,
    batter_log_sample: sampleBatter ? `${sampleBatter.athlete_name} ${sampleBatter.hits ?? "n/a"} H | ${sampleBatter.home_runs ?? "n/a"} HR | OPS ${sampleBatter.ops ?? "n/a"}` : null,
    pitch_event_sample: samplePitchEvent ? `${samplePitchEvent.play_type || "play"} ${samplePitchEvent.pitch_type_abbr || samplePitchEvent.pitch_type || "n/a"} ${samplePitchEvent.pitch_velocity ?? "n/a"}mph` : null,
    context_sample: sampleContext ? `Leash ${sampleContext.away_starter_leash_bucket || "n/a"}/${sampleContext.home_starter_leash_bucket || "n/a"} | Bullpen pitches ${sampleContext.away_bullpen_pitches ?? "n/a"}/${sampleContext.home_bullpen_pitches ?? "n/a"} | Ump called-strike ${sampleContext.umpire_called_strike_rate ?? "n/a"}` : null,
    dk_line: `ML ${samplePostgame.dk_home_ml ?? "n/a"}/${samplePostgame.dk_away_ml ?? "n/a"} | Total ${samplePostgame.dk_total ?? "n/a"}`
  } : null;
  return new Response(JSON.stringify({
    success: errors.length === 0,
    sport: "MLB",
    version: DRAIN_VERSION,
    found,
    drained: drainedMatchIds.length,
    skipped,
    inningScoreRows: inningRows.length,
    pitcherLogRows: pitcherRows.length,
    batterLogRows: batterRows.length,
    pitchEventRows: pitchEventRows.length,
    contextLayerRows: contextRows.length,
    halftimeRowsInserted: halftimeInserted,
    rollingFormRefreshed,
    sample,
    errorsCount: errors.length,
    errors: chunk(errors, 20)
  }, null, 2), {
    headers: { ...CORS, "Content-Type": "application/json" }
  });
});
