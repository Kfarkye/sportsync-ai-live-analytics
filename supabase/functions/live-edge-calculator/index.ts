// Fix: Add Deno global declaration for TypeScript compatibility
declare const Deno: any;

/**
 * LIVE EDGE CALCULATOR
 * 
 * Deterministic service that computes live pace, efficiency, and price breaks.
 * This is the execution spine - UI is just a read-only projection of these outputs.
 * 
 * Core Variables:
 * - P_live: Live possessions/plays per minute
 * - E_live: Live points per possession
 * - P_expected: Pregame expected pace
 * - E_expected: Pregame expected efficiency
 * - R_real: Actual scoring rate (P_live × E_live)
 * - R_market: Market-implied scoring rate (I / T)
 * - R_expected: Expected scoring rate (P_expected × E_expected)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface SportConfig {
    sport: string;
    possessionUnit: string;         // e.g., "possessions", "drives", "shots"
    efficiencyUnit: string;         // e.g., "pts/poss", "pts/drive", "goals/shot"
    periodsPerGame: number;
    minutesPerPeriod: number;
    minPossessionsForStability: number;  // Min data points before E_live is stable
}

interface LiveGameState {
    matchId: string;
    sport: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    totalScore: number;
    period: number;
    timeRemaining: number;          // Minutes remaining in game
    elapsedMinutes: number;
    possessions: number;            // Total possessions/plays so far
    isLive: boolean;
}

interface PregameExpectations {
    matchId: string;
    expectedPace: number;           // Possessions per minute expected
    expectedEfficiency: number;     // Points per possession expected
    expectedTotal: number;          // Pregame total line
    homeOffRating: number;          // Offensive rating
    awayOffRating: number;
    homeDefRating: number;          // Defensive rating
    awayDefRating: number;
}

interface LiveMetrics {
    // Raw live calculations
    P_live: number;                 // Live pace (possessions/min)
    E_live: number;                 // Live efficiency (pts/poss)
    R_real: number;                 // Actual scoring rate (pts/min)

    // Pregame expectations
    P_expected: number;
    E_expected: number;
    R_expected: number;

    // Market-implied
    liveTotal: number;              // Current market total
    impliedRemaining: number;       // I = L - S
    R_market: number;               // Market-implied rate

    // Deltas
    pace_delta: number;             // P_live - P_expected
    efficiency_delta: number;       // E_live - E_expected
    market_delta: number;           // R_real - R_market
    expected_delta: number;         // R_real - R_expected

    // Stability flags
    isStable: boolean;              // Enough data for reliable metrics
    stabilityScore: number;         // 0-1 confidence in metrics
}

interface PriceBreak {
    detected: boolean;
    direction: 'OVER' | 'UNDER' | null;
    magnitude: number;              // Z-score or bps deviation
    primaryDriver: 'PACE' | 'EFFICIENCY' | 'BOTH' | null;
    fairValue: number;              // Calculated fair total
    marketValue: number;            // Current market total
    edge: number;                   // Fair - Market
    edgePercent: number;            // Edge as % of total
    causalFlags: string[];          // What's causing the break
    confidence: number;             // 0-1 confidence
    windowAge: number;              // Seconds since break detected
    isExecutable: boolean;          // Meets all gating criteria
}

interface EdgeAnalysis {
    matchId: string;
    timestamp: string;
    gameState: LiveGameState;
    metrics: LiveMetrics;
    priceBreak: PriceBreak;
    recommendation: string;
    rawData: any;
}

// ============================================================================
// SPORT CONFIGURATIONS
// ============================================================================

const SPORT_CONFIGS: Record<string, SportConfig> = {
    'basketball_nba': {
        sport: 'NBA',
        possessionUnit: 'possessions',
        efficiencyUnit: 'pts/100poss',
        periodsPerGame: 4,
        minutesPerPeriod: 12,
        minPossessionsForStability: 20
    },
    'basketball_ncaab': {
        sport: 'NCAAB',
        possessionUnit: 'possessions',
        efficiencyUnit: 'pts/100poss',
        periodsPerGame: 2,
        minutesPerPeriod: 20,
        minPossessionsForStability: 15
    },
    'americanfootball_nfl': {
        sport: 'NFL',
        possessionUnit: 'drives',
        efficiencyUnit: 'pts/drive',
        periodsPerGame: 4,
        minutesPerPeriod: 15,
        minPossessionsForStability: 6
    },
    'americanfootball_ncaaf': {
        sport: 'NCAAF',
        possessionUnit: 'drives',
        efficiencyUnit: 'pts/drive',
        periodsPerGame: 4,
        minutesPerPeriod: 15,
        minPossessionsForStability: 6
    },
    'icehockey_nhl': {
        sport: 'NHL',
        possessionUnit: 'shots',
        efficiencyUnit: 'goals/shot',
        periodsPerGame: 3,
        minutesPerPeriod: 20,
        minPossessionsForStability: 15
    },
    'soccer_epl': {
        sport: 'EPL',
        possessionUnit: 'shots',
        efficiencyUnit: 'goals/shot',
        periodsPerGame: 2,
        minutesPerPeriod: 45,
        minPossessionsForStability: 5
    }
};

// ============================================================================
// CORE CALCULATION FUNCTIONS
// ============================================================================

/**
 * Extract live game state from ESPN/DB data
 */
