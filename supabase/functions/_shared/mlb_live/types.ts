export type TriggerSeverity = "low" | "medium" | "high";

export interface MlbTeamState {
  name: string | null;
  abbreviation: string | null;
  score: number | null;
}

export interface MarketSnapshot {
  total: number | null;
  home_moneyline: number | null;
  away_moneyline: number | null;
  home_run_line: number | null;
  away_run_line: number | null;
  source: string | null;
  captured_at: string | null;
}

export interface MlbEnvironmentState {
  weather_summary: string | null;
  temperature_f: number | null;
  wind_mph: number | null;
  wind_direction: string | null;
  roof_state: string | null;
  park_name: string | null;
  run_environment_index: number | null;
}

export interface MlbLineupSide {
  team: string | null;
  confirmed: boolean | null;
  confidence_score: number | null;
  source: string | null;
  source_url: string | null;
  captured_at: string | null;
  batting_order: Array<{
    order: number | null;
    player_id: string | null;
    player_name: string;
    position: string | null;
    bats: string | null;
    starter: boolean | null;
  }>;
}

export interface MlbStarterContext {
  name: string | null;
  espn_player_id: string | null;
  hand: string | null;
  era: number | null;
  whip: number | null;
  pitch_count: number | null;
}

export interface MlbBullpenContext {
  team: string | null;
  fatigue_score: number | null;
  avg_pitches_last_3: number | null;
  avg_pitchers_used_last_3: number | null;
  sample_games: number;
}

export interface MlbPregameEdge {
  edge_key: string;
  title: string;
  detail: string;
  market_relevance: "high" | "medium" | "low";
}

export interface MlbRecentPitch {
  sequence: number;
  result: string;
  pitch_type: string | null;
  mph: number | null;
  is_first_pitch: boolean | null;
  text: string | null;
}

export interface MlbLiveState {
  inning: number | null;
  half: "top" | "bottom" | null;
  outs: number | null;
  balls: number | null;
  strikes: number | null;
  runners: {
    on_first: boolean | null;
    on_second: boolean | null;
    on_third: boolean | null;
  };
  current_pitcher: {
    name: string | null;
    espn_player_id: string | null;
    hand: string | null;
    pitch_count: number | null;
  };
  due_up: Array<{
    player_name: string | null;
    bats: string | null;
  }>;
  recent_pitch_sequence: MlbRecentPitch[];
  recent_control_state: {
    sample_size: number;
    ball_rate_last_15: number | null;
    first_strike_rate_last_15: number | null;
  } | null;
  current_market_snapshot: MarketSnapshot;
}

export interface CanonicalMlbGameObject {
  game_id: string;
  game_url: string;
  start_time_utc: string | null;
  status: string;
  teams: {
    home: MlbTeamState;
    away: MlbTeamState;
  };
  market: {
    opening: MarketSnapshot;
    current: MarketSnapshot;
  };
  environment: {
    pregame: MlbEnvironmentState;
    live: MlbEnvironmentState;
    delta_run_environment: number | null;
  };
  lineups: {
    home: MlbLineupSide | null;
    away: MlbLineupSide | null;
  };
  starters: {
    home: MlbStarterContext | null;
    away: MlbStarterContext | null;
  };
  bullpens: {
    home: MlbBullpenContext | null;
    away: MlbBullpenContext | null;
  };
  pregame_edges: MlbPregameEdge[];
  live_state: MlbLiveState;
  data_gaps: string[];
}

export interface TriggerResult {
  trigger_name:
    | "starter_command_loss"
    | "pitch_count_stress"
    | "weak_escape_inning"
    | "bullpen_fragility_now_live"
    | "run_environment_boost_live"
    | "platoon_pressure_window";
  fired: boolean;
  implemented: boolean;
  supporting_facts: Record<string, unknown>;
  severity: TriggerSeverity;
  confidence_inputs: {
    score: number;
    market_relevance: boolean;
    reasons: string[];
  };
  partial_reason: string | null;
}

export interface TriggerMappingRow {
  trigger_name: TriggerResult["trigger_name"];
  required_inputs: string[];
  source_columns_or_paths: string[];
  status: "implemented" | "partial";
}

export interface MlbInsightFormat {
  what_changed: string;
  why_it_matters: string;
  what_to_watch_now: string;
  text: string;
}

export interface CooldownState {
  trigger: TriggerResult["trigger_name"];
  ts_utc: string;
  severity: TriggerSeverity;
}

export interface SpeakDecision {
  speak: boolean;
  reason: string;
  chosen_trigger: TriggerResult | null;
  cooldown_blocked: boolean;
  severity_escalated: boolean;
}

export const CANONICAL_MLB_GAME_OBJECT_SCHEMA = {
  type: "object",
  required: [
    "game_id",
    "game_url",
    "start_time_utc",
    "status",
    "teams",
    "market",
    "environment",
    "lineups",
    "starters",
    "bullpens",
    "pregame_edges",
    "live_state",
    "data_gaps",
  ],
} as const;

export function validateCanonicalObjectShape(
  payload: unknown,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["payload must be an object"] };
  }

  const obj = payload as Record<string, unknown>;
  for (const key of CANONICAL_MLB_GAME_OBJECT_SCHEMA.required) {
    if (!(key in obj)) {
      errors.push(`missing required key: ${key}`);
    }
  }

  if (typeof obj.game_id !== "string" || obj.game_id.trim().length === 0) {
    errors.push("game_id must be a non-empty string");
  }

  if (typeof obj.game_url !== "string" || obj.game_url.trim().length === 0) {
    errors.push("game_url must be a non-empty string");
  }

  if (typeof obj.status !== "string" || obj.status.trim().length === 0) {
    errors.push("status must be a non-empty string");
  }

  if (!Array.isArray(obj.pregame_edges)) {
    errors.push("pregame_edges must be an array");
  }

  if (!Array.isArray(obj.data_gaps)) {
    errors.push("data_gaps must be an array");
  }

  return { ok: errors.length === 0, errors };
}
