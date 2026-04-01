// -------------------------------------------------------------------------
// MODULE: INTEL GUARDS (SERVER-SIDE EDITOR)
// -------------------------------------------------------------------------

const NERD_WORDS = [
  "fair line",
  "delta",
  "dislocation",
  "priors",
  "projected",
  "expected value",
  "expected",
  "ev",
  "clv",
  "regression",
  "algorithm",
  "kernel",
  "confidence",
  "system",
  "framework",
  "variance",
  "model",
  "probability",
  "pricing",
  "signal",
];

const HEADLINE_FALLBACKS = [
  "Prime spot for {team} tonight",
  "Setup favors {team} in this matchup",
  "Why the value is on {team} today",
  "{team} set up well in this spot",
  "Points look mispriced on {team}",
  "Lean: {team} in this matchup",
];

function escapeRegexLiteral(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Sort by length DESC so "expected value" matches before "expected"
const SORTED_TERMS = [...NERD_WORDS].sort((a, b) => b.length - a.length);
const NERD_REGEX = new RegExp(
  `\\b(${SORTED_TERMS.map(escapeRegexLiteral).join("|")})\\b`,
  "gi"
);

function getStableIndex(str: string, max: number): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash += str.charCodeAt(i);
  return Math.abs(hash) % max;
}

function polishGrammar(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/\s([,.!?;:])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/,\s*,+/g, ",")
    .trim();
}

export function cleanHeadline(raw: string, team: string): string {
  if (!raw) return "";

  NERD_REGEX.lastIndex = 0;
  const isContaminated = NERD_REGEX.test(raw);
  const isTooLong = raw.length > 85;
  const hasColon = raw.includes(":");

  if (isContaminated || isTooLong || hasColon) {
    const index = getStableIndex(team || "team", HEADLINE_FALLBACKS.length);
    return HEADLINE_FALLBACKS[index].replace("{team}", team || "this side");
  }

  return raw.replace(/["']/g, "").trim();
}

export function cleanCardThesis(category: string, thesis: string): string {
  if (!thesis) return "";

  // Safe zone for math/engine terms
  if (category === "The Engine") return thesis;

  let clean = thesis.replace(NERD_REGEX, "");
  clean = polishGrammar(clean);

  if (clean.length < 15) return "The numbers favor this side.";

  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