function extractGameState(matchData: any, sportKey: string): LiveGameState {
    const config = SPORT_CONFIGS[sportKey] || SPORT_CONFIGS['basketball_nba'];
    const totalMinutes = config.periodsPerGame * config.minutesPerPeriod;

    // Parse period and time
    const period = matchData.period || 1;
    const displayClock = matchData.displayClock || matchData.minute || '12:00';

    // Calculate elapsed and remaining time
    let elapsedMinutes = 0;
    let timeRemaining = totalMinutes;

    if (displayClock && typeof displayClock === 'string' && displayClock.includes(':')) {
        const [mins, secs] = displayClock.split(':').map(Number);
        const periodTimeRemaining = mins + (secs || 0) / 60;
        const periodsCompleted = Math.max(0, period - 1);
        elapsedMinutes = (periodsCompleted * config.minutesPerPeriod) + (config.minutesPerPeriod - periodTimeRemaining);
        timeRemaining = totalMinutes - elapsedMinutes;
    } else if (matchData.minute) {
        // Soccer style
        elapsedMinutes = parseFloat(matchData.minute);
        timeRemaining = Math.max(0, 90 - elapsedMinutes);
    }

    // Extract scores
    const homeScore = parseInt(matchData.homeScore) || 0;
    const awayScore = parseInt(matchData.awayScore) || 0;

    // --- IMPROVED POSSESSION EXTRACTION ---
    let possessions = 0;

    if (sportKey.includes('americanfootball')) {
        // For NFL/CFB, count drives
        if (matchData.drives && Array.isArray(matchData.drives)) {
            possessions = matchData.drives.length;
        } else if (matchData.home_drives || matchData.away_drives) {
            possessions = (parseInt(matchData.home_drives) || 0) + (parseInt(matchData.away_drives) || 0);
        }
    } else if (sportKey.includes('basketball')) {
        // For NBA, we can use play count / 2.5 or clock interpolation
        if (matchData.playCount) {
            possessions = matchData.playCount / 2.2; // Heuristic
        }
    }

    // Fallback to estimation if extraction failed
    if (possessions <= 0) {
        possessions = estimatePossessions(elapsedMinutes, sportKey, homeScore + awayScore);
    }

    return {
        matchId: matchData.id,
        sport: sportKey,
        homeTeam: matchData.homeTeam?.name || matchData.home_team || '',
        awayTeam: matchData.awayTeam?.name || matchData.away_team || '',
        homeScore,
        awayScore,
        totalScore: homeScore + awayScore,
        period,
        timeRemaining: Math.max(0, timeRemaining),
        elapsedMinutes: Math.max(0.1, elapsedMinutes), // Prevent division by zero
        possessions: Math.max(1, possessions),
        isLive: ['LIVE', 'IN_PROGRESS', 'HALFTIME'].includes(String(matchData.status).toUpperCase())
    };
}

