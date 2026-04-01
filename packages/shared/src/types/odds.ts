/**
 * Enhanced Types for The Odds API Integration
 * 
 * These types provide full coverage of the Odds API paid tier features
 */

// ============================================================================
// CORE ODDS TYPES
// ============================================================================

export type OddsState = 'open' | 'live' | 'settled' | 'void' | 'off_board';
export type BetResult = 'won' | 'lost' | 'push' | 'void' | null;
export type BetSide = 'home' | 'away' | 'over' | 'under' | 'draw';

// ============================================================================
// LINE SHOPPING TYPES
// ============================================================================

export interface BestLine {
    price: number;        // American odds format
    book: string;         // Bookmaker name
    link?: string;        // Deep link to bet slip (when available)
}

export interface LineShoppingData {
    bestHomeML?: BestLine;
    bestAwayML?: BestLine;
    bestDrawML?: BestLine;
    bestHomeSpread?: BestLine & { point: number };
    bestAwaySpread?: BestLine & { point: number };
    bestOver?: BestLine & { point: number };
    bestUnder?: BestLine & { point: number };
}

// ============================================================================
// PLAYER PROP TYPES
// ============================================================================

export interface PlayerProp {
    playerName: string;
    playerId?: string;
    teamId?: string;
    market: string;           // e.g., 'player_points'
    marketLabel: string;      // e.g., 'PTS'
    line: number;             // e.g., 24.5
    overPrice: number;        // American odds
    underPrice: number;       // American odds
    bookmaker: string;
    link?: string;
}

export interface PlayerPropsMap {
    [playerKey: string]: PlayerProp;
}

// Markets supported for each sport
export type NbaPlayerPropMarket =
    | 'player_points'
    | 'player_rebounds'
    | 'player_assists'
    | 'player_threes'
    | 'player_blocks'
    | 'player_steals'
    | 'player_points_rebounds_assists'
    | 'player_points_rebounds'
    | 'player_points_assists'
    | 'player_rebounds_assists'
    | 'player_double_double'
    | 'player_triple_double';

export type NflPlayerPropMarket =
    | 'player_pass_yds'
    | 'player_pass_tds'
    | 'player_pass_completions'
    | 'player_rush_yds'
    | 'player_rush_tds'
    | 'player_receptions'
    | 'player_reception_yds'
    | 'player_reception_tds'
    | 'player_anytime_td'
    | 'player_first_td';

export type MlbPlayerPropMarket =
    | 'batter_hits'
    | 'batter_total_bases'
    | 'batter_rbis'
    | 'batter_runs_scored'
    | 'batter_home_runs'
    | 'batter_stolen_bases'
    | 'pitcher_strikeouts'
    | 'pitcher_outs';

export type NhlPlayerPropMarket =
    | 'player_points'
    | 'player_goals'
    | 'player_assists'
    | 'player_shots_on_goal'
    | 'goalie_saves';

// ============================================================================
// LINE MOVEMENT / HISTORICAL TYPES
// ============================================================================

export interface LineMovementPoint {
    timestamp: string;     // ISO 8601
    homeSpread: number;
    awaySpread: number;
    total: number;
    homeML: number;
    awayML: number;
    bookmaker: string;
}

export interface HistoricalOddsSnapshot {
    timestamp: string;
    data: OddsApiEvent[];
    previous_timestamp?: string;
    next_timestamp?: string;
}

// ============================================================================
// BOOKMAKER TYPES
// ============================================================================

export interface Bookmaker {
    key: string;           // e.g., 'draftkings'
    title: string;         // e.g., 'DraftKings'
    lastUpdate: string;
    markets: Market[];
}

export interface Market {
    key: string;           // e.g., 'h2h', 'spreads', 'totals'
    lastUpdate: string;
    outcomes: Outcome[];
}

export interface Outcome {
    name: string;          // Team name, 'Over', 'Under', or player name
    price: number;         // Decimal odds
    point?: number;        // Spread or total value
    description?: string;  // Player name for props
    link?: string;         // Deep link
    sid?: string;          // Source ID
}

// ============================================================================
// EVENT TYPES
// ============================================================================

export interface OddsApiEvent {
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Bookmaker[];
    // Scores endpoint additions
    scores?: OddsApiScore[];
    completed?: boolean;
    last_update?: string;
}

export interface OddsApiScore {
    name: string;
    score: string;
}

// ============================================================================
// ENHANCED MATCH ODDS (Extends base MatchOdds)
// ============================================================================

export interface EnhancedMatchOdds {
    // Provider info
    provider: string;
    hasOdds: boolean;
    lastUpdate?: string;
    bookmakerCount?: number;
    oddsApiEventId?: string;

    // Core lines (consensus/first available)
    homeWin?: string;
    awayWin?: string;
    draw?: string;
    homeSpread?: string;
    awaySpread?: string;
    homeSpreadOdds?: string;
    awaySpreadOdds?: string;
    spread?: string;
    overUnder?: string;
    over?: string;
    under?: string;
    totalOver?: string;
    totalUnder?: string;

    // Line shopping (best available)
    lineShopping?: LineShoppingData;

    // Opening lines (for CLV tracking)
    openingHomeSpread?: number;
    openingTotal?: number;
    openingHomeML?: number;
    openingAwayML?: number;

    // Movement data
    lineMovement?: LineMovementPoint[];
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface OddsApiSport {
    key: string;
    group: string;
    title: string;
    description: string;
    active: boolean;
    has_outrights: boolean;
}

export interface OddsApiResponse<T> {
    data: T;
    remainingRequests?: number;
    usedRequests?: number;
}

// ============================================================================
// EDGE FUNCTION REQUEST TYPES
// ============================================================================

export interface OddsEdgeRequest {
    action?: 'featured_odds' | 'player_props' | 'alternate_lines' | 'historical' | 'scores' | 'available_markets';
    sport?: string;
    homeTeam?: string;
    awayTeam?: string;
    eventId?: string;
    markets?: string;
    regions?: string;
    date?: string;
    daysFrom?: number;
}
