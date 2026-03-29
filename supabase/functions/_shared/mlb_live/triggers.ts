import type {
  CanonicalMlbGameObject,
  TriggerMappingRow,
  TriggerResult,
  TriggerSeverity,
} from "./types.ts";

function severityRank(severity: TriggerSeverity): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export const TRIGGER_DATA_MAPPING: TriggerMappingRow[] = [
  {
    trigger_name: "starter_command_loss",
    required_inputs: ["recent_pitch_sequence", "ball_rate_last_15", "first_strike_rate_last_15"],
    source_columns_or_paths: [
      "ESPN summary plays[].text/type",
      "canonical.live_state.recent_pitch_sequence",
      "canonical.live_state.recent_control_state",
    ],
    status: "partial",
  },
  {
    trigger_name: "pitch_count_stress",
    required_inputs: ["current_pitcher.pitch_count", "live_state.inning"],
    source_columns_or_paths: [
      "ESPN summary situation.pitchCount",
      "live_game_state.period",
      "canonical.live_state.current_pitcher.pitch_count",
    ],
    status: "implemented",
  },
  {
    trigger_name: "weak_escape_inning",
    required_inputs: ["recent_plays text", "baserunner pressure signal"],
    source_columns_or_paths: [
      "ESPN summary plays[].text",
      "canonical.live_state.runners + recent_pitch_sequence",
    ],
    status: "implemented",
  },
  {
    trigger_name: "bullpen_fragility_now_live",
    required_inputs: ["starter exit before 6th", "pregame bullpen fatigue score"],
    source_columns_or_paths: [
      "canonical.starters.home/away.name",
      "canonical.live_state.current_pitcher.name",
      "canonical.bullpens.home/away.fatigue_score",
    ],
    status: "implemented",
  },
  {
    trigger_name: "run_environment_boost_live",
    required_inputs: ["pregame run environment index", "live run environment index"],
    source_columns_or_paths: [
      "canonical.environment.pregame.run_environment_index",
      "canonical.environment.live.run_environment_index",
      "canonical.environment.delta_run_environment",
    ],
    status: "implemented",
  },
  {
    trigger_name: "platoon_pressure_window",
    required_inputs: ["next 4 hitters bats", "current pitcher hand"],
    source_columns_or_paths: [
      "canonical.live_state.current_pitcher.hand",
      "canonical.live_state.due_up[].bats",
      "canonical.lineups.home/away.batting_order[].bats",
    ],
    status: "partial",
  },
];

function triggerStarterCommandLoss(game: CanonicalMlbGameObject): TriggerResult {
  const control = game.live_state.recent_control_state;
  if (!control || control.sample_size < 10 || control.first_strike_rate_last_15 === null) {
    return {
      trigger_name: "starter_command_loss",
      fired: false,
      implemented: false,
      partial_reason:
        "Need 10+ recent pitch events with first-pitch strike visibility to evaluate starter command loss.",
      supporting_facts: {
        sample_size: control?.sample_size ?? 0,
        first_strike_rate_last_15: control?.first_strike_rate_last_15 ?? null,
      },
      severity: "low",
      confidence_inputs: {
        score: 0,
        market_relevance: false,
        reasons: ["insufficient recent pitch control samples"],
      },
    };
  }

  const ballRate = control.ball_rate_last_15 ?? 0;
  const firstStrikeRate = control.first_strike_rate_last_15 ?? 0;
  const fired = ballRate >= 45 && firstStrikeRate <= 50;
  const severity: TriggerSeverity =
    ballRate >= 55 && firstStrikeRate <= 45 ? "high" : fired ? "medium" : "low";
  const score = clamp01(
    0.45 +
      Math.max(0, (ballRate - 45) / 30) * 0.35 +
      Math.max(0, (50 - firstStrikeRate) / 30) * 0.2,
  );

  return {
    trigger_name: "starter_command_loss",
    fired,
    implemented: true,
    partial_reason: null,
    supporting_facts: {
      sample_size: control.sample_size,
      ball_rate_last_15: ballRate,
      first_strike_rate_last_15: firstStrikeRate,
      thresholds: { min_ball_rate: 45, max_first_strike_rate: 50 },
    },
    severity,
    confidence_inputs: {
      score,
      market_relevance: fired,
      reasons: [
        "starter command degradation can accelerate walk traffic and run expectancy",
        "short-window control deterioration is materially relevant to live total and side",
      ],
    },
  };
}

