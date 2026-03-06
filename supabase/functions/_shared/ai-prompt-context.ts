// deno-lint-ignore-file no-explicit-any

type PromptContextInput = {
  matchId?: string | null;
  leagueId?: string | null;
  sport?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
};

type LeagueProfile = {
  league_id: string;
  matches_played: number;
  avg_total_goals: number | null;
  avg_home_goals: number | null;
  avg_away_goals: number | null;
  over_25_pct: number | null;
  over_35_pct: number | null;
  btts_pct: number | null;
  home_win_pct: number | null;
  draw_pct: number | null;
  away_win_pct: number | null;
  avg_home_margin: number | null;
  clean_sheet_pct: number | null;
};

type TeamRollingForm = {
  team_name: string;
  league_id: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goals_scored: number;
  goals_conceded: number;
  avg_goals_scored: number | null;
  avg_goals_conceded: number | null;
  avg_total_goals: number | null;
  btts_count: number;
  over_25_count: number;
  clean_sheets_kept: number;
  form_string: string | null;
  last_match_date: string | null;
};

type H2HSummary = {
  team_a: string;
  team_b: string;
  league_id: string;
  meetings: number;
  team_a_wins: number;
  draws: number;
  team_b_wins: number;
  avg_total_goals: number | null;
  btts_count: number;
  last_meeting_date: string | null;
  last_score: string | null;
};

type TeamTempo = {
  team: string;
  pace?: number | null;
  ortg?: number | null;
  drtg?: number | null;
  net_rtg?: number | null;
  rank?: number | null;
};

type MatchContextRow = {
  weather_info?: Record<string, unknown> | null;
  weather_forecast?: Record<string, unknown> | null;
  current_odds?: Record<string, unknown> | null;
};

type LiveStateRow = {
  advanced_metrics?: Record<string, unknown> | null;
  deterministic_signals?: Record<string, unknown> | null;
  stats?: unknown;
};

type PregameExpectations = {
  expected_pace?: number | null;
  expected_efficiency?: number | null;
  expected_total?: number | null;
  home_off_rating?: number | null;
  away_off_rating?: number | null;
  home_def_rating?: number | null;
  away_def_rating?: number | null;
};

export type AIPromptContextBundle = {
  leagueProfile: LeagueProfile | null;
  homeForm: TeamRollingForm | null;
  awayForm: TeamRollingForm | null;
  h2h: H2HSummary | null;
  teamTempo: TeamTempo[];
  pregameExpectations: PregameExpectations | null;
  matchContext: MatchContextRow | null;
  liveState: LiveStateRow | null;
  tags: string[];
  notes: string[];
  sportKey: string;
  leagueKey: string;
};

