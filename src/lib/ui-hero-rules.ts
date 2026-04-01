// lib/ui-hero-rules.ts
// Purpose: lock hero behavior without redesigning UI.

export type HeroViewModel = {
    label: string;        // "Today's Edge"
    pickLine: string;     // "Indiana Pacers +1.5 (-110)"
    headline: string;     // "Massive Value on Pacers as Home Underdogs"
    confidence?: "High" | "Med" | "Low" | string; // exists in data, but MUST NOT render in hero
};

export function buildHeroVM(input: HeroViewModel): HeroViewModel {
    // Hard rule: never show confidence in hero.
    // Keep it in data for downstream sections/dev panel.
    const { confidence, ...rest } = input;
    return { ...rest };
}