function triggerPitchCountStress(game: CanonicalMlbGameObject): TriggerResult {
  const pitchCount = game.live_state.current_pitcher.pitch_count;
  const inning = game.live_state.inning;
  if (pitchCount === null || inning === null) {
    return {
      trigger_name: "pitch_count_stress",
      fired: false,
      implemented: false,
      partial_reason: "Need both current pitcher pitch count and inning number.",
      supporting_facts: { pitch_count: pitchCount, inning },
      severity: "low",
      confidence_inputs: {
        score: 0,
        market_relevance: false,
        reasons: ["missing core state inputs"],
      },
    };
  }

  const fired = (pitchCount >= 80 && inning >= 4) || (pitchCount >= 95 && inning < 6);
  const severity: TriggerSeverity =
    pitchCount >= 100 ? "high" : pitchCount >= 90 ? "medium" : fired ? "medium" : "low";

  return {
    trigger_name: "pitch_count_stress",
    fired,
    implemented: true,
    partial_reason: null,
    supporting_facts: {
      pitch_count: pitchCount,
      inning,
      thresholds: {
        at_end_4th: ">=80",
        before_6th: ">=95",
      },
    },
    severity,
    confidence_inputs: {
      score: clamp01(0.35 + Math.max(0, (pitchCount - 80) / 35)),
      market_relevance: fired,
      reasons: [
        "early starter pitch inflation increases bullpen exposure probability",
        "bullpen handoff risk is market-relevant for totals and full-game sides",
      ],
    },
  };
}

function triggerWeakEscapeInning(game: CanonicalMlbGameObject): TriggerResult {
  const recentPitchTexts = game.live_state.recent_pitch_sequence
    .map((pitch) => pitch.text?.toLowerCase() ?? "")
    .filter(Boolean);
  if (recentPitchTexts.length < 4) {
    return {
      trigger_name: "weak_escape_inning",
      fired: false,
      implemented: false,
      partial_reason: "Need richer recent-play text sample to classify weak escape events.",
      supporting_facts: { recent_pitch_events: recentPitchTexts.length },
      severity: "low",
      confidence_inputs: {
        score: 0,
        market_relevance: false,
        reasons: ["insufficient play text sample"],
      },
    };
  }

  const baserunnerEvents = recentPitchTexts.filter((text) =>
    /(walk|single|double|triple|hit by pitch|error|reaches)/.test(text),
  ).length;
  const escapeEventDetected = recentPitchTexts.some((text) =>
    /(double play|tootblan|caught stealing|pickoff|line into double play)/.test(text),
  );
  const fired = baserunnerEvents >= 2 && escapeEventDetected;
  const severity: TriggerSeverity =
    baserunnerEvents >= 3 && escapeEventDetected ? "high" : fired ? "medium" : "low";

  return {
    trigger_name: "weak_escape_inning",
    fired,
    implemented: true,
    partial_reason: null,
    supporting_facts: {
      recent_baserunner_events: baserunnerEvents,
      escape_event_detected: escapeEventDetected,
    },
    severity,
    confidence_inputs: {
      score: clamp01(0.4 + baserunnerEvents * 0.12 + (escapeEventDetected ? 0.16 : 0)),
      market_relevance: fired,
      reasons: [
        "high-traffic innings escaped via noise events can mask deteriorating run prevention quality",
      ],
    },
  };
}

function triggerBullpenFragilityNowLive(game: CanonicalMlbGameObject): TriggerResult {
  const half = game.live_state.half;
  const inning = game.live_state.inning;
  const pitcherName = (game.live_state.current_pitcher.name ?? "").toLowerCase();
  if (!half || inning === null || !pitcherName) {
    return {
      trigger_name: "bullpen_fragility_now_live",
      fired: false,
      implemented: false,
      partial_reason: "Need inning-half + active pitcher identity to infer starter exit timing.",
      supporting_facts: { half, inning, current_pitcher: game.live_state.current_pitcher.name },
      severity: "low",
      confidence_inputs: {
        score: 0,
        market_relevance: false,
        reasons: ["missing live half/pitcher identity"],
      },
    };
  }

  const fieldingSide = half === "top" ? "home" : "away";
  const starterName = (game.starters[fieldingSide]?.name ?? "").toLowerCase();
  const starterExited = starterName.length > 0 && pitcherName.length > 0 && starterName !== pitcherName;
  const fatigue = game.bullpens[fieldingSide]?.fatigue_score ?? null;
  const fatigueHigh = fatigue !== null && fatigue >= 70;
  const fired = starterExited && inning < 6 && fatigueHigh;
  const severity: TriggerSeverity =
    fired && (fatigue ?? 0) >= 82 ? "high" : fired ? "medium" : "low";

  return {
    trigger_name: "bullpen_fragility_now_live",
    fired,
    implemented: true,
    partial_reason: null,
    supporting_facts: {
      fielding_side: fieldingSide,
      starter_name: game.starters[fieldingSide]?.name ?? null,
      current_pitcher: game.live_state.current_pitcher.name,
      starter_exited_before_6th: starterExited && inning < 6,
      bullpen_fatigue_score: fatigue,
    },
    severity,
    confidence_inputs: {
      score: clamp01(
        0.38 + (starterExited ? 0.2 : 0) + (inning < 6 ? 0.12 : 0) + Math.max(0, ((fatigue ?? 0) - 70) / 40),
      ),
      market_relevance: fired,
      reasons: ["early bullpen entry + fatigue profile materially impacts live scoring expectation"],
    },
  };
}

