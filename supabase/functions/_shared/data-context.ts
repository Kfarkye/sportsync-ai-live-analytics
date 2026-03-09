// deno-lint-ignore-file no-explicit-any

type DataContextSummary = {
  has_ou_trends: boolean;
  has_ats_trends: boolean;
  has_ml_streaks: boolean;
  has_line_movement: boolean;
  has_starting_pitchers: boolean;
  has_pitcher_game_logs: boolean;
  has_team_pitching_stats: boolean;
  has_soccer_depth: boolean;
  has_referee_signals: boolean;
  has_h2h: boolean;
  context_length: number;
  sections_count: number;
};

type DataContextBundle = {
  context: string;
  summary: DataContextSummary;
};

type FinalMatchRow = {
  id?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  start_time?: string | null;
  league_id?: string | null;
  status?: string | null;
};

const QUERY_TIMEOUT_MS = 2_000;
const CONTEXT_MAX_CHARS = 3_000;
const ML_WINDOW = 10;

const LEAGUE_ALIAS: Record<string, string[]> = {
  "eng.1": ["eng.1", "epl"],
  "esp.1": ["esp.1", "laliga"],
  "ita.1": ["ita.1", "seriea"],
  "ger.1": ["ger.1", "bundesliga"],
  "fra.1": ["fra.1", "ligue1"],
  "usa.1": ["usa.1", "mls"],
  "uefa.champions": ["uefa.champions", "ucl"],
  "uefa.europa": ["uefa.europa", "uel"],
  "mens-college-basketball": ["mens-college-basketball", "ncaab"],
  "nba": ["nba"],
  "nhl": ["nhl"],
  "mlb": ["mlb"],
  "nfl": ["nfl"],
};

const DEFAULT_SUMMARY = (): DataContextSummary => ({
  has_ou_trends: false,
  has_ats_trends: false,
  has_ml_streaks: false,
  has_line_movement: false,
  has_starting_pitchers: false,
  has_pitcher_game_logs: false,
  has_team_pitching_stats: false,
  has_soccer_depth: false,
  has_referee_signals: false,
  has_h2h: false,
  context_length: 0,
  sections_count: 0,
});

const normalize = (value: unknown): string => String(value ?? "").trim();
const normKey = (value: unknown): string => normalize(value).toLowerCase();