const normalizeText = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9+.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatPct = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Number(value).toFixed(1)}%`;
};

const formatNum = (value: number | null | undefined, digits = 2): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Number(value).toFixed(digits);
};

const containsAny = (value: string, keywords: string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword));

const buildLeagueCandidates = (leagueId: string): string[] => {
  const key = leagueId.toLowerCase();
  const out = new Set<string>([key]);

  if (containsAny(key, ["ncaab", "mens-college-basketball", "basketball_ncaab"])) {
    out.add("ncaab");
    out.add("mens-college-basketball");
    out.add("basketball_ncaab");
  }

  if (containsAny(key, ["epl", "eng.1", "soccer_epl"])) {
    out.add("epl");
    out.add("eng.1");
    out.add("soccer_epl");
  }

  if (containsAny(key, ["mlb", "baseball_mlb"])) {
    out.add("mlb");
    out.add("baseball_mlb");
  }

  return Array.from(out);
};

const inferSport = (sport?: string | null, leagueId?: string | null): string => {
  const s = normalizeText(sport).toLowerCase();
  if (s) return s;
  const l = normalizeText(leagueId).toLowerCase();
  if (containsAny(l, ["soccer", "epl", "eng.1", "laliga", "seriea", "bundesliga", "ligue", "uefa", "fifa", "world-cup"])) return "soccer";
  if (containsAny(l, ["ncaab", "mens-college-basketball", "basketball_ncaab", "college-basketball"])) return "ncaab";
  if (containsAny(l, ["mlb", "baseball_mlb", "baseball"])) return "mlb";
  if (containsAny(l, ["nba", "basketball_nba"])) return "nba";
  return l || "unknown";
};

const canonicalPair = (homeTeam: string, awayTeam: string): { teamA: string; teamB: string } => {
  const home = normalizeText(homeTeam);
  const away = normalizeText(awayTeam);
  return home.toLowerCase() <= away.toLowerCase()
    ? { teamA: home, teamB: away }
    : { teamA: away, teamB: home };
};

const getMarchMadnessTag = (): string | null => {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  if (month !== 3 && month !== 4) return null;
  return "MARCH_MADNESS_WINDOW";
};

const getWorldCupTag = (leagueKey: string): string | null => {
  if (containsAny(leagueKey, ["world", "fifa", "wc", "world-cup"])) return "WORLD_CUP_CONTEXT";
  return null;
};

const extractBullpenSignal = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") return null;

  const stack: Array<{ node: any; depth: number }> = [{ node: payload, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.depth > 4) continue;
    const node = current.node;

    if (node && typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>);
      for (const [key, value] of entries) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes("bullpen")) {
          if (typeof value === "string") return value;
          if (typeof value === "number") return `Bullpen metric ${value}`;
          if (value && typeof value === "object") {
            const signal = normalizeText((value as Record<string, unknown>).signal);
            const detail = normalizeText((value as Record<string, unknown>).detail);
            const val = normalizeText((value as Record<string, unknown>).value);
            return [signal, detail, val].filter(Boolean).join(" · ") || "Bullpen pressure signal active";
          }
          return "Bullpen pressure signal active";
        }

        if (value && typeof value === "object") {
          stack.push({ node: value, depth: current.depth + 1 });
        }
      }
    }
  }

  return null;
};

const extractWindSummary = (matchContext: MatchContextRow | null): string | null => {
  const weather = (matchContext?.weather_info || matchContext?.weather_forecast || {}) as Record<string, unknown>;
  if (!weather || typeof weather !== "object") return null;

  const wind = normalizeText(weather.wind) || normalizeText(weather.wind_speed);
  const condition = normalizeText(weather.condition);
  const temp = normalizeText(weather.temp) || normalizeText(weather.temperature);

  const parts = [];
  if (wind) parts.push(`wind ${wind}`);
  if (condition) parts.push(condition);
  if (temp) parts.push(`temp ${temp}`);
  if (parts.length === 0) return null;
  return parts.join(" · ");
};

export async function fetchAIPromptContextBundle(
  supabase: any,
  input: PromptContextInput,
): Promise<AIPromptContextBundle> {
  const leagueKey = normalizeText(input.leagueId).toLowerCase();
  const homeTeam = normalizeText(input.homeTeam);
  const awayTeam = normalizeText(input.awayTeam);
  const sportKey = inferSport(input.sport, input.leagueId);
  const leagueCandidates = buildLeagueCandidates(leagueKey || sportKey);

  const notes: string[] = [];
  const tags: string[] = [];

  const worldCupTag = getWorldCupTag(leagueKey);
  if (worldCupTag) tags.push(worldCupTag);

  if (containsAny(sportKey, ["ncaab", "college"]) || containsAny(leagueKey, ["ncaab", "college"])) {
    const marchTag = getMarchMadnessTag();
    if (marchTag) tags.push(marchTag);
  }

  const { teamA, teamB } = canonicalPair(homeTeam, awayTeam);

  const [
    leagueProfileRes,
    homeFormRes,
    awayFormRes,
    h2hRes,
    tempoRes,
    pregameRes,
    matchRes,
    liveStateRes,
  ] = await Promise.all([
    leagueCandidates.length > 0
      ? supabase
          .from("mv_league_structural_profiles")
          .select("*")
          .in("league_id", leagueCandidates)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    homeTeam && leagueCandidates.length > 0
      ? supabase
          .from("mv_team_rolling_form")
          .select("*")
          .in("league_id", leagueCandidates)
          .eq("team_name", homeTeam)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    awayTeam && leagueCandidates.length > 0
      ? supabase
          .from("mv_team_rolling_form")
          .select("*")
          .in("league_id", leagueCandidates)
          .eq("team_name", awayTeam)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    teamA && teamB && leagueCandidates.length > 0
      ? supabase
          .from("mv_h2h_summary")
          .select("*")
          .in("league_id", leagueCandidates)
          .eq("team_a", teamA)
          .eq("team_b", teamB)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    homeTeam || awayTeam
      ? supabase
          .from("team_tempo")
          .select("team, pace, ortg, drtg, net_rtg, rank")
          .in("team", [homeTeam, awayTeam].filter(Boolean))
      : Promise.resolve({ data: [], error: null }),
    input.matchId
      ? supabase
          .from("pregame_expectations")
          .select("expected_pace, expected_efficiency, expected_total, home_off_rating, away_off_rating, home_def_rating, away_def_rating")
          .eq("match_id", input.matchId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    input.matchId
      ? supabase
          .from("matches")
          .select("weather_info, weather_forecast, current_odds")
          .eq("id", input.matchId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    input.matchId
      ? supabase
          .from("live_game_state")
          .select("advanced_metrics, deterministic_signals, stats")
          .eq("id", input.matchId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const leagueProfile = (leagueProfileRes?.data || null) as LeagueProfile | null;
  const homeForm = (homeFormRes?.data || null) as TeamRollingForm | null;
  const awayForm = (awayFormRes?.data || null) as TeamRollingForm | null;
  const h2h = (h2hRes?.data || null) as H2HSummary | null;
  const teamTempo = ((tempoRes?.data || []) as TeamTempo[]).slice(0, 4);
  const pregameExpectations = (pregameRes?.data || null) as PregameExpectations | null;
  const matchContext = (matchRes?.data || null) as MatchContextRow | null;
  const liveState = (liveStateRes?.data || null) as LiveStateRow | null;

  if (!leagueProfile) notes.push("league_profile_missing");
  if (!homeForm || !awayForm) notes.push("rolling_form_partial");
  if (!h2h) notes.push("h2h_missing");

  if (containsAny(sportKey, ["soccer"])) {
    if (leagueProfile?.draw_pct !== null && leagueProfile?.draw_pct !== undefined) {
      notes.push(`soccer_draw_baseline_${Number(leagueProfile.draw_pct).toFixed(1)}pct`);
    }
    if (leagueProfile?.btts_pct !== null && leagueProfile?.btts_pct !== undefined) {
      notes.push(`soccer_btts_${Number(leagueProfile.btts_pct).toFixed(1)}pct`);
    }
  }

  if (containsAny(sportKey, ["ncaab", "college"])) {
    if (pregameExpectations?.expected_total !== undefined && pregameExpectations?.expected_total !== null) {
      notes.push(`ncaab_expected_total_${Number(pregameExpectations.expected_total).toFixed(1)}`);
    }
    if (teamTempo.length > 0) {
      notes.push("ncaab_tempo_context_loaded");
    }
  }

  if (containsAny(sportKey, ["mlb", "baseball"])) {
    const windSummary = extractWindSummary(matchContext);
    if (windSummary) notes.push(`mlb_weather_${windSummary}`);
    const bullpenSignal = extractBullpenSignal(liveState?.advanced_metrics ?? liveState?.deterministic_signals);
    if (bullpenSignal) notes.push(`mlb_bullpen_${bullpenSignal}`);
  }

  return {
    leagueProfile,
    homeForm,
    awayForm,
    h2h,
    teamTempo,
    pregameExpectations,
    matchContext,
    liveState,
    tags,
    notes,
    sportKey,
    leagueKey,
  };
}

export function renderAIPromptContextBlock(bundle: AIPromptContextBundle): string {
  const lines: string[] = [];
  lines.push("STRUCTURAL CONTEXT [DB DERIVED]:");

  if (bundle.tags.length > 0) {
    lines.push(`- Tags: ${bundle.tags.join(" | ")}`);
  }

  if (bundle.leagueProfile) {
    const profile = bundle.leagueProfile;
    lines.push(
      `- League profile (${profile.league_id}): n=${profile.matches_played}, avg_total=${formatNum(profile.avg_total_goals, 2)}, BTTS=${formatPct(profile.btts_pct)}, home/draw/away=${formatPct(profile.home_win_pct)}/${formatPct(profile.draw_pct)}/${formatPct(profile.away_win_pct)}`
    );
  } else {
    lines.push("- League profile: unavailable");
  }

  const formLine = (side: "Home" | "Away", form: TeamRollingForm | null): string => {
    if (!form) return `- ${side} form: unavailable`;
    return `- ${side} form (${form.team_name}): L${form.matches} ${form.wins}-${form.draws}-${form.losses}, GF/GA=${formatNum(form.avg_goals_scored, 2)}/${formatNum(form.avg_goals_conceded, 2)}, O2.5=${form.over_25_count}/${form.matches}, BTTS=${form.btts_count}/${form.matches}, form=${form.form_string || "—"}`;
  };

  lines.push(formLine("Home", bundle.homeForm));
  lines.push(formLine("Away", bundle.awayForm));

  if (bundle.h2h) {
    const h = bundle.h2h;
    lines.push(`- H2H (${h.team_a} vs ${h.team_b}): meetings=${h.meetings}, ${h.team_a}W=${h.team_a_wins}, D=${h.draws}, ${h.team_b}W=${h.team_b_wins}, avg_total=${formatNum(h.avg_total_goals, 2)}, last=${h.last_score || "—"}`);
  } else {
    lines.push("- H2H: unavailable");
  }

  if (bundle.pregameExpectations) {
    const e = bundle.pregameExpectations;
    lines.push(`- Baseline model: expected_total=${formatNum(e.expected_total, 1)}, expected_pace=${formatNum(e.expected_pace, 3)}, expected_eff=${formatNum(e.expected_efficiency, 3)}`);
  }

  if (bundle.teamTempo.length > 0) {
    const tempo = bundle.teamTempo
      .map((t) => `${t.team}(pace=${formatNum(t.pace, 2)}, net=${formatNum(t.net_rtg, 1)})`)
      .join(" | ");
    lines.push(`- Tempo/rating context: ${tempo}`);
  }

  if (containsAny(bundle.sportKey, ["mlb", "baseball"])) {
    const wind = extractWindSummary(bundle.matchContext);
    if (wind) lines.push(`- MLB weather: ${wind}`);
    const bullpen = extractBullpenSignal(bundle.liveState?.advanced_metrics ?? bundle.liveState?.deterministic_signals);
    if (bullpen) lines.push(`- MLB bullpen signal: ${bullpen}`);
  }

  if (containsAny(bundle.sportKey, ["soccer"])) {
    if (bundle.tags.includes("WORLD_CUP_CONTEXT")) {
      lines.push("- Soccer tournament mode: World Cup context active (variance + pressure elevated).");
    }
    if (bundle.leagueProfile?.clean_sheet_pct !== null && bundle.leagueProfile?.clean_sheet_pct !== undefined) {
      lines.push(`- Soccer defensive texture: clean-sheet rate ${formatPct(bundle.leagueProfile.clean_sheet_pct)}.`);
    }
  }

  if (containsAny(bundle.sportKey, ["ncaab", "college"])) {
    if (bundle.tags.includes("MARCH_MADNESS_WINDOW")) {
      lines.push("- NCAAB tournament mode: March window active (rotation tightening + volatility spikes).");
    }
  }

  if (bundle.notes.length > 0) {
    lines.push(`- Context diagnostics: ${bundle.notes.join(" | ")}`);
  }

  return lines.join("\n");
}
