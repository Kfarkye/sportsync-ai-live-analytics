import type {
  CanonicalMlbGameObject,
  MarketSnapshot,
  MlbBullpenContext,
  MlbEnvironmentState,
  MlbLineupSide,
  MlbPregameEdge,
  MlbRecentPitch,
  MlbStarterContext,
} from "./types.ts";

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: any; error: { message: string } | null }>;
        limit: (count: number) => Promise<{ data: any[] | null; error: { message: string } | null }>;
        order: (
          column: string,
          opts?: { ascending?: boolean },
        ) => {
          limit: (count: number) => Promise<{ data: any[] | null; error: { message: string } | null }>;
        };
      };
      in?: (column: string, values: string[]) => any;
      order?: (
        column: string,
        opts?: { ascending?: boolean },
      ) => {
        limit: (count: number) => Promise<{ data: any[] | null; error: { message: string } | null }>;
      };
      limit?: (count: number) => Promise<{ data: any[] | null; error: { message: string } | null }>;
    };
  };
};

const ESPN_SUMMARY_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary";

const LIVE_STATUSES = ["STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_DELAYED"];

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[^0-9+.-]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return null;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore invalid json
  }
  return {};
}

function pickFirstNumeric(payloads: unknown[], keys: string[]): number | null {
  for (const payload of payloads) {
    const obj = parseJson(payload);
    for (const key of keys) {
      const parsed = asNumber(obj[key]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function pickFirstString(payloads: unknown[], keys: string[]): string | null {
  for (const payload of payloads) {
    const obj = parseJson(payload);
    for (const key of keys) {
      const parsed = asString(obj[key]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function parseInningHalf(detail: string | null): "top" | "bottom" | null {
  if (!detail) return null;
  const normalized = detail.toLowerCase();
  if (normalized.includes("top")) return "top";
  if (normalized.includes("bottom") || normalized.includes("bot")) return "bottom";
  return null;
}

function runEnvironmentIndex(total: number | null, windMph: number | null, roofState: string | null): number | null {
  if (total === null) return null;
  const base = total / 8.5;
  const windBoost = windMph === null ? 0 : Math.max(-0.25, Math.min(0.35, (windMph - 8) * 0.02));
  const roofBoost =
    roofState?.toLowerCase().includes("open") ? 0.06 : roofState?.toLowerCase().includes("closed") ? -0.04 : 0;
  return Math.round((base + windBoost + roofBoost) * 1000) / 1000;
}

function classifyPitchResult(raw: string): string {
  const text = raw.toLowerCase();
  if (text.includes("hit by pitch")) return "hit_by_pitch";
  if (text.includes("swinging strike") || text.includes("strikes out swinging")) return "swinging_strike";
  if (text.includes("called strike") || text.includes("strikes out looking")) return "called_strike";
  if (text.includes("foul")) return "foul";
  if (text.includes("single") || text.includes("double") || text.includes("triple") || text.includes("home run")) {
    return "hit";
  }
  if (text.includes("walk") || text.includes(" ball")) return "ball";
  if (text.includes("out")) return "in_play_out";
  return "unknown";
}

function parsePitchSequence(plays: any[]): MlbRecentPitch[] {
  return plays
    .slice(-25)
    .map((play: any, idx: number) => {
      const text = asString(play?.text ?? play?.description ?? play?.shortText) ?? "";
      const countObj = parseJson(play?.count);
      const ballsBefore = asNumber(countObj.balls);
      const strikesBefore = asNumber(countObj.strikes);
      return {
        sequence: idx + 1,
        result: classifyPitchResult(text),
        pitch_type: asString(play?.pitch?.type?.text ?? play?.type?.text),
        mph: asNumber(play?.pitch?.speed?.value ?? play?.pitchSpeed),
        is_first_pitch:
          ballsBefore !== null && strikesBefore !== null
            ? ballsBefore === 0 && strikesBefore === 0
            : null,
        text: text || null,
      };
    })
    .filter((pitch) => pitch.result !== "unknown");
}

async function fetchEspnSummary(eventId: string): Promise<any | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(`${ESPN_SUMMARY_BASE}?event=${encodeURIComponent(eventId)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractStarter(summary: any, side: "home" | "away"): MlbStarterContext | null {
  const competition = summary?.header?.competitions?.[0];
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const competitor = competitors.find((entry: any) => entry?.homeAway === side);
  const probable = competitor?.probables?.[0] ?? competitor?.probablePitcher;
  if (!probable) return null;
  return {
    name: asString(probable?.athlete?.displayName ?? probable?.displayName),
    espn_player_id: asString(probable?.athlete?.id ?? probable?.id),
    hand: asString(probable?.athlete?.hand?.abbreviation ?? probable?.throwingHand),
    era: asNumber(probable?.statistics?.era ?? probable?.era),
    whip: asNumber(probable?.statistics?.whip ?? probable?.whip),
    pitch_count: null,
  };
}

function extractCurrentPitcher(summary: any): {
  name: string | null;
  espn_player_id: string | null;
  hand: string | null;
  pitch_count: number | null;
} {
  const situation = summary?.situation ?? {};
  return {
    name: asString(situation?.pitcher?.displayName ?? situation?.pitcher?.athlete?.displayName),
    espn_player_id: asString(situation?.pitcher?.id ?? situation?.pitcher?.athlete?.id),
    hand: asString(situation?.pitcher?.hand?.abbreviation ?? situation?.pitcher?.throws),
    pitch_count: asNumber(situation?.pitchCount ?? situation?.pitcher?.pitchCount),
  };
}

function extractDueUp(summary: any): Array<{ player_name: string | null; bats: string | null }> {
  const situation = summary?.situation ?? {};
  const candidates = [
    situation?.onDeck,
    situation?.onDeckBatter,
    situation?.inHole,
    situation?.inHoleBatter,
  ];
  return candidates
    .map((entry: any) => ({
      player_name: asString(entry?.displayName ?? entry?.athlete?.displayName),
      bats: asString(entry?.bats ?? entry?.battingHand ?? entry?.athlete?.battingHand),
    }))
    .filter((entry) => entry.player_name !== null);
}

function extractEnvironment(summary: any, marketTotal: number | null): MlbEnvironmentState {
  const competition = summary?.header?.competitions?.[0];
  const weather = competition?.weather ?? summary?.weather ?? {};
  const weatherText =
    asString(weather?.displayValue ?? weather?.shortDisplay ?? weather?.description) ?? null;
  const windMph = asNumber(weather?.windSpeed ?? weather?.wind?.speed);
  const windDirection = asString(weather?.windDirection ?? weather?.wind?.direction);
  const roofState = asString(competition?.venue?.indoor ? "closed" : competition?.venue?.roofType);
  const parkName = asString(competition?.venue?.fullName ?? competition?.venue?.name);
  return {
    weather_summary: weatherText,
    temperature_f: asNumber(weather?.temperature),
    wind_mph: windMph,
    wind_direction: windDirection,
    roof_state: roofState,
    park_name: parkName,
    run_environment_index: runEnvironmentIndex(marketTotal, windMph, roofState),
  };
}

function normalizeLineupRow(row: any): MlbLineupSide {
  const battingOrderRaw = Array.isArray(row?.batting_order) ? row.batting_order : [];
  return {
    team: asString(row?.team),
    confirmed: asBool(row?.confirmed),
    confidence_score: asNumber(row?.confidence_score),
    source: asString(row?.source),
    source_url: asString(row?.source_url),
    captured_at: asString(row?.captured_at),
    batting_order: battingOrderRaw.map((item: any) => ({
      order: asNumber(item?.order),
      player_id: asString(item?.player_id),
      player_name: asString(item?.player_name) ?? "Unknown",
      position: asString(item?.position),
      bats: asString(item?.bats ?? item?.batting_hand),
      starter: asBool(item?.starter),
    })),
  };
}

function summarizeBullpen(team: string, rows: any[]): MlbBullpenContext {
  const focused = rows.slice(0, 3);
  const pitchSum = focused.reduce((sum, row) => sum + (asNumber(row?.bullpen_pitches) ?? 0), 0);
  const usedSum = focused.reduce((sum, row) => sum + (asNumber(row?.bullpen_pitchers_used) ?? 0), 0);
  const sampleGames = focused.length;
  const avgPitches = sampleGames > 0 ? pitchSum / sampleGames : null;
  const avgUsed = sampleGames > 0 ? usedSum / sampleGames : null;
  const fatigueScore =
    avgPitches === null || avgUsed === null
      ? null
      : Math.round(Math.max(0, Math.min(100, avgPitches * 0.7 + avgUsed * 11)));

  return {
    team,
    fatigue_score: fatigueScore,
    avg_pitches_last_3: avgPitches === null ? null : Math.round(avgPitches * 10) / 10,
    avg_pitchers_used_last_3: avgUsed === null ? null : Math.round(avgUsed * 10) / 10,
    sample_games: sampleGames,
  };
}

async function fetchBullpenContext(
  supabase: SupabaseLike,
  homeTeam: string | null,
  awayTeam: string | null,
): Promise<{ home: MlbBullpenContext | null; away: MlbBullpenContext | null }> {
  if (!homeTeam || !awayTeam) return { home: null, away: null };

  const { data, error } = await supabase
    .from("mlb_postgame")
    .select(
      "start_time, home_team, away_team, home_bullpen_pitches, away_bullpen_pitches, home_bullpen_pitchers_used, away_bullpen_pitchers_used",
    )
    .order("start_time", { ascending: false })
    .limit(120);

  if (error || !Array.isArray(data)) return { home: null, away: null };

  const homeRows = data
    .flatMap((row: any) => {
      const entries: Array<{ bullpen_pitches: number | null; bullpen_pitchers_used: number | null }> = [];
      if (asString(row?.home_team)?.toLowerCase() === homeTeam.toLowerCase()) {
        entries.push({
          bullpen_pitches: asNumber(row?.home_bullpen_pitches),
          bullpen_pitchers_used: asNumber(row?.home_bullpen_pitchers_used),
        });
      }
      if (asString(row?.away_team)?.toLowerCase() === homeTeam.toLowerCase()) {
        entries.push({
          bullpen_pitches: asNumber(row?.away_bullpen_pitches),
          bullpen_pitchers_used: asNumber(row?.away_bullpen_pitchers_used),
        });
      }
      return entries;
    })
    .filter((row) => row.bullpen_pitches !== null || row.bullpen_pitchers_used !== null);

  const awayRows = data
    .flatMap((row: any) => {
      const entries: Array<{ bullpen_pitches: number | null; bullpen_pitchers_used: number | null }> = [];
      if (asString(row?.home_team)?.toLowerCase() === awayTeam.toLowerCase()) {
        entries.push({
          bullpen_pitches: asNumber(row?.home_bullpen_pitches),
          bullpen_pitchers_used: asNumber(row?.home_bullpen_pitchers_used),
        });
      }
      if (asString(row?.away_team)?.toLowerCase() === awayTeam.toLowerCase()) {
        entries.push({
          bullpen_pitches: asNumber(row?.away_bullpen_pitches),
          bullpen_pitchers_used: asNumber(row?.away_bullpen_pitchers_used),
        });
      }
      return entries;
    })
    .filter((row) => row.bullpen_pitches !== null || row.bullpen_pitchers_used !== null);

  return {
    home: summarizeBullpen(homeTeam, homeRows),
    away: summarizeBullpen(awayTeam, awayRows),
  };
}

function buildMarketSnapshot(
  sourceName: string,
  capturedAt: string | null,
  payloads: unknown[],
): MarketSnapshot {
  return {
    total: pickFirstNumeric(payloads, ["total", "overUnder", "total_value", "dk_total"]),
    home_moneyline: pickFirstNumeric(payloads, [
      "home_ml",
      "homeML",
      "moneylineHome",
      "home_moneyline",
    ]),
    away_moneyline: pickFirstNumeric(payloads, [
      "away_ml",
      "awayML",
      "moneylineAway",
      "away_moneyline",
    ]),
    home_run_line: pickFirstNumeric(payloads, ["home_spread", "spread", "run_line_home"]),
    away_run_line: pickFirstNumeric(payloads, ["away_spread", "run_line_away"]),
    source: sourceName,
    captured_at: capturedAt,
  };
}

function derivePregameEdges(
  opening: MarketSnapshot,
  current: MarketSnapshot,
  lineups: { home: MlbLineupSide | null; away: MlbLineupSide | null },
  bullpens: { home: MlbBullpenContext | null; away: MlbBullpenContext | null },
  pregameIntelRow: any,
): MlbPregameEdge[] {
  const edges: MlbPregameEdge[] = [];

  if (opening.total !== null && current.total !== null) {
    const delta = Math.round((current.total - opening.total) * 10) / 10;
    edges.push({
      edge_key: "total_move",
      title: "Total Movement",
      detail: `${opening.total} → ${current.total} (${delta >= 0 ? "+" : ""}${delta})`,
      market_relevance: Math.abs(delta) >= 1 ? "high" : Math.abs(delta) >= 0.5 ? "medium" : "low",
    });
  }

  const lineupConfidence =
    ((lineups.home?.confidence_score ?? 0) + (lineups.away?.confidence_score ?? 0)) / 2;
  edges.push({
    edge_key: "lineup_confidence",
    title: "Lineup Certainty",
    detail:
      lineupConfidence > 0
        ? `Avg lineup confidence ${(lineupConfidence * 100).toFixed(0)}%`
        : "No projected lineup confidence available yet",
    market_relevance: lineupConfidence >= 0.75 ? "medium" : "low",
  });

  const homeFatigue = bullpens.home?.fatigue_score ?? null;
  const awayFatigue = bullpens.away?.fatigue_score ?? null;
  if (homeFatigue !== null || awayFatigue !== null) {
    edges.push({
      edge_key: "bullpen_fatigue",
      title: "Bullpen Fatigue",
      detail: `Home ${homeFatigue ?? "?"} / Away ${awayFatigue ?? "?"}`,
      market_relevance:
        (homeFatigue ?? 0) >= 70 || (awayFatigue ?? 0) >= 70 ? "high" : "medium",
    });
  }

  const pick = asString(pregameIntelRow?.recommended_pick ?? pregameIntelRow?.pick_type);
  if (pick) {
    edges.push({
      edge_key: "pregame_model_pick",
      title: "Pregame Model Lean",
      detail: pick,
      market_relevance: "medium",
    });
  }

  return edges;
}

export async function buildCanonicalMlbGameObject(
  supabase: SupabaseLike,
  gameId: string,
  baseUrl: string,
): Promise<CanonicalMlbGameObject> {
  const dataGaps: string[] = [];

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select(
      "id, league_id, sport, start_time, status, home_team, away_team, home_score, away_score, current_odds, opening_odds, extra_data, last_updated",
    )
    .eq("id", gameId)
    .maybeSingle();

  if (matchError || !match) {
    throw new Error(matchError?.message ?? `MLB match not found: ${gameId}`);
  }

  const strippedEventId = gameId.replace(/_[a-z0-9.]+$/i, "");
  const espnSummary = await fetchEspnSummary(strippedEventId);
  if (!espnSummary) dataGaps.push("espn_summary_unavailable");

  const { data: liveState } = await supabase
    .from("live_game_state")
    .select(
      "id, game_status, period, clock, home_score, away_score, situation, recent_plays, last_play, odds, updated_at",
    )
    .eq("id", gameId)
    .maybeSingle();

  const { data: openingLine } = await supabase
    .from("opening_lines")
    .select("match_id, total, home_spread, away_spread, home_ml, away_ml, created_at")
    .eq("match_id", gameId)
    .maybeSingle();

  const { data: closingLine } = await supabase
    .from("closing_lines")
    .select("match_id, total, home_spread, away_spread, home_ml, away_ml, created_at")
    .eq("match_id", gameId)
    .maybeSingle();

  const { data: lineupRows } = await supabase
    .from("v_mlb_latest_projected_lineups")
    .select("game_id, team, batting_order, confirmed, confidence_score, source, source_url, captured_at")
    .eq("game_id", gameId)
    .limit(2);

  const { data: pregameIntelRows } = await supabase
    .from("pregame_intel")
    .select("match_id, headline, briefing, recommended_pick, pick_type, confidence_score, created_at")
    .eq("match_id", gameId)
    .order("created_at", { ascending: false })
    .limit(1);

  const homeTeam = asString(match.home_team);
  const awayTeam = asString(match.away_team);

  const bullpenContext = await fetchBullpenContext(supabase, homeTeam, awayTeam);

  const openingMarket = buildMarketSnapshot("opening", asString(openingLine?.created_at), [
    openingLine ?? {},
    match.opening_odds,
    match.extra_data,
  ]);
  const currentMarket = buildMarketSnapshot(
    LIVE_STATUSES.includes(asString(match.status) ?? "") ? "live" : "current",
    asString(liveState?.updated_at ?? match.last_updated ?? closingLine?.created_at),
    [
      liveState?.odds ?? {},
      closingLine ?? {},
      match.current_odds,
      match.extra_data,
    ],
  );

  const pregameEnvironment = extractEnvironment(espnSummary, openingMarket.total);
  const liveEnvironment = extractEnvironment(espnSummary, currentMarket.total);
  const deltaRunEnvironment =
    pregameEnvironment.run_environment_index !== null &&
    liveEnvironment.run_environment_index !== null
      ? Math.round(
          (liveEnvironment.run_environment_index - pregameEnvironment.run_environment_index) * 1000,
        ) / 1000
      : null;

  const normalizedLineups = Array.isArray(lineupRows)
    ? lineupRows.map((row) => normalizeLineupRow(row))
    : [];
  const homeLineup =
    normalizedLineups.find((row) =>
      homeTeam ? (row.team ?? "").toLowerCase() === homeTeam.toLowerCase() : false,
    ) ?? normalizedLineups[0] ?? null;
  const awayLineup =
    normalizedLineups.find((row) =>
      awayTeam ? (row.team ?? "").toLowerCase() === awayTeam.toLowerCase() : false,
    ) ?? normalizedLineups[1] ?? null;

  if (!homeLineup || !awayLineup) {
    dataGaps.push("projected_lineups_partial");
  }

  const starterHome = extractStarter(espnSummary, "home");
  const starterAway = extractStarter(espnSummary, "away");
  if (!starterHome || !starterAway) dataGaps.push("starter_context_partial");

  const competition = espnSummary?.header?.competitions?.[0];
  const statusDetail =
    asString(competition?.status?.type?.shortDetail ?? competition?.status?.type?.detail) ?? null;
  const inningHalf = parseInningHalf(statusDetail);
  const inningNumber = asNumber(competition?.status?.period ?? liveState?.period);
  const situation = espnSummary?.situation ?? parseJson(liveState?.situation);
  const recentPlays =
    (Array.isArray(espnSummary?.plays) ? espnSummary.plays : null) ??
    (Array.isArray(liveState?.recent_plays) ? liveState.recent_plays : []);
  const pitchSequence = parsePitchSequence(recentPlays);

  const recentControlState =
    pitchSequence.length >= 8
      ? (() => {
          const last15 = pitchSequence.slice(-15);
          const ballCount = last15.filter(
            (pitch) => pitch.result === "ball" || pitch.result === "hit_by_pitch",
          ).length;
          const firstPitchSamples = last15.filter((pitch) => pitch.is_first_pitch !== null);
          const firstStrikeCount = firstPitchSamples.filter(
            (pitch) =>
              pitch.is_first_pitch === true &&
              (pitch.result === "called_strike" || pitch.result === "swinging_strike" || pitch.result === "foul"),
          ).length;
          return {
            sample_size: last15.length,
            ball_rate_last_15: Math.round((ballCount / last15.length) * 1000) / 10,
            first_strike_rate_last_15:
              firstPitchSamples.length > 0
                ? Math.round((firstStrikeCount / firstPitchSamples.length) * 1000) / 10
                : null,
          };
        })()
      : null;

  if (!recentControlState) dataGaps.push("starter_command_inputs_partial");

  const pregameIntelRow = Array.isArray(pregameIntelRows) ? pregameIntelRows[0] : null;
  const pregameEdges = derivePregameEdges(
    openingMarket,
    currentMarket,
    { home: homeLineup, away: awayLineup },
    bullpenContext,
    pregameIntelRow,
  );

  const gameUrl = `${baseUrl.replace(/\/$/, "")}/mlb/game/${encodeURIComponent(gameId)}`;

  return {
    game_id: gameId,
    game_url: gameUrl,
    start_time_utc: asString(match.start_time),
    status: asString(liveState?.game_status ?? match.status ?? competition?.status?.type?.name) ?? "UNKNOWN",
    teams: {
      home: {
        name: homeTeam,
        abbreviation:
          asString(competition?.competitors?.find((entry: any) => entry?.homeAway === "home")?.team?.abbreviation) ??
          null,
        score: asNumber(liveState?.home_score ?? match.home_score),
      },
      away: {
        name: awayTeam,
        abbreviation:
          asString(competition?.competitors?.find((entry: any) => entry?.homeAway === "away")?.team?.abbreviation) ??
          null,
        score: asNumber(liveState?.away_score ?? match.away_score),
      },
    },
    market: {
      opening: openingMarket,
      current: currentMarket,
    },
    environment: {
      pregame: pregameEnvironment,
      live: liveEnvironment,
      delta_run_environment: deltaRunEnvironment,
    },
    lineups: {
      home: homeLineup,
      away: awayLineup,
    },
    starters: {
      home: starterHome,
      away: starterAway,
    },
    bullpens: {
      home: bullpenContext.home,
      away: bullpenContext.away,
    },
    pregame_edges: pregameEdges,
    live_state: {
      inning: inningNumber,
      half: inningHalf,
      outs: asNumber(situation?.outs),
      balls: asNumber(situation?.balls),
      strikes: asNumber(situation?.strikes),
      runners: {
        on_first: asBool(situation?.onFirst),
        on_second: asBool(situation?.onSecond),
        on_third: asBool(situation?.onThird),
      },
      current_pitcher: extractCurrentPitcher(espnSummary),
      due_up: extractDueUp(espnSummary),
      recent_pitch_sequence: pitchSequence,
      recent_control_state: recentControlState,
      current_market_snapshot: currentMarket,
    },
    data_gaps: dataGaps,
  };
}
