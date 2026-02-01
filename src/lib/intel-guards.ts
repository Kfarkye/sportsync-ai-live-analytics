// lib/intel-guards.ts
// Purpose: Keep bettor-facing copy clean without changing your layout.
// Rules:
// - Hero headline: NEVER contains engine words; fallback to clean templates.
// - Cards: allow engine speak ONLY inside category === "The Engine" (configurable).
// - Prevent false positives (Scunthorpe bug) and partial phrase matching issues.
// - Avoid per-render regex compilation; compile once.
// - Polish grammar scars after extraction.

export type IntelCard = {
    category: string;
    thesis: string;
};

type GuardConfig = {
    engineSafeCategory: string;        // Only this category can contain engine terms
    maxHeroHeadlineLen: number;        // Hard cutoff
    heroDisallowColon: boolean;        // ":" makes it feel like a report
    minCleanThesisLen: number;         // If extraction nukes sentence, fallback
};

const CONFIG: GuardConfig = {
    engineSafeCategory: "The Engine",
    maxHeroHeadlineLen: 85,
    heroDisallowColon: true,
    minCleanThesisLen: 15,
};

// ----------------------------------------------------------------------------
// 1) ENGINE TERMS (remove from bettor-facing zones)
// ----------------------------------------------------------------------------

const ENGINE_TERMS = [
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

// Hero headline fallbacks: clean, bettor-readable, no engine language.
const HERO_FALLBACKS = [
    "Prime spot for {team} tonight",
    "Setup favors {team} in this matchup",
    "Why the value is on {team} today",
    "{team} set up well in this spot",
    "Points look mispriced on {team}",
    "Lean: {team} in this matchup",
];

// ----------------------------------------------------------------------------
// 2) REGEX BUILD (fix Scunthorpe + partial phrase match)
// ----------------------------------------------------------------------------

function escapeRegexLiteral(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Sort by length DESC so phrases win before single words.
const SORTED_ENGINE_TERMS = [...ENGINE_TERMS].sort((a, b) => b.length - a.length);

// Word boundary handling:
// - For multi-word phrases, boundaries around the first/last token are fine.
// - For short tokens like "ev", boundary is critical to avoid "several"/"level".
const ENGINE_REGEX = new RegExp(
    `\\b(${SORTED_ENGINE_TERMS.map(escapeRegexLiteral).join("|")})\\b`,
    "gi"
);

// ----------------------------------------------------------------------------
// 3) STABLE FALLBACK PICKER (deterministic per team)
// ----------------------------------------------------------------------------

function getStableIndex(str: string, max: number): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash += str.charCodeAt(i);
    return Math.abs(hash) % max;
}

// ----------------------------------------------------------------------------
// 4) GRAMMAR POLISH (remove scars after deletions)
// ----------------------------------------------------------------------------

function polishGrammar(input: string): string {
    return (
        input
            // Collapse whitespace
            .replace(/\s+/g, " ")
            // Remove space before punctuation
            .replace(/\s([,.!?;:])/g, "$1")
            // Normalize repeated periods
            .replace(/\.{2,}/g, ".")
            // Fix dangling commas like ", ,"
            .replace(/,\s*,+/g, ",")
            // Trim
            .trim()
    );
}

function stripQuotes(input: string): string {
    return input.replace(/["']/g, "").trim();
}

// ----------------------------------------------------------------------------
// 5) HERO HEADLINE GUARD (NO ENGINE WORDS; NO CONFIDENCE; NO REPORTY PUNCT)
// ----------------------------------------------------------------------------

export function cleanHeadline(raw: string, team: string): string {
    if (!raw) return "";

    ENGINE_REGEX.lastIndex = 0;
    const contaminated = ENGINE_REGEX.test(raw);

    const tooLong = raw.length > CONFIG.maxHeroHeadlineLen;
    const hasColon = CONFIG.heroDisallowColon ? raw.includes(":") : false;

    if (contaminated || tooLong || hasColon) {
        const idx = getStableIndex(team || "team", HERO_FALLBACKS.length);
        return HERO_FALLBACKS[idx].replace("{team}", team || "this side");
    }

    return stripQuotes(raw);
}

// ----------------------------------------------------------------------------
// 6) CARD THESIS GUARD (banned terms removed unless "The Engine")
// ----------------------------------------------------------------------------

export function cleanCardThesis(category: string, thesis: string): string {
    if (!thesis) return "";

    // Engine-safe zone: keep the exact text. No scrubbing.
    if (category === CONFIG.engineSafeCategory) return thesis;

    // Remove engine terms
    let clean = thesis.replace(ENGINE_REGEX, "");

    // Polish scars
    clean = polishGrammar(clean);

    // If we nuked meaning, use a clean bettor-facing fallback (no engine language).
    if (clean.length < CONFIG.minCleanThesisLen) {
        return "The numbers favor this side.";
    }

    // Ensure first letter is capitalized (in case deletion removed the first word)
    return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// ----------------------------------------------------------------------------
// 7) VALIDATION (dev-only enforcement)
// ----------------------------------------------------------------------------

export function validateCardThesis(card: IntelCard): boolean {
    if (card.category === CONFIG.engineSafeCategory) return true;

    ENGINE_REGEX.lastIndex = 0;
    const contaminated = ENGINE_REGEX.test(card.thesis);

    if (contaminated) {
        if (process.env.NODE_ENV === "development") {
            // eslint-disable-next-line no-console
            console.warn(`[Guard] Engine contamination in "${card.category}":`, card.thesis);
        }
        return false;
    }

    return true;
}

// ----------------------------------------------------------------------------
// 8) OPTIONAL: helper to scrub an array of cards in one pass
// ----------------------------------------------------------------------------

export function cleanCards(cards: IntelCard[]): IntelCard[] {
    return cards.map((c) => ({
        ...c,
        thesis: cleanCardThesis(c.category, c.thesis),
    }));
}
