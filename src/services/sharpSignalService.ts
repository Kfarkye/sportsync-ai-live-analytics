
// services/sharpSignalService.ts
// Sharp Edge Contrarian Signal Detection System

import { supabase } from '../lib/supabase';

// ============================================================================
// TYPES
// ============================================================================

export type SportType = 'NFL' | 'NCAAF' | 'NBA' | 'MLB' | 'NHL' | string;
export type SignalSide = 'home' | 'away' | 'neutral';
export type MovementDirection = 'toward_home' | 'toward_away' | 'static';

export interface SharpSignal {
  match_id: string;

  // RLM
  rlm_detected: boolean;
  rlm_strength: number;
  rlm_type: 'CLASSIC_FADE' | 'STEAM' | null;

  // PvJ
  pvj_detected: boolean;
  pvj_discrepancy: number;

  // Synthesis
  inferred_sharp_side: SignalSide;
  sharp_confidence: number;

  // Market Context
  public_side: SignalSide;
  public_pct: number; // Ticket count %
  money_pct: number;  // Money handle %
  line_move_magnitude: number;
  line_move_direction: MovementDirection;
  opening_spread: number;
  current_spread: number;

  // Key Numbers
  key_number_crossed: boolean;
  key_number_significance: number;

  // Output
  contrarian_modifier: number;
  flags: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const NFL_KEY_NUMBERS: Record<number, number> = {
  3: 1.0,    // Field goal - most common margin
  7: 0.85,   // Touchdown
  6: 0.60,   // TD no XP
  10: 0.55,  // TD + FG
  4: 0.50,   // FG + safety / key hook
  14: 0.45,  // Two TDs
  1: 0.40,   // XP difference
  17: 0.35,  // Two TDs + FG
};

const NBA_KEY_NUMBERS: Record<number, number> = {
  5: 0.50,
  6: 0.45,
  7: 0.55,
  8: 0.40,
};

const THRESHOLDS = {
  RLM_PUBLIC_PCT_MIN: 55,           // Minimum public % to consider RLM
  RLM_LINE_MOVE_MIN: 1.0,           // Minimum points moved
  RLM_STRONG_PUBLIC_PCT: 65,        // Strong public lean
  RLM_LARGE_MOVE: 2.0,              // Large line movement

  PVJ_DISCREPANCY_MIN: 10,          // Minimum ticket/money split difference
  PVJ_STRONG_DISCREPANCY: 20,       // Strong divergence

  STEAM_MOVE_THRESHOLD: 1.5,        // Points moved quickly = steam
  STEAM_TIME_WINDOW_HOURS: 2,       // Time window for steam detection
};

// ============================================================================
// CORE DETECTION FUNCTIONS
// ============================================================================

/**
 * Detect Reverse Line Movement (RLM)
 * RLM occurs when public bets heavily on one side but the line moves opposite
 */
export const detectRLM = (
  openingSpread: number,
  currentSpread: number,
  publicHomePct: number
): { detected: boolean; strength: number; type: 'CLASSIC_FADE' | 'STEAM' | null; direction: MovementDirection } => {

  const publicAwayPct = 100 - publicHomePct;

  // Line movement: positive = moved toward home (home getting more points/less favored)
  // Example: opened -5.5, now -3.5 -> movement = +2 (Home went from -5.5 to -3.5, getting easier)
  // Wait, standard spread logic: 
  // -5.5 to -3.5 means Home got WORSE odds? No, Home got MORE points (closer to 0).
  // Movement calculation: Current - Opening
  // -3.5 - (-5.5) = +2.0. 
  // If line moves POSITIVE, it moves TOWARD HOME (Home spread increases).
  const lineMove = currentSpread - openingSpread;
  const lineMoveAbs = Math.abs(lineMove);

  // Determine directions
  // If Spread increases (e.g. -5 to -3), betting moved TOWARD AWAY (Taking points away from Away, giving to Home)
  // If Spread decreases (e.g. -5 to -7), betting moved TOWARD HOME (Home giving more points)

  // Let's standardize:
  // If line moves e.g. -3 to -5. Market moved TOWARD HOME (Home is stronger).
  // -5 < -3. So if Current < Opening, move is Toward Home.
  // If line moves e.g. -3 to -1. Market moved TOWARD AWAY (Away is stronger).
  // -1 > -3. So if Current > Opening, move is Toward Away.

  const lineMoveDirection: MovementDirection =
    lineMove < -0.25 ? 'toward_home' :
      lineMove > 0.25 ? 'toward_away' : 'static';

  // Determine public side
  const publicSide: SignalSide =
    publicHomePct > 52 ? 'home' :
      publicAwayPct > 52 ? 'away' : 'neutral';

  const publicPct = Math.max(publicHomePct, publicAwayPct);

  // RLM Detection Logic
  let detected = false;
  let strength = 0;
  let type: 'CLASSIC_FADE' | 'STEAM' | null = null;

  if (publicPct >= THRESHOLDS.RLM_PUBLIC_PCT_MIN && lineMoveAbs >= THRESHOLDS.RLM_LINE_MOVE_MIN) {

    // Classic RLM: Line moves AGAINST public
    const publicOnHome = publicSide === 'home';
    const lineMovedTowardAway = lineMoveDirection === 'toward_away';
    const lineMovedTowardHome = lineMoveDirection === 'toward_home';

    // If Public on Home (High Ticket %) BUT Line moved Toward Away (Home spread got easier / Away spread got harder)
    // Wait, if Public is on Home, books should move line Toward Home (e.g. -3 to -5) to balance.
    // RLM is if Public on Home, but line moves Toward Away (e.g. -3 to -1).

    if ((publicOnHome && lineMovedTowardAway) || (!publicOnHome && lineMovedTowardHome)) {
      detected = true;
      type = 'CLASSIC_FADE';

      // Strength calculation
      const publicLeanFactor = (publicPct - 50) / 50;
      const moveFactor = Math.min(lineMoveAbs / 3, 1);
      strength = publicLeanFactor * moveFactor;

      if (publicPct >= THRESHOLDS.RLM_STRONG_PUBLIC_PCT) strength *= 1.2;
      if (lineMoveAbs >= THRESHOLDS.RLM_LARGE_MOVE) strength *= 1.15;

      strength = Math.min(strength, 1.0);
    }
  }

  return { detected, strength, type, direction: lineMoveDirection };
};

export const detectPvJ = (
  publicTicketHomePct: number | null,
  moneyHomePct: number | null
): { detected: boolean; discrepancy: number; sharpSide: SignalSide } => {

  if (publicTicketHomePct === null || moneyHomePct === null) {
    return { detected: false, discrepancy: 0, sharpSide: 'neutral' };
  }

  const discrepancy = moneyHomePct - publicTicketHomePct;
  const discrepancyAbs = Math.abs(discrepancy);

  let detected = false;
  let sharpSide: SignalSide = 'neutral';

  if (discrepancyAbs >= THRESHOLDS.PVJ_DISCREPANCY_MIN) {
    detected = true;
    sharpSide = discrepancy > 0 ? 'home' : 'away';
  }

  const normalizedDiscrepancy = Math.min(discrepancyAbs / 40, 1.0);

  return { detected, discrepancy: normalizedDiscrepancy, sharpSide };
};

export const detectKeyNumberCross = (
  openingSpread: number,
  currentSpread: number,
  sport: SportType
): { crossed: boolean; significance: number; numbers: number[] } => {

  const keyNumbers = (sport === 'NFL' || sport === 'NCAAF')
    ? NFL_KEY_NUMBERS
    : (sport === 'NBA')
      ? NBA_KEY_NUMBERS
      : {};

  if (Object.keys(keyNumbers).length === 0) {
    return { crossed: false, significance: 0, numbers: [] };
  }

  const openAbs = Math.abs(openingSpread);
  const currentAbs = Math.abs(currentSpread);
  const [low, high] = [Math.min(openAbs, currentAbs), Math.max(openAbs, currentAbs)];

  const crossedNumbers: number[] = [];
  let maxSignificance = 0;

  for (const [numStr, significance] of Object.entries(keyNumbers)) {
    const num = parseFloat(numStr);

    // Check if key number is between open and current or traversed through
    if ((openAbs >= num && currentAbs < num) || (openAbs < num && currentAbs >= num)) {
      if (!crossedNumbers.includes(num)) crossedNumbers.push(num);
      maxSignificance = Math.max(maxSignificance, significance);
    }
  }

  return {
    crossed: crossedNumbers.length > 0,
    significance: maxSignificance,
    numbers: crossedNumbers.sort((a, b) => (keyNumbers[b] || 0) - (keyNumbers[a] || 0))
  };
};

export const detectSteam = async (
  matchId: string,
  source: string,
  hoursBack: number = THRESHOLDS.STEAM_TIME_WINDOW_HOURS
): Promise<{ detected: boolean; magnitude: number; direction: MovementDirection }> => {

  // Real implementation requires standard `line_history` table access.
  return { detected: false, magnitude: 0, direction: 'static' };
};

// 242: // SYNTHESIS & REAL-WORLD DATA MAPPING
// 243: // ============================================================================

export const computeSharpSignal = async (
  matchId: string,
  sport: SportType,
  source: string = 'consensus'
): Promise<SharpSignal | null> => {

  try {
    // 1. Try Fetch Real Data
    const { data: opening } = await supabase
      .from('opening_lines')
      .select('*')
      .eq('match_id', matchId)
      .eq('source', source)
      .maybeSingle();

    const { data: latest } = await supabase
      .from('line_history')
      .select('*')
      .eq('match_id', matchId)
      .eq('source', source)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!opening || !latest) {
      // Only return real data matches. If Opening or Latest is missing, we cannot verify RLM/Sharpness.
      return null;
    }

    // 2. Compute Logic (Real Data)
    const rlm = detectRLM(
      opening.home_spread ?? 0,
      latest.home_spread ?? 0,
      latest.public_spread_home_pct ?? 50
    );

    const pvj = detectPvJ(
      latest.public_spread_home_pct,
      latest.money_spread_home_pct
    );

    const keyNum = detectKeyNumberCross(
      opening.home_spread ?? 0,
      latest.home_spread ?? 0,
      sport
    );

    let sharpSide: SignalSide = 'neutral';
    let sharpConfidence = 0;
    const flags: string[] = [];

    if (pvj.detected) {
      sharpSide = pvj.sharpSide;
      sharpConfidence = 0.3 + (pvj.discrepancy * 0.4);
      flags.push('PVJ_DIVERGENCE');
    }

    if (rlm.detected) {
      const rlmSharpSide: SignalSide = rlm.direction === 'toward_home' ? 'home' : 'away';
      if (sharpSide === 'neutral') {
        sharpSide = rlmSharpSide;
        sharpConfidence = 0.2 + (rlm.strength * 0.3);
      } else if (sharpSide === rlmSharpSide) {
        sharpConfidence += rlm.strength * 0.25;
        flags.push('PVJ_RLM_CONFIRM');
      }
      flags.push('RLM_DETECTED');
    }

    if (keyNum.crossed) {
      flags.push('KEY_NUMBER');
      sharpConfidence += 0.1;
    }

    sharpConfidence = Math.min(sharpConfidence, 1.0);

    const publicHomePct = latest.public_spread_home_pct ?? 50;
    const publicSide: SignalSide = publicHomePct > 55 ? 'home' : publicHomePct < 45 ? 'away' : 'neutral';

    return {
      match_id: matchId,
      rlm_detected: rlm.detected,
      rlm_strength: rlm.strength,
      rlm_type: rlm.type,
      pvj_detected: pvj.detected,
      pvj_discrepancy: pvj.discrepancy,
      inferred_sharp_side: sharpSide,
      sharp_confidence: sharpConfidence,
      public_side: publicSide,
      public_pct: Math.max(publicHomePct, 100 - publicHomePct),
      money_pct: latest.money_spread_home_pct ?? publicHomePct, // Fallback
      line_move_magnitude: Math.abs((latest.home_spread ?? 0) - (opening.home_spread ?? 0)),
      line_move_direction: rlm.direction,
      opening_spread: opening.home_spread ?? 0,
      current_spread: latest.home_spread ?? 0,
      key_number_crossed: keyNum.crossed,
      key_number_significance: keyNum.significance,
      contrarian_modifier: 0,
      flags
    };

  } catch (e) {
    console.error("Critical: Sharp Signal acquisition failed for", matchId, e);
    return null;
  }
};