/**
 * Estimate possessions from elapsed time and score (fallback when no play-by-play)
 * Uses clock-based interpolation with slight acceleration for final periods.
 */
function estimatePossessions(elapsedMinutes: number, sportKey: string, totalScore: number): number {
    const paceEstimates: Record<string, number> = {
        'basketball_nba': 2.1,
        'basketball_ncaab': 1.7,
        'americanfootball_nfl': 0.2,
        'americanfootball_ncaaf': 0.22,
        'icehockey_nhl': 0.5,
        'soccer_epl': 0.15
    };

    let basePace = paceEstimates[sportKey] || 1.0;

    // NBA-specific: Pace often accelerates in 2nd and 4th quarters
    if (sportKey === 'basketball_nba' && elapsedMinutes > 36) {
        basePace *= 1.05;
    }

    return Math.round(elapsedMinutes * basePace * 2);
}

/**
 * Get pregame expectations from database or calculate from team stats
 */
async function getPregameExpectations(
    supabase: any,
    matchId: string,
    sportKey: string,
    matchData: any
): Promise<PregameExpectations> {
    // MANDATORY: Pull from pregame_expectations (Kickoff Sync baseline)
    const { data: baseline } = await supabase
        .from('pregame_expectations')
        .select('*')
        .eq('match_id', matchId)
        .maybeSingle();

    if (baseline) {
        return {
            matchId,
            expectedPace: parseFloat(baseline.expected_pace),
            expectedEfficiency: parseFloat(baseline.expected_efficiency),
            expectedTotal: parseFloat(baseline.expected_total),
            homeOffRating: parseFloat(baseline.home_off_rating || 100),
            awayOffRating: parseFloat(baseline.away_off_rating || 100),
            homeDefRating: parseFloat(baseline.home_def_rating || 100),
            awayDefRating: parseFloat(baseline.away_def_rating || 100)
        };
    }

    // FALLBACK (Should only happen if Kickoff Sync fails)
    console.warn(`[Live Edge] No baseline found for ${matchId}. Using fallback defaults.`);

    const sportDefaults: Record<string, { pace: number, efficiency: number, total: number }> = {
        'basketball_nba': { pace: 2.1, efficiency: 1.1, total: 220 },
        'basketball_ncaab': { pace: 1.7, efficiency: 1.0, total: 145 },
        'americanfootball_nfl': { pace: 0.2, efficiency: 2.3, total: 44 },
        'americanfootball_ncaaf': { pace: 0.22, efficiency: 2.5, total: 52 },
        'icehockey_nhl': { pace: 0.5, efficiency: 0.1, total: 6 },
        'soccer_epl': { pace: 0.15, efficiency: 0.1, total: 2.5 }
    };

    const defaults = sportDefaults[sportKey] || { pace: 1.0, efficiency: 1.0, total: 100 };
    const expectedTotal = parseFloat(matchData.odds?.total) || defaults.total;
    const minutes = (sportKey.includes('basketball') ? (sportKey.includes('nba') ? 48 : 40) : 60);
    const expectedPace = defaults.pace;
    const expectedEfficiency = expectedTotal / (expectedPace * minutes);

    return {
        matchId,
        expectedPace,
        expectedEfficiency,
        expectedTotal,
        homeOffRating: 100,
        awayOffRating: 100,
        homeDefRating: 100,
        awayDefRating: 100
    };
}

/**
 * Calculate live metrics from current game state
 */
