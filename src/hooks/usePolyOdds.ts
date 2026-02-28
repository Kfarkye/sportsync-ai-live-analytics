/**
 * usePolyOdds — Polymarket probability data hook
 *
 * Fetches real-money prediction market probabilities from the poly_odds table.
 * Polymarket share prices ARE probabilities — no vig, no conversion.
 * $0.58 share = 58% implied probability.
 *
 * Returns probabilities keyed by game_id for O(1) lookup in MatchRow.
 * Falls back gracefully to ESPN win_probability when poly data unavailable.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PolyOdds {
  game_id: string | null;
  home_team_name: string;
  away_team_name: string;
  home_prob: number;       // 0.0000 – 1.0000
  away_prob: number;       // 0.0000 – 1.0000
  draw_prob: number | null;
  volume: number;          // Total USD volume traded
  volume_24h: number;      // 24h volume
  local_league_id: string;
  game_start_time: string;
  poly_event_slug: string;
  poly_updated_at: string;
}

export interface PolyOddsMap {
  [gameId: string]: PolyOdds;
}

/** Full result from usePolyOdds — map for O(1) lookup + rows for fuzzy matching */
export interface PolyOddsResult {
  map: PolyOddsMap;
  rows: PolyOdds[];
}

// ── Conversion utils ───────────────────────────────────────────────────────

/** Convert 0–1 probability to display percentage (0–100) */
export function polyProbToPercent(prob: number): number {
  return Math.round(prob * 100);
}

/** Convert 0–1 probability to American odds string */
export function polyProbToAmerican(prob: number): string {
  if (prob <= 0 || prob >= 1) return '-';
  if (prob >= 0.5) {
    return String(Math.round(-(prob / (1 - prob)) * 100));
  }
  return `+${Math.round(((1 - prob) / prob) * 100)}`;
}

/**
 * Calculate edge: divergence between Polymarket probability and sportsbook implied probability.
 * Positive edge = Polymarket thinks team is MORE likely than books imply.
 * This is the actionable intelligence sharp bettors pay for.
 */
export function calcEdge(polyProb: number, bookImpliedProb: number): number {
  return Math.round((polyProb - bookImpliedProb) * 1000) / 10; // e.g. +5.6
}

/** Convert American odds to implied probability (includes vig) */
export function americanToImpliedProb(odds: number): number {
  if (odds === 0) return 0;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

// ── Team name normalization (mirrors edge function logic) ────────────────

function normalizeTeam(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^the/, '');
}

function teamsMatch(polyName: string, matchName: string): boolean {
  const pn = normalizeTeam(polyName);
  const mn = normalizeTeam(matchName);
  return pn.includes(mn) || mn.includes(pn);
}

// ── Hook ───────────────────────────────────────────────────────────────────

interface UsePolyOddsOptions {
  leagueId?: string;
  enabled?: boolean;
}

export function usePolyOdds(options: UsePolyOddsOptions = {}) {
  const { leagueId, enabled = true } = options;

  return useQuery<PolyOddsResult>({
    queryKey: ['poly-odds', leagueId || 'all'],
    queryFn: async () => {
      if (!isSupabaseConfigured()) return { map: {}, rows: [] };

      let query = supabase
        .from('v_poly_moneyline')
        .select('*')
        .not('home_team_name', 'in', '("Over","Under","Yes","No")')
        .order('game_start_time', { ascending: true });

      if (leagueId) {
        query = query.eq('local_league_id', leagueId);
      }

      const { data, error } = await query;

      if (error) {
        console.warn('[usePolyOdds] Query error:', error.message);
        return { map: {}, rows: [] };
      }

      const rows: PolyOdds[] = data || [];
      const map: PolyOddsMap = {};
      for (const row of rows) {
        if (row.game_id) {
          const existing = map[row.game_id];
          // Keep highest-volume moneyline per game (multiple markets exist)
          if (!existing || (row.volume ?? 0) > (existing.volume ?? 0)) {
            map[row.game_id] = row;
          }
        }
      }

      return { map, rows };
    },
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,       // Fresh for 30s (Polymarket updates frequently)
    refetchInterval: 60_000, // Re-poll every 60s
    placeholderData: (prev) => prev,  // Keep stale data while refetching
  });
}

// ── Oriented match result ─────────────────────────────────────────────────

/** Poly data oriented to the caller's home/away designation */
export interface PolyMatchOriented {
  raw: PolyOdds;
  /** Probability for caller's home team (0–1) */
  homeProb: number;
  /** Probability for caller's away team (0–1) */
  awayProb: number;
  /** Draw probability if applicable */
  drawProb: number | null;
  /** True if Polymarket's home ≠ ESPN's home */
  flipped: boolean;
  volume: number;
  gameStartTime: string;
}

/**
 * Find poly data for a match — tries game_id first, then fuzzy team-name match.
 * Returns probabilities ORIENTED to the caller's home/away, detecting flips.
 */
export function findPolyForMatch(
  polyResult: PolyOddsResult | undefined,
  matchId: string | undefined,
  homeTeamName: string | undefined,
  awayTeamName: string | undefined,
): PolyMatchOriented | null {
  if (!polyResult) return null;

  // Fast path: direct game_id lookup
  let row = matchId ? polyResult.map[matchId] : undefined;
  let flipped = false;

  if (!row && homeTeamName && awayTeamName) {
    // Slow path: fuzzy team-name match
    for (const candidate of polyResult.rows) {
      // Direct orientation: poly_home ↔ espn_home, poly_away ↔ espn_away
      const directHome = teamsMatch(candidate.home_team_name, homeTeamName);
      const directAway = teamsMatch(candidate.away_team_name, awayTeamName);
      if (directHome && directAway) {
        row = candidate;
        flipped = false;
        break;
      }
      // Flipped orientation: poly_home ↔ espn_away, poly_away ↔ espn_home
      const flipHome = teamsMatch(candidate.home_team_name, awayTeamName);
      const flipAway = teamsMatch(candidate.away_team_name, homeTeamName);
      if (flipHome && flipAway) {
        row = candidate;
        flipped = true;
        break;
      }
    }
  }

  if (!row) return null;

  return {
    raw: row,
    homeProb: flipped ? row.away_prob : row.home_prob,
    awayProb: flipped ? row.home_prob : row.away_prob,
    drawProb: row.draw_prob,
    flipped,
    volume: row.volume,
    gameStartTime: row.game_start_time,
  };
}

// ── Merged probability accessor ────────────────────────────────────────────

/**
 * Get best available probability for a match.
 * Priority: Polymarket (real money) > ESPN (model estimate)
 * Returns 0–100 percentage.
 */
export function getMatchProb(
  polyResult: PolyOddsResult | undefined,
  matchId: string | undefined,
  side: 'home' | 'away',
  espnFallback?: number,
  homeTeamName?: string,
  awayTeamName?: string,
): number | undefined {
  const poly = findPolyForMatch(polyResult, matchId, homeTeamName, awayTeamName);
  if (poly) {
    return polyProbToPercent(side === 'home' ? poly.homeProb : poly.awayProb);
  }
  return espnFallback;
}

/**
 * Get poly-specific data for edge calculations.
 * Returns null if no poly data available for this game.
 */
export function getPolyData(
  polyResult: PolyOddsResult | undefined,
  matchId: string | undefined,
  homeTeamName?: string,
  awayTeamName?: string,
): PolyMatchOriented | null {
  return findPolyForMatch(polyResult, matchId, homeTeamName, awayTeamName);
}

export default usePolyOdds;
