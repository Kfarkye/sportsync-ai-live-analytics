import { getCanonicalMatchId, toLocalGameDate } from "./match-registry.ts";

// -------------------------------------------------------------------------
// LEAGUE & SPORT DEFINITIONS (Preserve detectSportFromLeague)
// -------------------------------------------------------------------------
const SOCCER_LEAGUES = [
  "ita.1",
  "seriea",
  "eng.1",
  "epl",
  "ger.1",
  "bundesliga",
  "esp.1",
  "laliga",
  "fra.1",
  "ligue1",
  "usa.1",
  "mls",
  "mex.1",
  "liga_mx",
  "bra.1",
  "arg.1",
  "por.1",
  "ned.1",
  "bel.1",
  "tur.1",
  "sco.1",
  "uefa.champions",
  "ucl",
  "uefa.europa",
  "uel",
  "uefa.conference",
  "caf.nations",
  "copa",
  "conmebol",
  "concacaf",
  "afc",
  "soccer",
];
const FOOTBALL_LEAGUES = ["nfl", "college-football", "ncaaf"];
const HOCKEY_LEAGUES = ["nhl"];
const BASEBALL_LEAGUES = ["mlb"];
const BASKETBALL_LEAGUES = [
  "nba",
  "wnba",
  "mens-college-basketball",
  "ncaab",
  "ncaam",
  "womens-college-basketball",
];
const TENNIS_LEAGUES = ["atp", "wta", "tennis"];

export const detectSportFromLeague = (league?: string | null): string => {
  if (!league) return "nba";
  const l = league.toLowerCase();
  if (TENNIS_LEAGUES.some((t) => l.includes(t))) return "tennis";
  if (SOCCER_LEAGUES.some((s) => l.includes(s))) return "soccer";
  if (FOOTBALL_LEAGUES.some((f) => l.includes(f))) return "football";
  if (HOCKEY_LEAGUES.some((h) => l.includes(h))) return "hockey";
  if (BASEBALL_LEAGUES.some((b) => l.includes(b))) return "baseball";
  if (BASKETBALL_LEAGUES.some((b) => l.includes(b)))
    return l.includes("college") ? "college_basketball" : "nba";
  return "nba";
};

// -------------------------------------------------------------------------
// TYPES
// -------------------------------------------------------------------------
export type ForensicTeamContext = {
  injury_score: number;
  situation: string;
  rest_days: number;
  notes: string;
  fatigue_score: number;
  ats_pct: number;
  ats_last_10: number;
};

export type MatchDossier = {
  match_id: string;
  game_date: string;
  current_date: string;
  season: string;
  sport: string;
  league_id: string;
  home_team: string;
  away_team: string;
  odds_event_id: string | null;
  forensic: {
    home: ForensicTeamContext;
    away: ForensicTeamContext;
  };
  market_snapshot: {
    spread: number | null;
    total: number | null;
    home_ml: string | number | null;
    away_ml: string | number | null;
    spread_juice: string | number | null;
    total_juice: string | number | null;
  };
  valuation: {
    fair_line: number;
    delta: number;
  };
};

type DossierOverrides = Partial<{
  league: string;
  league_id: string;
  sport: string;
  start_time: string;
  home_team: string;
  away_team: string;
  current_spread: number | null;
  current_total: number | null;
  home_ml: string | number | null;
  away_ml: string | number | null;
  spread_juice: string | number | null;
  total_juice: string | number | null;
  current_odds: Record<string, unknown> | null;
}>;

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const APEX_CONFIG = {
  INJURY_WEIGHT: 0.4,
  MAX_INJURY_SCORE: 10.0,
  FATIGUE_BASE_PENALTY: 2.0,
  APRON_TAX_MULTIPLIER: 1.75,
  ATS_THRESHOLD: 0.6,
  ATS_BONUS_POINTS: 3.0,
  HOME_COURT: 2.6,
};