function calculateLiveMetrics(
    gameState: LiveGameState,
    expectations: PregameExpectations,
    liveTotal: number
): LiveMetrics {
    const config = SPORT_CONFIGS[gameState.sport] || SPORT_CONFIGS['basketball_nba'];

    // Core live calculations
    const P_live = gameState.possessions / gameState.elapsedMinutes;
    const E_live = gameState.totalScore / Math.max(1, gameState.possessions);
    const R_real = gameState.totalScore / gameState.elapsedMinutes;

    // Expected rates
    const P_expected = expectations.expectedPace;
    const E_expected = expectations.expectedEfficiency;
    const R_expected = P_expected * E_expected;

    // Market-implied rate
    const impliedRemaining = liveTotal - gameState.totalScore;
    const R_market = gameState.timeRemaining > 0
        ? impliedRemaining / gameState.timeRemaining
        : 0;

    // Deltas
    const pace_delta = P_live - P_expected;
    const efficiency_delta = E_live - E_expected;
    const market_delta = R_real - R_market;
    const expected_delta = R_real - R_expected;

    // Stability assessment
    const isStable = gameState.possessions >= config.minPossessionsForStability;
    const stabilityScore = Math.min(1, gameState.possessions / (config.minPossessionsForStability * 2));

    return {
        P_live,
        E_live,
        R_real,
        P_expected,
        E_expected,
        R_expected,
        liveTotal,
        impliedRemaining,
        R_market,
        pace_delta,
        efficiency_delta,
        market_delta,
        expected_delta,
        isStable,
        stabilityScore
    };
}

/**
 * Detect price breaks and determine if executable
 */
function detectPriceBreak(
    metrics: LiveMetrics,
    gameState: LiveGameState
): PriceBreak {
    // Thresholds (these should be tuned empirically)
    const MARKET_DELTA_THRESHOLD = 0.3;  // pts/min deviation to trigger
    const EDGE_PERCENT_THRESHOLD = 0.03; // 3% edge minimum
    const MIN_TIME_REMAINING = 2;        // Minutes - don't fire in final 2 mins
    const MAX_WINDOW_AGE = 120;          // Seconds - kill stale breaks

    // Calculate fair value based on current rate
    const projectedRemaining = metrics.R_real * gameState.timeRemaining;
    const fairValue = gameState.totalScore + projectedRemaining;
    const edge = fairValue - metrics.liveTotal;
    const edgePercent = Math.abs(edge) / metrics.liveTotal;

    // Determine direction
    let direction: 'OVER' | 'UNDER' | null = null;
    if (metrics.R_real > metrics.R_market && edge > 0) {
        direction = 'OVER';
    } else if (metrics.R_real < metrics.R_market && edge < 0) {
        direction = 'UNDER';
    }

    // Detect primary driver
    let primaryDriver: 'PACE' | 'EFFICIENCY' | 'BOTH' | null = null;
    const paceContribution = Math.abs(metrics.pace_delta * metrics.E_expected);
    const efficiencyContribution = Math.abs(metrics.efficiency_delta * metrics.P_expected);

    if (paceContribution > efficiencyContribution * 1.5) {
        primaryDriver = 'PACE';
    } else if (efficiencyContribution > paceContribution * 1.5) {
        primaryDriver = 'EFFICIENCY';
    } else if (paceContribution > 0 || efficiencyContribution > 0) {
        primaryDriver = 'BOTH';
    }

    // Identify causal flags
    const causalFlags: string[] = [];
    if (metrics.pace_delta > 0.2) causalFlags.push('HIGH_TEMPO');
    if (metrics.pace_delta < -0.2) causalFlags.push('LOW_TEMPO');
    if (metrics.efficiency_delta > 0.1) causalFlags.push('HIGH_EFFICIENCY');
    if (metrics.efficiency_delta < -0.1) causalFlags.push('LOW_EFFICIENCY');
    if (gameState.timeRemaining < 5) causalFlags.push('GARBAGE_TIME_RISK');

    // Calculate magnitude (simplified Z-score proxy)
    const magnitude = Math.abs(metrics.market_delta) / 0.15; // Normalize by typical std dev

    // Confidence based on stability and magnitude
    const confidence = metrics.stabilityScore * Math.min(1, magnitude / 2);

    // Gating logic
    const isExecutable =
        metrics.isStable &&
        Math.abs(metrics.market_delta) > MARKET_DELTA_THRESHOLD &&
        edgePercent > EDGE_PERCENT_THRESHOLD &&
        gameState.timeRemaining > MIN_TIME_REMAINING &&
        direction !== null;

    return {
        detected: Math.abs(metrics.market_delta) > MARKET_DELTA_THRESHOLD * 0.5,
        direction,
        magnitude,
        primaryDriver,
        fairValue,
        marketValue: metrics.liveTotal,
        edge,
        edgePercent,
        causalFlags,
        confidence,
        windowAge: 0, // Would be tracked across calls
        isExecutable
    };
}

