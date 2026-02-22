// ============================================================================
// src/components/baseball/types.ts
// Baseball-specific type extensions — composes with shared Match/Situation
// ============================================================================

/**
 * Pitch result taxonomy.
 * Maps 1:1 to MLB Statcast classifications.
 */
export type PitchResult =
    | 'swinging_strike'
    | 'called_strike'
    | 'foul'
    | 'ball'
    | 'hit'
    | 'hit_by_pitch'
    | 'in_play_out';

/**
 * Individual pitch event from the tracking feed.
 * Coordinates are 0-100 relative to the strike zone viewport.
 */
export interface PitchEvent {
    readonly x: number;
    readonly y: number;
    readonly result: PitchResult;
    readonly type: string;    // "Sinker", "Slider", "4-Seam", etc.
    readonly mph: number;
    readonly seq: number;     // 1-indexed within the at-bat
}

/**
 * Pitcher state for the current matchup display.
 */
export interface BaseballPitcher {
    readonly id?: string;
    readonly name: string;
    readonly shortName: string;   // "R. Ryan"
    readonly initials: string;    // "RR"
    readonly ip: string;          // "5.2"
    readonly pitchCount: number;
    readonly er: number;
    readonly k: number;
    readonly restDays?: number;
    readonly headshot?: string;
}

/**
 * Batter state for the current matchup display.
 */
export interface BaseballBatter {
    readonly id?: string;
    readonly name: string;
    readonly shortName: string;
    readonly initials: string;
    readonly todayLine: string;   // "1-3"
    readonly avg: string;         // ".287"
    readonly headshot?: string;
}

/**
 * Due-up player in the batting order.
 */
export interface DueUpPlayer {
    readonly name: string;
    readonly position: string;
    readonly bats: string;        // "R" | "L" | "S"
    readonly todayLine: string;
}

/**
 * A single cited input that generated an edge signal.
 * Without these, "edge" reads like vibes.
 */
export interface EdgeInput {
    readonly field: string;
    readonly value: string;
}

/**
 * One of the three convergence signals (Weather / Pitch Count / Bullpen).
 */
export interface BaseballEdgeSignal {
    readonly label: string;
    readonly value: string;
    readonly signal: 'high' | 'med' | 'low';
    readonly detail: string;
    readonly inputs: EdgeInput[];
}

/**
 * Full edge convergence payload — three signals that produce
 * a unified entry indicator when they align.
 */
export interface BaseballEdgeData {
    readonly weather: BaseballEdgeSignal;
    readonly pitchCount: BaseballEdgeSignal;
    readonly bullpen: BaseballEdgeSignal;
}

/**
 * Inning half — not present in the shared Situation interface.
 */
export type InningHalf = 'top' | 'bottom';

/**
 * Complete baseball-specific live data payload.
 * This extends (not replaces) the shared Match fields.
 * Sourced from the Supabase edge function.
 */
export interface BaseballLiveData {
    readonly matchId: string;
    readonly inningHalf: InningHalf;
    readonly pitcher: BaseballPitcher;
    readonly batter: BaseballBatter;
    readonly pitches: PitchEvent[];
    readonly dueUp: DueUpPlayer[];
    readonly edge?: BaseballEdgeData;
    readonly scoringPlays?: BaseballScoringPlay[];
    readonly asOfTs: number;       // Authoritative clock — never guess
    readonly oddsTs?: number;      // Last odds quote timestamp
}

/**
 * Scoring play for the scoring summary panel.
 */
export interface BaseballScoringPlay {
    readonly inningLabel?: string;  // "Top 3rd"
    readonly teamId: string;
    readonly teamAbbr: string;
    readonly description: string;
    readonly awayScore: number;
    readonly homeScore: number;
}

/**
 * Edge convergence tier derived from summing signal scores.
 */
export type ConvergenceTier = 'STRONG' | 'MODERATE' | 'WEAK';

/**
 * Compute convergence score from three signals.
 * Score mapping: high=3, med=2, low=1. Max=9, Min=3.
 * STRONG: 8-9, MODERATE: 5-7, WEAK: 3-4.
 */
export function computeConvergence(
    weather: BaseballEdgeSignal | undefined,
    pitchCount: BaseballEdgeSignal | undefined,
    bullpen: BaseballEdgeSignal | undefined,
): { score: number; tier: ConvergenceTier } {
    const SIGNAL_SCORES = { high: 3, med: 2, low: 1 } as const;
    const ws = weather ? SIGNAL_SCORES[weather.signal] : 1;
    const ps = pitchCount ? SIGNAL_SCORES[pitchCount.signal] : 1;
    const bs = bullpen ? SIGNAL_SCORES[bullpen.signal] : 1;
    const score = ws + ps + bs;
    const tier: ConvergenceTier = score >= 8 ? 'STRONG' : score >= 5 ? 'MODERATE' : 'WEAK';
    return { score, tier };
}

/**
 * Correct ordinal suffix for any inning number.
 * Handles 11th, 12th, 13th (the "teens" exception).
 */
export function ordinalSuffix(n: number): string {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return 'th';
    const mod10 = n % 10;
    if (mod10 === 1) return 'st';
    if (mod10 === 2) return 'nd';
    if (mod10 === 3) return 'rd';
    return 'th';
}

/**
 * Format inning display: "TOP 7TH", "BOT 3RD"
 */
export function formatInning(inning: number, half: InningHalf): string {
    const prefix = half === 'top' ? 'TOP' : 'BOT';
    return `${prefix} ${inning}${ordinalSuffix(inning).toUpperCase()}`;
}

/**
 * Staleness threshold for odds quotes (ms).
 */
export const ODDS_STALE_MS = 30_000;

/**
 * Check if a timestamp is stale relative to now.
 */
export function isStaleTs(ts: number | undefined, thresholdMs = ODDS_STALE_MS): boolean {
    if (!ts) return true;
    return Date.now() - ts > thresholdMs;
}

/**
 * Relative time display: "4s ago", "2m ago", "1h ago"
 */
export function relativeTime(ts: number | undefined): string {
    if (!ts) return '---';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
}
