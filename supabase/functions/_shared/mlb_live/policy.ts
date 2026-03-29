import type { CooldownState, SpeakDecision, TriggerResult, TriggerSeverity } from "./types.ts";

export const SPEAK_POLICY_CONFIG = {
  min_confidence_score: 0.62,
  cooldown_minutes: 15,
} as const;

function severityRank(severity: TriggerSeverity): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function isWithinCooldown(now: Date, previousTs: string, windowMinutes: number): boolean {
  const previousMs = Date.parse(previousTs);
  if (Number.isNaN(previousMs)) return false;
  const deltaMs = now.getTime() - previousMs;
  return deltaMs >= 0 && deltaMs < windowMinutes * 60_000;
}

export function evaluateSpeakSilentPolicy(
  triggerResults: TriggerResult[],
  cooldownState: Record<string, CooldownState | undefined>,
  now: Date = new Date(),
): SpeakDecision {
  const candidates = triggerResults
    .filter((result) => result.fired)
    .filter((result) => result.implemented)
    .filter((result) => result.confidence_inputs.market_relevance)
    .filter((result) => result.confidence_inputs.score >= SPEAK_POLICY_CONFIG.min_confidence_score)
    .sort((a, b) => {
      const severityDelta = severityRank(b.severity) - severityRank(a.severity);
      if (severityDelta !== 0) return severityDelta;
      return b.confidence_inputs.score - a.confidence_inputs.score;
    });

  if (candidates.length === 0) {
    return {
      speak: false,
      reason: "no_trigger_above_threshold_or_market_relevance",
      chosen_trigger: null,
      cooldown_blocked: false,
      severity_escalated: false,
    };
  }

  const chosen = candidates[0];
  const previous = cooldownState[chosen.trigger_name];
  if (!previous) {
    return {
      speak: true,
      reason: "trigger_fired_and_passed_threshold",
      chosen_trigger: chosen,
      cooldown_blocked: false,
      severity_escalated: false,
    };
  }

  const withinCooldown = isWithinCooldown(
    now,
    previous.ts_utc,
    SPEAK_POLICY_CONFIG.cooldown_minutes,
  );

  if (!withinCooldown) {
    return {
      speak: true,
      reason: "cooldown_expired",
      chosen_trigger: chosen,
      cooldown_blocked: false,
      severity_escalated: false,
    };
  }

  const escalated = severityRank(chosen.severity) > severityRank(previous.severity);
  if (escalated) {
    return {
      speak: true,
      reason: "cooldown_bypassed_due_to_severity_escalation",
      chosen_trigger: chosen,
      cooldown_blocked: false,
      severity_escalated: true,
    };
  }

  return {
    speak: false,
    reason: "cooldown_active_same_trigger_no_escalation",
    chosen_trigger: chosen,
    cooldown_blocked: true,
    severity_escalated: false,
  };
}
