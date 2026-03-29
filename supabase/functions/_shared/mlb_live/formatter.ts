import type { CanonicalMlbGameObject, MlbInsightFormat, TriggerResult } from "./types.ts";

export const MLB_INSIGHT_OUTPUT_SCHEMA = {
  type: "object",
  required: ["what_changed", "why_it_matters", "what_to_watch_now", "text"],
} as const;

function sentence(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.endsWith(".") ? cleaned : `${cleaned}.`;
}

function chooseWatchCheckpoint(game: CanonicalMlbGameObject): string {
  const inning = game.live_state.inning;
  const half = game.live_state.half;
  if (inning !== null && half) {
    const nextHalf = half === "top" ? "bottom" : "top";
    return `Watch the ${nextHalf} of inning ${inning} for leverage bullpen usage and market reaction.`;
  }
  return "Watch the next inning boundary for bullpen handoff and line movement confirmation.";
}

function formatStarterCommandLoss(game: CanonicalMlbGameObject, trigger: TriggerResult): MlbInsightFormat {
  const facts = trigger.supporting_facts;
  const ballRate = facts.ball_rate_last_15;
  const firstStrike = facts.first_strike_rate_last_15;
  return {
    what_changed: sentence(
      `Starter command slipped in the last pitch window (ball rate ${ballRate}% and first-strike rate ${firstStrike}%)`,
    ),
    why_it_matters: sentence(
      "Command loss raises walk traffic and pitch inflation risk, which increases run-scoring pressure before full bullpen stabilization",
    ),
    what_to_watch_now: chooseWatchCheckpoint(game),
    text: "",
  };
}

function formatPitchCountStress(game: CanonicalMlbGameObject, trigger: TriggerResult): MlbInsightFormat {
  const facts = trigger.supporting_facts;
  return {
    what_changed: sentence(
      `Current pitcher reached ${facts.pitch_count ?? "?"} pitches by inning ${facts.inning ?? "?"}`,
    ),
    why_it_matters: sentence(
      "Early pitch-count stress increases probability of a bullpen handoff before the game stabilizes",
    ),
    what_to_watch_now: chooseWatchCheckpoint(game),
    text: "",
  };
}

function formatWeakEscape(game: CanonicalMlbGameObject, trigger: TriggerResult): MlbInsightFormat {
  const baserunners = trigger.supporting_facts.recent_baserunner_events ?? "?";
  return {
    what_changed: sentence(
      `A high-traffic inning escaped on noise events after ${baserunners} recent baserunner events`,
    ),
    why_it_matters: sentence(
      "Escape variance can mask underlying run prevention stress and leave totals vulnerable to the next clean-contact sequence",
    ),
    what_to_watch_now: chooseWatchCheckpoint(game),
    text: "",
  };
}

function formatBullpenFragility(game: CanonicalMlbGameObject, trigger: TriggerResult): MlbInsightFormat {
  const facts = trigger.supporting_facts;
  const side = String(facts.fielding_side ?? "fielding side");
  const fatigue = facts.bullpen_fatigue_score ?? "?";
  return {
    what_changed: sentence(
      `${side} starter exited before the sixth and bullpen exposure is now live (fatigue score ${fatigue})`,
    ),
    why_it_matters: sentence(
      "Early bullpen demand with a fatigued relief profile increases late-inning run volatility",
    ),
    what_to_watch_now: chooseWatchCheckpoint(game),
    text: "",
  };
}

function formatRunEnvironment(game: CanonicalMlbGameObject, trigger: TriggerResult): MlbInsightFormat {
  const delta = trigger.supporting_facts.delta_run_environment ?? "?";
  return {
    what_changed: sentence(`Live run environment index increased by ${delta} versus pregame baseline`),
    why_it_matters: sentence(
      "A higher run environment increases expected scoring efficiency and can shift fair live totals upward",
    ),
    what_to_watch_now: chooseWatchCheckpoint(game),
    text: "",
  };
}

function formatPlatoon(game: CanonicalMlbGameObject, trigger: TriggerResult): MlbInsightFormat {
  const count = trigger.supporting_facts.disadvantage_count ?? "?";
  return {
    what_changed: sentence(
      `The next hitting window shows ${count} platoon-disadvantage matchups against the current pitcher`,
    ),
    why_it_matters: sentence(
      "A concentrated platoon disadvantage increases immediate contact quality risk for this half-inning segment",
    ),
    what_to_watch_now: chooseWatchCheckpoint(game),
    text: "",
  };
}

export function formatMlbInsight(
  game: CanonicalMlbGameObject,
  trigger: TriggerResult,
): MlbInsightFormat {
  let formatted: MlbInsightFormat;
  switch (trigger.trigger_name) {
    case "starter_command_loss":
      formatted = formatStarterCommandLoss(game, trigger);
      break;
    case "pitch_count_stress":
      formatted = formatPitchCountStress(game, trigger);
      break;
    case "weak_escape_inning":
      formatted = formatWeakEscape(game, trigger);
      break;
    case "bullpen_fragility_now_live":
      formatted = formatBullpenFragility(game, trigger);
      break;
    case "run_environment_boost_live":
      formatted = formatRunEnvironment(game, trigger);
      break;
    case "platoon_pressure_window":
      formatted = formatPlatoon(game, trigger);
      break;
    default:
      formatted = {
        what_changed: sentence("A market-relevant trigger fired"),
        why_it_matters: sentence("This state shift affects live pricing sensitivity"),
        what_to_watch_now: chooseWatchCheckpoint(game),
        text: "",
      };
  }

  formatted.text = `What changed: ${formatted.what_changed}\nWhy it matters: ${formatted.why_it_matters}\nWhat to watch now: ${formatted.what_to_watch_now}`;
  return formatted;
}

export function validateMlbInsightFormat(payload: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["payload must be object"] };
  }
  const obj = payload as Record<string, unknown>;
  for (const key of MLB_INSIGHT_OUTPUT_SCHEMA.required) {
    if (!(key in obj)) errors.push(`missing key: ${key}`);
  }
  for (const key of ["what_changed", "why_it_matters", "what_to_watch_now", "text"]) {
    const value = obj[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`${key} must be non-empty string`);
    }
  }
  const text = String(obj.text ?? "").toLowerCase();
  if (text.includes("ai says") || text.includes("as an ai")) {
    errors.push("output must not self-reference AI");
  }
  return { ok: errors.length === 0, errors };
}
