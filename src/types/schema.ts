
import { Sport } from './index.ts';

/**
 * DATABASE SCHEMA PROPOSAL
 * 
 * To power the "PreGame Edge" with true predictive capability, 
 * we need to move beyond snapshots and store longitudinal data.
 * 
 * This schema defines the tables required to track:
 * 1. Smart Money Movement (Reverse Line Movement)
 * 2. Team Situational Performance (Home/Away/Rest splits)
 * 3. Model Accuracy (Verifying our Edge)
 */

// ============================================================================
// 1. Odds & Line Movement History
// Purpose: Detect "Steam Moves" and "Smart Money" by tracking line changes over time.
// ============================================================================

export interface OddsHistoryRow {
    id: string;                 // UUID
    match_id: string;          // Foreign Key to matches
    bookmaker_key: string;      // e.g. 'pinnacle' (sharpest book)
    timestamp: string;          // ISO 8601

    // Spread
    home_spread: number;        // e.g. -5.5
    home_spread_price: number;  // e.g. -110 (American)
    away_spread: number;
    away_spread_price: number;

    // Moneyline
    home_ml: number;
    away_ml: number;

    // Total
    total: number;              // e.g. 212.5
    over_price: number;
    under_price: number;

    is_pregame: boolean;        // true if detecting pregame moves
}

// ============================================================================
// 2. Betting Splits (Public vs Sharp)
// Purpose: Track where the public is vs where the money is.
// High Money % + Low Ticket % = SHARP ACTION.
// ============================================================================

export interface BettingSplitsRow {
    id: string;
    match_id: string;
    timestamp: string;
    source: string;             // e.g. 'draftkings_public'

    // Spread Splits
    spread_tickets_home_pct: number; // % of bets on home
    spread_money_home_pct: number;   // % of handle on home

    // Total Splits
    total_over_tickets_pct: number;
    total_over_money_pct: number;

    // Identification
    is_contrarian: boolean;     // Flag if money opposes tickets significantly (>15% gap)
}

// ============================================================================
// 3. Situational Team Stats (Rolling)
// Purpose: Context-aware stats. "Lakers on 0 days rest on the road".
// ============================================================================

export interface TeamSituationalStatsRow {
    team_id: string;
    sport: Sport;
    date: string;               // Snapshot date

    // Contexts
    context_type: 'HOME' | 'AWAY' | 'BACK_TO_BACK' | 'RESTED_3+_DAYS';
    sample_size: number;        // Number of games in this context

    // Key Metrics (ATS = Against The Spread)
    ats_wins: number;
    ats_losses: number;
    ats_win_pct: number;

    avg_margin: number;         // Average point differential
    avg_total_score: number;    // For Over/Under modeling

    // Four Factors (Universal)
    effective_fg_pct?: number;
    turnover_rate?: number;
    off_rebound_pct?: number;
    free_throw_rate?: number;
}

// ============================================================================
// 4. Model Predictions & Verification
// Purpose: Track if the "Edge" is actually winning. 
// Essential for displaying "Model Record: 14-3 L17" confidently.
// ============================================================================

export interface ModelPredictionRow {
    id: string;
    match_id: string;
    model_version: string;      // e.g. 'v2.1-haralabos'
    created_at: string;

    // The Pick
    pick_team_id?: string;
    pick_market: 'SPREAD' | 'MONEYLINE' | 'TOTAL_OVER' | 'TOTAL_UNDER';
    pick_line: number;          // The line at time of pick (e.g. -6.5)
    pick_odds: number;          // e.g. -110

    confidence_score: number;   // 0-100
    expected_value: number;     // e.g. +4.5%

    // Reasoning
    primary_factor: string;     // e.g. 'Reverse Line Movement'

    // Outcome (Updated after game)
    result: 'WON' | 'LOST' | 'PUSH' | 'PENDING';
    profit_units: number;       // e.g. +0.91 or -1.0
}

/* 
-- SUGGESTED SQL MIGRATION --

CREATE TABLE odds_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID REFERENCES matches(id),
    bookmaker_key TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    home_spread NUMERIC,
    home_spread_price NUMERIC,
    total NUMERIC,
    is_pregame BOOLEAN DEFAULT true
);

CREATE TABLE betting_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID REFERENCES matches(id),
    spread_tickets_home_pct NUMERIC,
    spread_money_home_pct NUMERIC,
    is_contrarian BOOLEAN GENERATED ALWAYS AS (ABS(spread_money_home_pct - spread_tickets_home_pct) > 15) STORED
);

CREATE TABLE model_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID REFERENCES matches(id),
    model_version TEXT,
    pick_market TEXT,
    result TEXT DEFAULT 'PENDING'
);
*/