function triggerRunEnvironmentBoostLive(game: CanonicalMlbGameObject): TriggerResult {
  const delta = game.environment.delta_run_environment;
  if (delta === null) {
    return {
      trigger_name: "run_environment_boost_live",
      fired: false,
      implemented: false,
      partial_reason: "Need pregame and live run environment indices.",
      supporting_facts: {
        pregame_index: game.environment.pregame.run_environment_index,
        live_index: game.environment.live.run_environment_index,
      },
      severity: "low",
      confidence_inputs: {
        score: 0,
        market_relevance: false,
        reasons: ["run environment delta unavailable"],
      },
    };
  }

  const fired = delta >= 0.2;
  const severity: TriggerSeverity = delta >= 0.4 ? "high" : fired ? "medium" : "low";
  return {
    trigger_name: "run_environment_boost_live",
    fired,
    implemented: true,
    partial_reason: null,
    supporting_facts: {
      delta_run_environment: delta,
      pregame_index: game.environment.pregame.run_environment_index,
      live_index: game.environment.live.run_environment_index,
      weather_live: game.environment.live.weather_summary,
      roof_live: game.environment.live.roof_state,
    },
    severity,
    confidence_inputs: {
      score: clamp01(0.35 + Math.max(0, delta) * 0.8),
      market_relevance: fired,
      reasons: ["live weather/roof shifts can increase baseline run scoring conditions"],
    },
  };
}

function triggerPlatoonPressureWindow(game: CanonicalMlbGameObject): TriggerResult {
  const pitcherHand = game.live_state.current_pitcher.hand?.toUpperCase() ?? null;
  const dueUp = game.live_state.due_up ?? [];
  const hitterHands = dueUp.map((hitter) => hitter.bats?.toUpperCase() ?? null).filter(Boolean) as string[];

  if (!pitcherHand || hitterHands.length < 3) {
    return {
      trigger_name: "platoon_pressure_window",
      fired: false,
      implemented: false,
      partial_reason:
        "Need current pitcher hand and at least 3 upcoming hitters with batting-hand data.",
      supporting_facts: {
        pitcher_hand: pitcherHand,
        due_up_handedness_count: hitterHands.length,
      },
      severity: "low",
      confidence_inputs: {
        score: 0,
        market_relevance: false,
        reasons: ["insufficient handedness window"],
      },
    };
  }

  const disadvantageCount = hitterHands.filter((hand) =>
    (pitcherHand === "R" && hand.startsWith("L")) || (pitcherHand === "L" && hand.startsWith("R")),
  ).length;
  const fired = disadvantageCount >= 3;
  const severity: TriggerSeverity = disadvantageCount >= 4 ? "high" : fired ? "medium" : "low";

  return {
    trigger_name: "platoon_pressure_window",
    fired,
    implemented: true,
    partial_reason: null,
    supporting_facts: {
      pitcher_hand: pitcherHand,
      due_up_handedness: hitterHands,
      disadvantage_count: disadvantageCount,
    },
    severity,
    confidence_inputs: {
      score: clamp01(0.32 + disadvantageCount * 0.16),
      market_relevance: fired,
      reasons: ["concentrated handedness disadvantage in next hitters can shift immediate run risk"],
    },
  };
}

export function evaluateMlbTriggers(game: CanonicalMlbGameObject): TriggerResult[] {
  const results = [
    triggerStarterCommandLoss(game),
    triggerPitchCountStress(game),
    triggerWeakEscapeInning(game),
    triggerBullpenFragilityNowLive(game),
    triggerRunEnvironmentBoostLive(game),
    triggerPlatoonPressureWindow(game),
  ];

  // Ensure deterministic order + deterministic severity fallback.
  return results.sort((a, b) => {
    const rankDelta = severityRank(b.severity) - severityRank(a.severity);
    if (rankDelta !== 0) return rankDelta;
    if (a.fired !== b.fired) return a.fired ? -1 : 1;
    return a.trigger_name.localeCompare(b.trigger_name);
  });
}
