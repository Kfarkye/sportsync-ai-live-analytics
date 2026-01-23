/**
 * NBA Live Totals Control Engine v3.0 - Type Definitions
 * Canonical data contracts for the entire system
 */

// ============================================================================
// TICK INPUT CONTRACT (what ingestion must produce)
// ============================================================================

export interface TeamBoxLine {
    fga: number;
    fgm: number;
    threePA: number;
    threePM: number;
    fta: number;
    ftm: number;
    tov: number;
    orb: number;
}

export interface TickInput {
    gameId: string;
    ts: Date;
    elapsedMin: number;
    remMin: number;
    ptsHome: number;
    ptsAway: number;
    homeBox: TeamBoxLine;
    awayBox: TeamBoxLine;
    // Optional situational
    timeoutsHome?: number;
    timeoutsAway?: number;
    teamFoulsQHome?: number;
    teamFoulsQAway?: number;
    inBonusHome?: boolean;
    inBonusAway?: boolean;
    // Lineups (for EPM)
    homeOnCourt?: string[];
    awayOnCourt?: string[];
}

// ============================================================================
// PRIORS CONTRACT (pregame expectations)
// ============================================================================

export interface TeamPriors {
    pacePre48: number;
    exp3paRate: number;
    exp3pPct: number;
    exp2pPct: number;
    expFtr?: number;
    expTovPct?: number;
    expOrbPct?: number;
}

export interface GamePriors {
    closeTotal: number;
    pacePre48: number;
    homeTeam: string;
    awayTeam: string;
    homePriors: TeamPriors;
    awayPriors: TeamPriors;
}

// ============================================================================
// LINEUP EPM CONTRACT
// ============================================================================

export interface LineupEpmData {
    sumCurrentEpmHome: number;
    avgTeamEpmHome: number;
    sumCurrentEpmAway: number;
    avgTeamEpmAway: number;
}

// ============================================================================
// CONTROL TABLE INPUT (canonical engine input)
// ============================================================================

export interface ControlTableInput {
    // Market anchors
    mktAnchorTotal: number;     // Close total (pregame)
    liveMarketTotal: number;    // Current live market total

    // Time
    elapsedMin: number;
    remMin: number;

    // Scores
    ptsHome: number;
    ptsAway: number;

    // Box stats
    homeBox: TeamBoxLine;
    awayBox: TeamBoxLine;

    // Expectations (regressed + clamped)
    exp3pPctHome: number;
    exp2pPctHome: number;
    exp3pPctAway: number;
    exp2pPctAway: number;

    // Pace prior
    pacePre48: number;

    // EPM lineup data
    sumCurrentEpmHome: number;
    avgTeamEpmHome: number;
    sumCurrentEpmAway: number;
    avgTeamEpmAway: number;

    // Optional situational
    timeoutsHome?: number;
    timeoutsAway?: number;
    teamFoulsQHome?: number;
    teamFoulsQAway?: number;
    inBonusHome?: boolean;
    inBonusAway?: boolean;
}

// ============================================================================
// CONTROL TABLE OUTPUT (v3.0 snapshot)
// ============================================================================

export interface ControlTableOutput {
    // Anchor
    anchorPpp: number;

    // Possessions
    possHome: number;
    possAway: number;
    possLive: number;
    livePace48: number;
    paceBlend48: number;
    remPoss: number;

    // Luck
    luckGapHome: number;
    luckGapAway: number;
    luckGap: number;

    // Structural
    structPppHome: number;
    structPppAway: number;
    structPpp: number;

    // Projection
    projPpp: number;
    lineupAdjPpp: number;
    rawProj: number;

    // Endgame EV
    foulEv: number;
    otEv: number;

    // Final
    modelFair: number;
    edgeZ: number;
    volStd: number;

    // Diagnostics
    w: number;  // elapsed/48 blend weight
    threeParateGame: number;
}

// ============================================================================
// DECISION CONTRACT
// ============================================================================

export type DecisionSide = 'OVER' | 'UNDER' | 'PASS';

export interface TriggerState {
    consecutiveOverTicks: number;
    consecutiveUnderTicks: number;
    lastDecisionTs: Date | null;
    lastDecisionSide: DecisionSide | null;
}

export interface DecisionOutput {
    side: DecisionSide;
    edgeZ: number;
    modelFair: number;
    liveMkt: number;
    reasonCodes: string[];
    shouldFire: boolean;
}

// ============================================================================
// CALIBRATION CONTRACT
// ============================================================================

export interface CalibrationBucket {
    bucketName: string;
    sampleSize: number;
    meanResidual: number;
    stdResidual: number;
    bias: number;
}

export interface CalibrationMetrics {
    mae: number;
    biasVsClose: number;
    falsePositiveRate: number;
    edgeCaptureRate: number;
    buckets: CalibrationBucket[];
}

export interface CalibrationAdjustments {
    baseStd: number;
    highThreePaMultiplier: number;
    earlyGameZThreshold: number;
    foulEvMultiplier: number;
    otEvMultiplier: number;
    pppOffsetByBucket: Record<string, number>;
}

// ============================================================================
// DATABASE ROW TYPES
// ============================================================================

export interface NbaGameRow {
    game_id: string;
    season: string;
    home_team: string;
    away_team: string;
    start_ts: string;
    close_total: number;
    pace_pre48: number;
}

export interface NbaTickRow {
    tick_id: number;
    game_id: string;
    ts: string;
    elapsed_min: number;
    rem_min: number;
    pts_home: number;
    pts_away: number;
    home_fga: number;
    home_fgm: number;
    home_3pa: number;
    home_3pm: number;
    home_fta: number;
    home_ftm: number;
    home_tov: number;
    home_orb: number;
    away_fga: number;
    away_fgm: number;
    away_3pa: number;
    away_3pm: number;
    away_fta: number;
    away_ftm: number;
    away_tov: number;
    away_orb: number;
    timeouts_home?: number;
    timeouts_away?: number;
    team_fouls_q_home?: number;
    team_fouls_q_away?: number;
    in_bonus_home?: boolean;
    in_bonus_away?: boolean;
    home_on_court?: string[];
    away_on_court?: string[];
}

export interface NbaSnapshotRow {
    snapshot_id: number;
    game_id: string;
    tick_id: number;
    ts: string;
    anchor_ppp: number;
    poss_live: number;
    live_pace_48: number;
    pace_blend_48: number;
    rem_poss: number;
    luck_gap: number;
    struct_ppp: number;
    proj_ppp: number;
    lineup_adj_ppp: number;
    raw_proj: number;
    foul_ev: number;
    ot_ev: number;
    model_fair: number;
    live_mkt: number;
    edge_z: number;
    vol_std: number;
}

export interface NbaDecisionRow {
    decision_id: number;
    game_id: string;
    ts: string;
    side: 'OVER' | 'UNDER';
    edge_z: number;
    model_fair: number;
    live_mkt: number;
    reason_codes: string[];
    snapshot_id: number;
}