// -------------------------------------------------------------------------
// MATCH DOSSIER BUILDER (import-safe)
// -------------------------------------------------------------------------
export async function buildMatchDossier(
  matchId: string,
  supabase: any,
  overrides: DossierOverrides = {},
  opts: { season?: string } = {}
): Promise<MatchDossier> {
  const dbId = getCanonicalMatchId(matchId, overrides.league ?? overrides.league_id);

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id, league_id, sport, start_time, home_team, away_team, current_odds, current_spread, current_total, odds_home_spread_safe, odds_total_safe, home_ml, away_ml, spread_juice, total_juice, odds_api_event_id"
    )
    .eq("id", dbId)
    .maybeSingle()
    .then((r: any) => r || { data: null });

  const leagueId = overrides.league ?? overrides.league_id ?? match?.league_id ?? "nba";
  const sport = overrides.sport ?? match?.sport ?? detectSportFromLeague(leagueId);
  const startTime = overrides.start_time ?? match?.start_time;
  const gameDate = startTime ? toLocalGameDate(startTime) : new Date().toISOString().split("T")[0];
  const currentDate = new Date().toISOString().split("T")[0];
  const season = opts.season ?? "2025-26";

  const homeTeam = overrides.home_team ?? match?.home_team ?? "Home";
  const awayTeam = overrides.away_team ?? match?.away_team ?? "Away";

  const odds = (overrides.current_odds ?? match?.current_odds ?? {}) as Record<string, any>;
  const currentSpread =
    overrides.current_spread ??
    match?.current_spread ??
    match?.odds_home_spread_safe ??
    odds?.homeSpread ??
    odds?.spread_home_value ??
    null;
  const currentTotal =
    overrides.current_total ??
    match?.current_total ??
    match?.odds_total_safe ??
    odds?.total ??
    odds?.total_value ??
    null;

  const homeMl = overrides.home_ml ?? match?.home_ml ?? null;
  const awayMl = overrides.away_ml ?? match?.away_ml ?? null;
  const spreadJuice = overrides.spread_juice ?? match?.spread_juice ?? null;
  const totalJuice = overrides.total_juice ?? match?.total_juice ?? null;
  const oddsEventId = match?.odds_api_event_id ?? null;

  const leagueKey = String(leagueId || "nba").toLowerCase();
  const shouldFetchPriors = leagueKey === "nba" && sport === "nba";

  const [homeContext, awayContext, homePriors, awayPriors] = await Promise.all([
    supabase.from("team_game_context").select("*").eq("team", homeTeam).eq("game_date", gameDate).maybeSingle().then((r: any) => r.data),
    supabase.from("team_game_context").select("*").eq("team", awayTeam).eq("game_date", gameDate).maybeSingle().then((r: any) => r.data),
    shouldFetchPriors
      ? supabase.from("nba_team_priors").select("*").eq("team", homeTeam).eq("season", season).single().then((r: any) => r.data)
      : Promise.resolve(null),
    shouldFetchPriors
      ? supabase.from("nba_team_priors").select("*").eq("team", awayTeam).eq("season", season).single().then((r: any) => r.data)
      : Promise.resolve(null),
  ]);

  const forensicHome: ForensicTeamContext = {
    injury_score: homeContext?.injury_impact || 0,
    situation: homeContext?.situation || "Normal",
    rest_days: homeContext?.rest_days ?? 2,
    notes: homeContext?.injury_notes || "None",
    fatigue_score: homeContext?.fatigue_score || 0,
    ats_pct: homeContext?.ats_last_10 || 0.5,
    ats_last_10: homeContext?.ats_last_10 || 0.5,
  };

  const forensicAway: ForensicTeamContext = {
    injury_score: awayContext?.injury_impact || 0,
    situation: awayContext?.situation || "Normal",
    rest_days: awayContext?.rest_days ?? 2,
    notes: awayContext?.injury_notes || "None",
    fatigue_score: awayContext?.fatigue_score || 0,
    ats_pct: awayContext?.ats_last_10 || 0.5,
    ats_last_10: awayContext?.ats_last_10 || 0.5,
  };

  let h_o = 110,
    h_d = 110,
    a_o = 110,
    a_d = 110;
  if (homePriors) {
    h_o = homePriors.o_rating;
    h_d = homePriors.d_rating;
  }
  if (awayPriors) {
    a_o = awayPriors.o_rating;
    a_d = awayPriors.d_rating;
  }

  const calcEff = (o: number, d: number, f: ForensicTeamContext) => {
    let r = o - d;
    r -= f.injury_score * APEX_CONFIG.INJURY_WEIGHT;
    const sit = (f.situation || "").toUpperCase();
    r -=
      (f.fatigue_score > 0 ? f.fatigue_score / 50 : ["B2B", "3IN4"].some((k) => sit.includes(k)) ? 1 : 0) *
      APEX_CONFIG.FATIGUE_BASE_PENALTY;
    if (f.ats_pct >= APEX_CONFIG.ATS_THRESHOLD) r += APEX_CONFIG.ATS_BONUS_POINTS;
    return r;
  };

  const h_eff = calcEff(h_o, h_d, forensicHome);
  const a_eff = calcEff(a_o, a_d, forensicAway);
  const hasModelPriors = shouldFetchPriors && !!homePriors && !!awayPriors;
  const rawFairLine = -1 * ((h_eff - a_eff) + APEX_CONFIG.HOME_COURT);
  const fairLine = hasModelPriors ? rawFairLine : isFiniteNumber(currentSpread) ? currentSpread : 0;
  const delta = isFiniteNumber(currentSpread) && hasModelPriors ? Math.abs(currentSpread - fairLine) : 0;

  return {
    match_id: dbId,
    game_date: gameDate,
    current_date: currentDate,
    season,
    sport,
    league_id: leagueId,
    home_team: homeTeam,
    away_team: awayTeam,
    odds_event_id: oddsEventId,
    forensic: {
      home: forensicHome,
      away: forensicAway,
    },
    market_snapshot: {
      spread: isFiniteNumber(currentSpread) ? currentSpread : null,
      total: isFiniteNumber(currentTotal) ? currentTotal : null,
      home_ml: homeMl,
      away_ml: awayMl,
      spread_juice: spreadJuice,
      total_juice: totalJuice,
    },
    valuation: {
      fair_line: fairLine,
      delta,
    },
  };
}
