/**
 * Core engine for calculating sports betting outcomes (Spread and Total).
 * Determines if a team covered the spread and if the total score went Over/Under.
 */

import { Match, MatchOdds, MatchStatus } from '@/types';
import { BettingResult, SpreadResult, TotalResult } from '@/types/matchList';

// MARK: - Constants

const PICK_EM = 'PK';

// MARK: - Parsing

/**
 * Parses a betting line from various formats into a number.
 * Handles: numeric inputs, "PK", O/U prefixes, and non-bettable indicators.
 */
const parseLine = (line?: string | number | null): number | null => {
  if (line === null || line === undefined) return null;

  // Handle numeric inputs directly
  if (typeof line === 'number') {
    return Number.isFinite(line) ? line : null;
  }

  const sanitized = line.trim().toUpperCase();

  // Non-bettable indicators
  if (sanitized === '' || sanitized === '-' || sanitized === 'EVEN' || sanitized === 'N/A') {
    return null;
  }

  // Pick'em
  if (sanitized === PICK_EM || sanitized === '0') return 0;

  // Extract numeric value (handles O/U prefixes, +/- signs)
  const match = sanitized.match(/([+-]?\d+(\.\d+)?)/);
  if (!match) return null;

  const value = parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
};

/**
 * Synthesizes the inverse line string when explicit inverse is unavailable.
 * Example: -3.5 → "+3.5", 0 → "PK"
 */
const synthesizeInverse = (line: number): string => {
  if (line === 0) return PICK_EM;
  const inverse = -line;
  return inverse > 0 ? `+${inverse}` : `${inverse}`;
};

// MARK: - Outcome Calculators

/**
 * Calculates spread outcome using home team as reference.
 * Formula: Margin = (HomeScore + HomeSpread) - AwayScore
 */
const calculateSpread = (
  homeScore: number,
  awayScore: number,
  odds: MatchOdds,
  homeTeamId: string,
  awayTeamId: string
): SpreadResult | null => {
  const homeLine = parseLine(odds.homeSpread);
  if (homeLine === null) return null;

  const margin = homeScore + homeLine - awayScore;

  if (margin === 0) {
    return { covered: false, line: String(odds.homeSpread), isPush: true, teamId: '' };
  }

  if (margin > 0) {
    return { covered: true, line: String(odds.homeSpread), isPush: false, teamId: homeTeamId };
  }

  return {
    covered: true,
    line: odds.awaySpread !== undefined ? String(odds.awaySpread) : synthesizeInverse(homeLine),
    isPush: false,
    teamId: awayTeamId,
  };
};

/**
 * Calculates total (Over/Under) outcome.
 */
const calculateTotal = (
  homeScore: number,
  awayScore: number,
  odds: MatchOdds
): TotalResult | null => {
  const totalLine = parseLine(odds.overUnder ?? odds.over);
  if (totalLine === null) return null;

  const actual = homeScore + awayScore;

  if (actual === totalLine) return { hit: 'PUSH', line: totalLine, actual } as const;
  if (actual > totalLine) return { hit: 'OVER', line: totalLine, actual } as const;
  return { hit: 'UNDER', line: totalLine, actual } as const;
};

// MARK: - Primary Interface

/**
 * Analyzes a finished match to determine spread and total bet outcomes.
 *
 * @param match - Match object with final scores, status, and odds.
 * @returns BettingResult or null if match unfinished/missing data.
 */
export const calculateBettingOutcome = (match: Match): BettingResult | null => {
  if (match.status !== MatchStatus.FINISHED || !match.odds) return null;

  const { homeScore, awayScore, odds, homeTeam, awayTeam } = match;

  // Validate scores
  if (typeof homeScore !== 'number' || typeof awayScore !== 'number') return null;
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;

  const spread = calculateSpread(homeScore, awayScore, odds, homeTeam.id, awayTeam.id);
  const total = calculateTotal(homeScore, awayScore, odds);

  if (!spread && !total) return null;

  return { spread, total };
};