const parseNum = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    const parsed = Number(raw.replace(/[^0-9+.\-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const fmtNum = (value: unknown, digits = 1): string => {
  const n = parseNum(value);
  return n === null ? "—" : n.toFixed(digits);
};

const fmtPct = (value: unknown): string => {
  const n = parseNum(value);
  if (n === null) return "—";
  const pct = n >= 0 && n <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
};

const fmtSigned = (value: unknown, digits = 1): string => {
  const n = parseNum(value);
  if (n === null) return "—";
  const fixed = n.toFixed(digits);
  return n > 0 ? `+${fixed}` : fixed;
};

const toIsoDate = (value: string | null | undefined): string => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

const canonicalLeagueId = (leagueId: string): string => {
  const key = normKey(leagueId);
  for (const [canonical, aliases] of Object.entries(LEAGUE_ALIAS)) {
    if (aliases.includes(key)) return canonical;
  }
  return key;
};

const leagueCandidates = (leagueId: string): string[] => {
  const canonical = canonicalLeagueId(leagueId);
  const out = new Set<string>([canonical, normKey(leagueId)]);
  (LEAGUE_ALIAS[canonical] || []).forEach((v) => out.add(v));
  return Array.from(out).filter(Boolean);
};

const isSoccer = (sport: string, leagueId: string): boolean => {
  const s = normKey(sport);
  if (s.includes("soccer")) return true;
  const l = canonicalLeagueId(leagueId);
  return ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "usa.1", "uefa.champions", "uefa.europa"].includes(l);
};

const isMlb = (sport: string, leagueId: string): boolean => {
  const s = normKey(sport);
  return s.includes("baseball") || canonicalLeagueId(leagueId) === "mlb";
};

async function withTimeout<T>(label: string, promise: Promise<T>, timeoutMs = QUERY_TIMEOUT_MS): Promise<T | null> {
  let timer: number | null = null;
  try {
    const timeoutPromise = new Promise<T | null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs) as unknown as number;
    });
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } catch (error) {
    console.warn(`[data-context:${label}]`, (error as Error)?.message ?? "query failed");
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function queryRows<T>(label: string, queryPromise: Promise<{ data: T; error: any }>): Promise<T | null> {
  const result = await withTimeout(label, queryPromise);
  if (!result) return null;
  if ((result as any).error) {
    console.warn(`[data-context:${label}]`, (result as any).error?.message || "query error");
    return null;
  }
  return (result as any).data ?? null;
}

const toArray = <T>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : [];

const buildMlRecord = (teamName: string, matches: FinalMatchRow[]): { wins: number; losses: number; pct: number; sample: number } | null => {
  const teamKey = normKey(teamName);
  const rows = toArray(matches)
    .filter((m) => normKey(m.home_team) === teamKey || normKey(m.away_team) === teamKey)
    .sort((a, b) => (new Date(b.start_time || 0).getTime() - new Date(a.start_time || 0).getTime()))
    .slice(0, ML_WINDOW);

  if (!rows.length) return null;

  let wins = 0;
  let losses = 0;
  for (const r of rows) {
    const hs = parseNum(r.home_score);
    const as = parseNum(r.away_score);
    if (hs === null || as === null) continue;
    const isHome = normKey(r.home_team) === teamKey;
    const teamScore = isHome ? hs : as;
    const oppScore = isHome ? as : hs;
    if (teamScore > oppScore) wins += 1;
    else if (teamScore < oppScore) losses += 1;
  }

  const sample = wins + losses;
  if (!sample) return null;
  return { wins, losses, pct: Number(((wins / sample) * 100).toFixed(1)), sample };
};

const readJson = (value: unknown): any => {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return null;
};

const extractProbable = (competitor: any): any | null => {
  const arr = toArray(competitor?.probables);
  if (arr.length > 0) return arr[0];
  const compProbables = toArray(competitor?.team?.probables);
  return compProbables[0] || null;
};

const extractCategoryStat = (categories: any[], keys: string[]): string | null => {
  for (const cat of categories) {
    const stats = toArray(cat?.stats);
    for (const stat of stats) {
      const name = `${normalize(stat?.name)} ${normalize(stat?.abbreviation)} ${normalize(stat?.displayName)} ${normalize(stat?.shortDisplayName)}`.toLowerCase();
      if (keys.some((k) => name.includes(k))) {
        const displayValue = normalize(stat?.displayValue);
        if (displayValue) return displayValue;
        const value = normalize(stat?.value);
        if (value) return value;
      }
    }
  }
  return null;
};

const parsePitcherFromProbable = (probable: any): { name: string; throwsHand: string; id: string; springSummary: string } | null => {
  if (!probable) return null;
  const athlete = probable?.athlete || {};
  const name = normalize(athlete?.fullName) || normalize(probable?.displayName);
  if (!name) return null;

  const id = normalize(athlete?.id || probable?.athleteId || probable?.id);
  const throwsHand = normalize(athlete?.throws?.abbreviation || athlete?.throws?.displayName || probable?.throws);

  const categories = toArray(probable?.statistics?.splits?.categories).concat(toArray(probable?.statistics?.categories));
  const k = extractCategoryStat(categories, ["k", "strikeout"]);
  const whip = extractCategoryStat(categories, ["whip"]);
  const era = extractCategoryStat(categories, ["era"]);
  const ip = extractCategoryStat(categories, ["ip", "innings"]);

  const bits: string[] = [];
  if (k) bits.push(`${k}K`);
  if (whip) bits.push(`${whip} WHIP`);
  if (era) bits.push(`${era} ERA`);
  if (ip) bits.push(`${ip} IP`);
  const springSummary = bits.length ? bits.join(", ") : "No spring stats available";

  return { name, throwsHand, id, springSummary };
};

const computePitcherLogsSummary = (rows: any[]): string => {
  const logs = toArray(rows);
  if (!logs.length) return "Last 5 starts: N/A";

  let ipSum = 0;
  let kSum = 0;
  let erSum = 0;
  let pSum = 0;
  let ipN = 0;
  let kN = 0;
  let erN = 0;
  let pN = 0;

  for (const row of logs) {
    const stats = readJson(row.stats) || {};
    const ip = parseNum(stats.IP ?? stats.ip);
    const k = parseNum(stats.K ?? stats.k);
    const er = parseNum(stats.ER ?? stats.er);
    const p = parseNum(stats.P ?? stats.pitches ?? stats.PIT);
    if (ip !== null) { ipSum += ip; ipN += 1; }
    if (k !== null) { kSum += k; kN += 1; }
    if (er !== null) { erSum += er; erN += 1; }
    if (p !== null) { pSum += p; pN += 1; }
  }

  const ipAvg = ipN ? (ipSum / ipN).toFixed(1) : "—";
  const kAvg = kN ? (kSum / kN).toFixed(1) : "—";
  const erAvg = erN ? (erSum / erN).toFixed(1) : "—";
  const pAvg = pN ? (pSum / pN).toFixed(0) : "—";
  return `Last 5 starts: avg ${ipAvg} IP, ${kAvg} K, ${erAvg} ER, ${pAvg} pitches`;
};

const parseLinescoreFirstInning = (rawHeader: any): { home: number | null; away: number | null } => {
  const competition = toArray(rawHeader?.competitions)[0] || {};
  const competitors = toArray(competition?.competitors);
  const homeComp = competitors.find((c: any) => normKey(c?.homeAway) === "home") || competitors[0];
  const awayComp = competitors.find((c: any) => normKey(c?.homeAway) === "away") || competitors[1];

  const homeFirst = parseNum(toArray(homeComp?.linescores)[0]?.value ?? toArray(homeComp?.linescores)[0]?.displayValue);
  const awayFirst = parseNum(toArray(awayComp?.linescores)[0]?.value ?? toArray(awayComp?.linescores)[0]?.displayValue);
  return { home: homeFirst, away: awayFirst };
};

const summarizePitchingFromPostgames = (team: string, rows: any[]): string | null => {
  const samples = toArray(rows);
  if (!samples.length) return null;

  let k9Sum = 0; let k9N = 0;
  let kbbSum = 0; let kbbN = 0;
  let oopsSum = 0; let oopsN = 0;
  let blownSaves = 0;
  let inheritedScored = 0;

  for (const row of samples) {
    const isHome = normKey(row.home_team) === normKey(team);
    const stats = readJson(isHome ? row.home_pitching_stats : row.away_pitching_stats) || {};
    const k9 = parseNum(stats["K/9"]);
    const kbb = parseNum(stats["K/BB"]);
    const oops = parseNum(stats.OOPS);
    const blsv = parseNum(stats.BLSV);
    const irs = parseNum(stats.IRS);
    if (k9 !== null) { k9Sum += k9; k9N += 1; }
    if (kbb !== null) { kbbSum += kbb; kbbN += 1; }
    if (oops !== null) { oopsSum += oops; oopsN += 1; }
    blownSaves += blsv ?? 0;
    inheritedScored += irs ?? 0;
  }

  const k9Avg = k9N ? (k9Sum / k9N).toFixed(1) : "—";
  const kbbAvg = kbbN ? (kbbSum / kbbN).toFixed(2) : "—";
  const oopsAvg = oopsN ? (oopsSum / oopsN).toFixed(3) : "—";
  return `${team} PITCHING (last ${samples.length}): K/9 ${k9Avg}, K/BB ${kbbAvg}, Opp OPS ${oopsAvg}, Blown saves ${blownSaves}, Inherited runners scored ${inheritedScored}`;
};

const summarizeBatterFromPostgames = (team: string, rows: any[]): string | null => {
  const samples = toArray(rows);
  if (!samples.length) return null;

  let isoSum = 0; let isoN = 0;
  let warSum = 0; let warN = 0;
  let bbkSum = 0; let bbkN = 0;
  let xbhSum = 0; let xbhN = 0;

  for (const row of samples) {
    const isHome = normKey(row.home_team) === normKey(team);
    const stats = readJson(isHome ? row.home_batting_stats : row.away_batting_stats) || {};
    const iso = parseNum(stats.ISOP ?? stats.ISO);
    const war = parseNum(stats.WAR);
    const bbk = parseNum(stats["BB/K"]);
    const xbh = parseNum(stats.XBH);
    if (iso !== null) { isoSum += iso; isoN += 1; }
    if (war !== null) { warSum += war; warN += 1; }
    if (bbk !== null) { bbkSum += bbk; bbkN += 1; }
    if (xbh !== null) { xbhSum += xbh; xbhN += 1; }
  }

  if (!isoN && !warN && !bbkN && !xbhN) return null;
  const isoAvg = isoN ? (isoSum / isoN).toFixed(3) : "—";
  const warAvg = warN ? (warSum / warN).toFixed(2) : "—";
  const bbkAvg = bbkN ? (bbkSum / bbkN).toFixed(2) : "—";
  const xbhAvg = xbhN ? (xbhSum / xbhN).toFixed(1) : "—";
  return `${team} BATTING (last ${samples.length}): ISO ${isoAvg}, WAR ${warAvg}, BB/K ${bbkAvg}, XBH ${xbhAvg}`;
};

const compactContext = (sections: string[]): string => {
  const cleaned = sections
    .map((s) => s.trim())
    .filter(Boolean);
  const full = cleaned.join("\n\n");
  if (full.length <= CONTEXT_MAX_CHARS) return full;
  return `${full.slice(0, CONTEXT_MAX_CHARS - 3).trimEnd()}...`;
};

export async function buildDataContext(
  supabase: any,
  matchId: string,
  homeTeam: string,
  awayTeam: string,
  leagueId: string,
  sport: string,
  espnEventId?: string
): Promise<string> {
  const bundle = await buildDataContextBundle(supabase, matchId, homeTeam, awayTeam, leagueId, sport, espnEventId);
  return bundle.context;
}

export async function buildDataContextBundle(
  supabase: any,
  matchId: string,
  homeTeam: string,
  awayTeam: string,
  leagueId: string,
  sport: string,
  espnEventId?: string
): Promise<DataContextBundle> {
  const summary = DEFAULT_SUMMARY();
  const sections: string[] = [];
  const leagueKeys = leagueCandidates(leagueId);
  const sportKey = normKey(sport);
  const eventId = normalize(espnEventId || matchId.split("_")[0]);
  const todayDate = new Date().toISOString().slice(0, 10);

  const matchMetaPromise = queryRows<any>(
    "match_meta",
    supabase
      .from("matches")
      .select("id,start_time,referee,league_id")
      .eq("id", matchId)
      .maybeSingle(),
  );

  const leagueFinalsPromise = queryRows<FinalMatchRow[]>(
    "league_finals",
    supabase
      .from("matches")
      .select("id,home_team,away_team,home_score,away_score,start_time,league_id,status")
      .in("league_id", leagueKeys)
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .order("start_time", { ascending: false })
      .limit(450),
  );

  const [ouRows, atsRows, lineRows, matchMeta, leagueFinalRows] = await Promise.all([
    queryRows<any[]>(
      "ou_trends",
      supabase
        .from("mv_team_ou_vs_line")
        .select("team_name,league_id,games_with_line,over_rate,under_rate,avg_posted_total,avg_actual_total,avg_total_delta")
        .in("team_name", [homeTeam, awayTeam])
        .in("league_id", leagueKeys),
    ),
    queryRows<any[]>(
      "ats_trends",
      supabase
        .from("mv_team_ats_vs_line")
        .select("team_name,league_id,fav_games,fav_covers,fav_cover_rate,dog_games,dog_covers,dog_cover_rate")
        .in("team_name", [homeTeam, awayTeam])
        .in("league_id", leagueKeys),
    ),
    queryRows<any[]>(
      "line_movement",
      supabase
        .from("v_pickcenter_lines")
        .select("espn_event_id,open_total,close_total,total_movement,open_home_spread,close_home_spread,spread_movement,snapshot_at")
        .eq("espn_event_id", eventId)
        .order("snapshot_at", { ascending: false })
        .limit(1),
    ),
    matchMetaPromise,
    leagueFinalsPromise,
  ]);

  const picksDate = toIsoDate((matchMeta as any)?.start_time) || todayDate;
  const pickRows = await queryRows<any[]>(
    "daily_picks",
    supabase
      .rpc("get_daily_picks", { p_date: picksDate }),
  );

  const ouByTeam = new Map<string, any>();
  for (const row of toArray(ouRows)) {
    ouByTeam.set(`${normKey(row.team_name)}|${canonicalLeagueId(row.league_id || leagueId)}`, row);
  }
  const homeOu = ouByTeam.get(`${normKey(homeTeam)}|${canonicalLeagueId(leagueId)}`);
  const awayOu = ouByTeam.get(`${normKey(awayTeam)}|${canonicalLeagueId(leagueId)}`);
  if (homeOu || awayOu) {
    const lines: string[] = [];
    if (homeOu) {
      lines.push(`HOME O/U TREND: ${fmtPct(homeOu.over_rate)} over, ${fmtPct(homeOu.under_rate)} under in last ${homeOu.games_with_line} games vs line`);
      lines.push(`  Avg posted total: ${fmtNum(homeOu.avg_posted_total, 1)}, Avg actual: ${fmtNum(homeOu.avg_actual_total, 1)}, Delta: ${fmtSigned(homeOu.avg_total_delta, 1)}`);
    }
    if (awayOu) {
      lines.push(`AWAY O/U TREND: ${fmtPct(awayOu.over_rate)} over, ${fmtPct(awayOu.under_rate)} under in last ${awayOu.games_with_line} games vs line`);
      lines.push(`  Avg posted total: ${fmtNum(awayOu.avg_posted_total, 1)}, Avg actual: ${fmtNum(awayOu.avg_actual_total, 1)}, Delta: ${fmtSigned(awayOu.avg_total_delta, 1)}`);
    }
    sections.push(`TEAM TOTALS VS LINE\n${lines.join("\n")}`);
    summary.has_ou_trends = true;
  }

  const atsByTeam = new Map<string, any>();
  for (const row of toArray(atsRows)) {
    atsByTeam.set(`${normKey(row.team_name)}|${canonicalLeagueId(row.league_id || leagueId)}`, row);
  }
  const homeAts = atsByTeam.get(`${normKey(homeTeam)}|${canonicalLeagueId(leagueId)}`);
  const awayAts = atsByTeam.get(`${normKey(awayTeam)}|${canonicalLeagueId(leagueId)}`);
  if (homeAts || awayAts) {
    const lines: string[] = [];
    if (homeAts) {
      lines.push(`HOME ATS: As favorite ${homeAts.fav_covers}/${homeAts.fav_games} (${fmtPct(homeAts.fav_cover_rate)}), as dog ${homeAts.dog_covers}/${homeAts.dog_games} (${fmtPct(homeAts.dog_cover_rate)})`);
    }
    if (awayAts) {
      lines.push(`AWAY ATS: As favorite ${awayAts.fav_covers}/${awayAts.fav_games} (${fmtPct(awayAts.fav_cover_rate)}), as dog ${awayAts.dog_covers}/${awayAts.dog_games} (${fmtPct(awayAts.dog_cover_rate)})`);
    }
    sections.push(`TEAM ATS VS LINE\n${lines.join("\n")}`);
    summary.has_ats_trends = true;
  }

  const mlHome = buildMlRecord(homeTeam, toArray(leagueFinalRows));
  const mlAway = buildMlRecord(awayTeam, toArray(leagueFinalRows));
  if (mlHome || mlAway) {
    const lines: string[] = [];
    if (mlHome) lines.push(`HOME ML STREAK: ${mlHome.wins}-${mlHome.losses} last ${mlHome.sample} (${mlHome.pct.toFixed(1)}%)`);
    if (mlAway) lines.push(`AWAY ML STREAK: ${mlAway.wins}-${mlAway.losses} last ${mlAway.sample} (${mlAway.pct.toFixed(1)}%)`);
    sections.push(`MONEYLINE FORM\n${lines.join("\n")}`);
    summary.has_ml_streaks = true;
  }

  const line = toArray(lineRows)[0];
  if (line) {
    sections.push(
      `LINE MOVEMENT\n` +
      `Total opened ${fmtNum(line.open_total, 1)}, closed ${fmtNum(line.close_total, 1)} (${fmtSigned(line.total_movement, 1)})\n` +
      `Spread opened ${fmtNum(line.open_home_spread, 1)}, closed ${fmtNum(line.close_home_spread, 1)} (${fmtSigned(line.spread_movement, 1)})`,
    );
    summary.has_line_movement = true;
  }

  const dailyPicksForGame = toArray(pickRows).filter((r: any) =>
    normKey(r.match_id) === normKey(matchId) ||
    (normKey(r.home_team) === normKey(homeTeam) && normKey(r.away_team) === normKey(awayTeam)) ||
    (normKey(r.home_team) === normKey(awayTeam) && normKey(r.away_team) === normKey(homeTeam))
  );
  if (dailyPicksForGame.length) {
    const pickLines = dailyPicksForGame.slice(0, 4).map((r: any) => {
      const homeRate = fmtPct(r.home_rate);
      const awayRate = fmtPct(r.away_rate);
      return `- ${r.play} — Home ${homeRate} (${r.home_sample ?? "—"}), Away ${awayRate} (${r.away_sample ?? "—"}), type ${r.pick_type}`;
    });
    sections.push(`DRIP PICKS FOR THIS GAME\n${pickLines.join("\n")}`);
  }

  const h2hRows = toArray(leagueFinalRows)
    .filter((r) => {
      const h = normKey(r.home_team);
      const a = normKey(r.away_team);
      const hk = normKey(homeTeam);
      const ak = normKey(awayTeam);
      return (h === hk && a === ak) || (h === ak && a === hk);
    })
    .slice(0, 5);
  if (h2hRows.length) {
    let homeWins = 0;
    let awayWins = 0;
    const details: string[] = [];
    for (const row of h2hRows) {
      const hs = parseNum(row.home_score);
      const as = parseNum(row.away_score);
      if (hs !== null && as !== null) {
        const homeIsInputHome = normKey(row.home_team) === normKey(homeTeam);
        const inputHomeScore = homeIsInputHome ? hs : as;
        const inputAwayScore = homeIsInputHome ? as : hs;
        if (inputHomeScore > inputAwayScore) homeWins += 1;
        else if (inputHomeScore < inputAwayScore) awayWins += 1;
      }
      const d = toIsoDate(row.start_time || "");
      details.push(`${d}: ${normalize(row.home_team)} ${row.home_score}-${row.away_score} ${normalize(row.away_team)}`);
    }
    sections.push(`H2H LAST 5: ${homeTeam} ${homeWins}-${awayWins}\n${details.join(", ")}`);
    summary.has_h2h = true;
  }

  // MLB sections
  if (isMlb(sportKey, leagueId)) {
    const [snapshotRows, homePostHome, homePostAway, awayPostHome, awayPostAway, mlbSnapshots, propRows] = await Promise.all([
      queryRows<any[]>(
        "mlb_summary_snapshot",
        supabase
          .from("espn_summary_snapshots")
          .select("raw_header,snapshot_at,espn_event_id,home_team,away_team")
          .eq("espn_event_id", eventId)
          .order("snapshot_at", { ascending: false })
          .limit(2),
      ),
      queryRows<any[]>(
        "mlb_post_home_home",
        supabase
          .from("mlb_postgame")
          .select("start_time,home_team,away_team,home_pitching_stats,away_pitching_stats,home_batting_stats,away_batting_stats")
          .eq("home_team", homeTeam)
          .order("start_time", { ascending: false })
          .limit(6),
      ),
      queryRows<any[]>(
        "mlb_post_home_away",
        supabase
          .from("mlb_postgame")
          .select("start_time,home_team,away_team,home_pitching_stats,away_pitching_stats,home_batting_stats,away_batting_stats")
          .eq("away_team", homeTeam)
          .order("start_time", { ascending: false })
          .limit(6),
      ),
      queryRows<any[]>(
        "mlb_post_away_home",
        supabase
          .from("mlb_postgame")
          .select("start_time,home_team,away_team,home_pitching_stats,away_pitching_stats,home_batting_stats,away_batting_stats")
          .eq("home_team", awayTeam)
          .order("start_time", { ascending: false })
          .limit(6),
      ),
      queryRows<any[]>(
        "mlb_post_away_away",
        supabase
          .from("mlb_postgame")
          .select("start_time,home_team,away_team,home_pitching_stats,away_pitching_stats,home_batting_stats,away_batting_stats")
          .eq("away_team", awayTeam)
          .order("start_time", { ascending: false })
          .limit(6),
      ),
      queryRows<any[]>(
        "mlb_nrfi_snapshots",
        supabase
          .from("espn_summary_snapshots")
          .select("espn_event_id,home_team,away_team,raw_header,snapshot_at,league_id")
          .ilike("league_id", "%mlb%")
          .order("snapshot_at", { ascending: false })
          .limit(260),
      ),
      queryRows<any[]>(
        "mlb_props",
        supabase
          .from("player_prop_bets")
          .select("player_name,bet_type,l5_hit_rate,l5_values,avg_l5,team,opponent")
          .ilike("match_id", `%${eventId}%`)
          .order("l5_hit_rate", { ascending: false })
          .limit(5),
      ),
    ]);

    const snapshot = toArray(snapshotRows)[0];
    const header = readJson(snapshot?.raw_header);
    const competitors = toArray(header?.competitions?.[0]?.competitors);
    const homeComp = competitors.find((c: any) => normKey(c?.homeAway) === "home") || competitors[0];
    const awayComp = competitors.find((c: any) => normKey(c?.homeAway) === "away") || competitors[1];
    const homeProbable = parsePitcherFromProbable(extractProbable(homeComp));
    const awayProbable = parsePitcherFromProbable(extractProbable(awayComp));

    let homeLogsSummary = "Last 5 starts: N/A";
    let awayLogsSummary = "Last 5 starts: N/A";
    if (homeProbable?.id || awayProbable?.id) {
      const [homeLogs, awayLogs] = await Promise.all([
        homeProbable?.id
          ? queryRows<any[]>(
            "home_pitcher_logs",
            supabase
              .from("espn_game_logs")
              .select("game_date,opponent_name,result,stats")
              .eq("espn_athlete_id", homeProbable.id)
              .ilike("league_id", "%mlb%")
              .order("game_date", { ascending: false })
              .limit(5),
          )
          : Promise.resolve(null),
        awayProbable?.id
          ? queryRows<any[]>(
            "away_pitcher_logs",
            supabase
              .from("espn_game_logs")
              .select("game_date,opponent_name,result,stats")
              .eq("espn_athlete_id", awayProbable.id)
              .ilike("league_id", "%mlb%")
              .order("game_date", { ascending: false })
              .limit(5),
          )
          : Promise.resolve(null),
      ]);
      homeLogsSummary = computePitcherLogsSummary(toArray(homeLogs));
      awayLogsSummary = computePitcherLogsSummary(toArray(awayLogs));
      if (toArray(homeLogs).length || toArray(awayLogs).length) summary.has_pitcher_game_logs = true;
    }

    if (homeProbable || awayProbable) {
      const lines: string[] = [];
      if (homeProbable) {
        lines.push(`HOME: ${homeProbable.name}${homeProbable.throwsHand ? ` (${homeProbable.throwsHand})` : ""} — Spring: ${homeProbable.springSummary}`);
        lines.push(`  ${homeLogsSummary}`);
      }
      if (awayProbable) {
        lines.push(`AWAY: ${awayProbable.name}${awayProbable.throwsHand ? ` (${awayProbable.throwsHand})` : ""} — Spring: ${awayProbable.springSummary}`);
        lines.push(`  ${awayLogsSummary}`);
      }
      sections.push(`STARTING PITCHERS\n${lines.join("\n")}`);
      summary.has_starting_pitchers = true;
    }

    const mergeAndTake = (a: any[], b: any[]) =>
      [...toArray(a), ...toArray(b)]
        .sort((x, y) => new Date(y.start_time || 0).getTime() - new Date(x.start_time || 0).getTime())
        .slice(0, 5);

    const homeTeamRecent = mergeAndTake(toArray(homePostHome), toArray(homePostAway));
    const awayTeamRecent = mergeAndTake(toArray(awayPostHome), toArray(awayPostAway));
    const pitchLines = [
      summarizePitchingFromPostgames(homeTeam, homeTeamRecent),
      summarizePitchingFromPostgames(awayTeam, awayTeamRecent),
      summarizeBatterFromPostgames(homeTeam, homeTeamRecent),
      summarizeBatterFromPostgames(awayTeam, awayTeamRecent),
    ].filter(Boolean) as string[];

    if (pitchLines.length) {
      sections.push(`MLB TEAM TENDENCIES\n${pitchLines.join("\n")}`);
      summary.has_team_pitching_stats = true;
    }

    const latestByEvent = new Map<string, any>();
    for (const row of toArray(mlbSnapshots)) {
      const id = normalize(row.espn_event_id);
      if (!id || latestByEvent.has(id)) continue;
      latestByEvent.set(id, row);
    }

    const computeNrfiRate = (team: string): string | null => {
      const events = Array.from(latestByEvent.values())
        .filter((row) => normKey(row.home_team) === normKey(team) || normKey(row.away_team) === normKey(team))
        .slice(0, 11);
      if (!events.length) return null;

      let scoreless = 0;
      let n = 0;
      for (const e of events) {
        const headerObj = readJson(e.raw_header);
        const inning = parseLinescoreFirstInning(headerObj);
        if (inning.home === null || inning.away === null) continue;
        n += 1;
        if (inning.home === 0 && inning.away === 0) scoreless += 1;
      }
      if (!n) return null;
      const rate = ((scoreless / n) * 100).toFixed(1);
      return `${team} NRFI RATE: ${rate}% (${scoreless}/${n} games scoreless in 1st inning)`;
    };

    const nrfiLines = [computeNrfiRate(homeTeam), computeNrfiRate(awayTeam)].filter(Boolean) as string[];
    if (nrfiLines.length) {
      sections.push(`NRFI SIGNALS\n${nrfiLines.join("\n")}`);
    }

    const propLines = toArray(propRows)
      .map((r) => {
        const rate = parseNum(r.l5_hit_rate);
        if (rate === null) return null;
        const values = toArray(r.l5_values).slice(0, 5).map((v) => fmtNum(v, 1)).join(", ");
        return `${normalize(r.player_name)} ${normalize(r.bet_type)}: ${fmtPct(rate)} L5 hit, avg L5 ${fmtNum(r.avg_l5, 1)}${values ? ` [${values}]` : ""}`;
      })
      .filter(Boolean) as string[];
    if (propLines.length) {
      sections.push(`PLAYER PROP FORM\n${propLines.join("\n")}`);
    }
  }

  // Soccer-specific depth and referee
  if (isSoccer(sportKey, leagueId)) {
    const teamRecentIds = (teamName: string): string[] => {
      return toArray(leagueFinalRows)
        .filter((m) => normKey(m.home_team) === normKey(teamName) || normKey(m.away_team) === normKey(teamName))
        .slice(0, 10)
        .map((m) => normalize(m.id))
        .filter(Boolean);
    };

    const homeIds = teamRecentIds(homeTeam);
    const awayIds = teamRecentIds(awayTeam);
    const [homeSoccerRows, awaySoccerRows, refRow] = await Promise.all([
      homeIds.length
        ? queryRows<any[]>(
          "soccer_depth_home",
          supabase
            .from("soccer_postgame")
            .select("match_id,btts_1h,home_corners,away_corners,home_yellow_cards,away_yellow_cards,late_goals,first_goal_minute")
            .in("match_id", homeIds),
        )
        : Promise.resolve(null),
      awayIds.length
        ? queryRows<any[]>(
          "soccer_depth_away",
          supabase
            .from("soccer_postgame")
            .select("match_id,btts_1h,home_corners,away_corners,home_yellow_cards,away_yellow_cards,late_goals,first_goal_minute")
            .in("match_id", awayIds),
        )
        : Promise.resolve(null),
      queryRows<any[]>(
        "soccer_ref",
        supabase
          .from("soccer_postgame")
          .select("referee")
          .eq("match_id", matchId)
          .limit(1),
      ),
    ]);

    const summarizeSoccerDepth = (label: string, rows: any[]): string | null => {
      const samples = toArray(rows);
      if (!samples.length) return null;
      const n = samples.length;
      const btts1h = samples.filter((r) => r.btts_1h === true).length;
      const lateGoals = samples.filter((r) => r.late_goals === true).length;
      const corners = samples.reduce((acc, r) => acc + (parseNum(r.home_corners) ?? 0) + (parseNum(r.away_corners) ?? 0), 0) / n;
      const cards = samples.reduce((acc, r) => acc + (parseNum(r.home_yellow_cards) ?? 0) + (parseNum(r.away_yellow_cards) ?? 0), 0) / n;
      const goalMins = samples.map((r) => parseNum(r.first_goal_minute)).filter((v) => v !== null) as number[];
      const avgFirstGoal = goalMins.length ? (goalMins.reduce((a, b) => a + b, 0) / goalMins.length) : null;
      return (
        `${label} SOCCER DEPTH (last ${n}):\n` +
        `  1H BTTS ${((btts1h / n) * 100).toFixed(1)}%, Avg corners ${corners.toFixed(1)}, Avg cards ${cards.toFixed(1)}\n` +
        `  Late goals (75+) ${((lateGoals / n) * 100).toFixed(1)}%, Avg first goal minute ${avgFirstGoal !== null ? avgFirstGoal.toFixed(0) : "—"}`
      );
    };

    const depthLines = [
      summarizeSoccerDepth("HOME", toArray(homeSoccerRows)),
      summarizeSoccerDepth("AWAY", toArray(awaySoccerRows)),
    ].filter(Boolean) as string[];
    if (depthLines.length) {
      sections.push(`SOCCER POSTGAME DEPTH\n${depthLines.join("\n")}`);
      summary.has_soccer_depth = true;
    }

    const refereeName = normalize(toArray(refRow)[0]?.referee) || normalize((matchMeta as any)?.referee);
    if (refereeName) {
      const refSignalRows = await queryRows<any[]>(
        "ref_signal",
        supabase
          .from("mv_referee_edge_signals")
          .select("referee,league_id,matches,under_rate,avg_yellows,avg_fouls")
          .eq("referee", refereeName)
          .in("league_id", leagueKeys)
          .order("matches", { ascending: false })
          .limit(1),
      );
      const refSignal = toArray(refSignalRows)[0];
      if (refSignal) {
        sections.push(
          `REFEREE SIGNAL\n` +
          `REFEREE: ${normalize(refSignal.referee)} — Under rate ${fmtPct(refSignal.under_rate)} (${refSignal.matches} matches), Avg cards ${fmtNum(refSignal.avg_yellows, 1)}, Avg fouls ${fmtNum(refSignal.avg_fouls, 1)}`
        );
        summary.has_referee_signals = true;
      }
    }
  }

  const context = compactContext(sections);
  summary.context_length = context.length;
  summary.sections_count = sections.length;
  return { context, summary };
}