/**
 * Generate human-readable recommendation
 */
function generateRecommendation(
    priceBreak: PriceBreak,
    metrics: LiveMetrics,
    gameState: LiveGameState
): string {
    if (!priceBreak.detected) {
        return `No significant price break detected. Market rate (${metrics.R_market.toFixed(2)} pts/min) aligns with realized rate (${metrics.R_real.toFixed(2)} pts/min).`;
    }

    if (!priceBreak.isExecutable) {
        const reasons = [];
        if (!metrics.isStable) reasons.push('insufficient data');
        if (gameState.timeRemaining <= 2) reasons.push('too late in game');
        if (priceBreak.edgePercent <= 0.03) reasons.push('edge too small');
        return `Price break detected but NOT EXECUTABLE: ${reasons.join(', ')}.`;
    }

    const driverExplanation = priceBreak.primaryDriver === 'PACE'
        ? `Game pace (${metrics.P_live.toFixed(2)} poss/min) is ${metrics.pace_delta > 0 ? 'above' : 'below'} expected (${metrics.P_expected.toFixed(2)}).`
        : priceBreak.primaryDriver === 'EFFICIENCY'
            ? `Scoring efficiency (${metrics.E_live.toFixed(2)} pts/poss) is ${metrics.efficiency_delta > 0 ? 'above' : 'below'} expected (${metrics.E_expected.toFixed(2)}).`
            : `Both pace and efficiency are contributing to the deviation.`;

    return `EXECUTABLE ${priceBreak.direction}: Market pricing ${metrics.R_market.toFixed(2)} pts/min, game producing ${metrics.R_real.toFixed(2)} pts/min. ${driverExplanation} Fair total: ${priceBreak.fairValue.toFixed(1)} (Edge: ${priceBreak.edge > 0 ? '+' : ''}${priceBreak.edge.toFixed(1)} pts).`;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        const body = await req.json();
        const { matchId, matchData, sportKey, liveTotal } = body;

        if (!matchData) {
            return new Response(
                JSON.stringify({ error: 'matchData is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // 1. Extract game state
        const gameState = extractGameState(matchData, sportKey || 'basketball_nba');

        // 2. Get pregame expectations
        const expectations = await getPregameExpectations(
            supabase,
            matchId || matchData.id,
            sportKey || 'basketball_nba',
            matchData
        );

        // 3. Calculate live metrics
        const metrics = calculateLiveMetrics(
            gameState,
            expectations,
            liveTotal || expectations.expectedTotal
        );

        // 4. Detect price breaks
        const priceBreak = detectPriceBreak(metrics, gameState);

        // 5. Generate recommendation
        const recommendation = generateRecommendation(priceBreak, metrics, gameState);

        // 6. Assemble output
        const analysis: EdgeAnalysis = {
            matchId: matchId || matchData.id,
            timestamp: new Date().toISOString(),
            gameState,
            metrics,
            priceBreak,
            recommendation,
            rawData: { matchData, sportKey, liveTotal }
        };

        // 7. Optionally store for historical analysis
        if (priceBreak.isExecutable) {
            try {
                await supabase.from('live_edge_alerts').insert({
                    match_id: analysis.matchId,
                    detected_at: analysis.timestamp,
                    direction: priceBreak.direction,
                    edge: priceBreak.edge,
                    edge_percent: priceBreak.edgePercent,
                    confidence: priceBreak.confidence,
                    primary_driver: priceBreak.primaryDriver,
                    metrics: metrics,
                    game_state: gameState,
                    recommendation
                });
            } catch {
                // Silent fail if table doesn't exist or insert fails
            }
        }

        return new Response(
            JSON.stringify(analysis),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Live Edge Calculator Error:', error);
        return new Response(
            JSON.stringify({ error: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
