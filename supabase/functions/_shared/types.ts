
export enum Sport {
  NBA = 'NBA',
  NFL = 'NFL',
  BASEBALL = 'BASEBALL',
  HOCKEY = 'HOCKEY',
  SOCCER = 'SOCCER',
  COLLEGE_FOOTBALL = 'COLLEGE_FOOTBALL',
  COLLEGE_BASKETBALL = 'COLLEGE_BASKETBALL',
  WNBA = 'WNBA',
  TENNIS = 'TENNIS',
  GOLF = 'GOLF',
  MMA = 'MMA',
  BASKETBALL = 'BASKETBALL'
}

export enum MatchStatus {
  SCHEDULED = 'SCHEDULED',
  LIVE = 'LIVE',
  FINISHED = 'FINISHED',
  POSTPONED = 'POSTPONED',
  CANCELLED = 'CANCELLED',
  HALFTIME = 'HALFTIME'
}

export enum EdgeEnvironmentTag {
  EARLY_MARKET_CORRECTION_LAG = 'EARLY_MARKET_CORRECTION_LAG',
  SHARP_STEAM = 'SHARP_STEAM',
  REVERSE_LINE_MOVEMENT = 'REVERSE_LINE_MOVEMENT',
  KEY_NUMBER_DEFENSE = 'KEY_NUMBER_DEFENSE',
  VOLATILITY_SPIKE = 'VOLATILITY_SPIKE'
}

export type PropBetType =
  | 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks'
  | 'threes_made' | 'pra' | 'pr' | 'ra' | 'pa'
  | 'passing_yards' | 'rushing_yards' | 'receiving_yards'
  | 'receptions' | 'tackles' | 'sacks' | 'hits'
  | 'shots_on_goal' | 'goals' | 'saves'
  | 'custom';

export type PropResult = 'pending' | 'won' | 'lost' | 'push' | 'void';

export interface PlayerPropBet {
  id: string;
  userId: string;
  matchId?: string; // Optional link to Match
  parlayId?: string; // Optional grouping

  eventDate: string;
  league: string;
  team?: string;
  opponent?: string;
  playerName: string;
  playerId?: string;

  betType: PropBetType;
  marketLabel?: string;
  side: 'over' | 'under' | 'yes' | 'no' | string;
  lineValue: number;

  sportsbook: string;
  oddsAmerican: number;
  oddsDecimal?: number;
  stakeAmount: number;
  potentialPayout?: number;
  impliedProbPct?: number;

  result: PropResult;
  resultValue?: number; // The actual stat value (e.g. 25 pts)
  settledAt?: string;
  settledPnl?: number;

  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Linescore {
  value: number;
  label: string;
  period: number;
  // Tennis-specific
  tiebreak?: number;
  winner?: boolean;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  abbreviation?: string;
  logo: string;
  color?: string;
  record?: string;
  rank?: number;
  score: number;
  linescores?: Linescore[];
  // Tennis: player's country flag
  flag?: string;

  stadiumThumb?: string;
  fanArt?: string;
  stadium?: string;
}

export interface MatchOdds {
  provider?: string;
  hasOdds?: boolean;
  homeWin?: string | number;
  awayWin?: string | number;
  draw?: string | number;
  spread?: string | number;
  homeSpread?: string | number;
  awaySpread?: string | number;
  overUnder?: string | number;
  over?: string | number;
  under?: string | number;
  moneylineHome?: string | number;
  moneylineAway?: string | number;
  totalOver?: string | number;
  homeSpreadOdds?: string | number;
  awaySpreadOdds?: string | number;

  winProbability?: number;
  draftkingsLink?: string;
}

export interface MatchEvent {
  id: string;
  time: string;
  period?: number;
  type: 'score' | 'foul' | 'highlight' | 'substitution' | 'card' | 'shot' | 'goal';
  teamId?: string;
  playerId?: string;
  detail?: string;
  scoreValue?: number;
  text?: string;
  clock?: string;
  description?: string;
}

export interface StatItem {
  label: string;
  homeValue: string;
  awayValue: string;
  isPercentage?: boolean;
}

export interface AdvancedMetrics {
  home: Record<string, number>;
  away: Record<string, number>;
}

export interface AthleteStats {
  id?: string;
  name: string;
  shortName?: string;
  position?: string;
  stats: string[];
}

export interface PlayerStatCategory {
  name: string;
  displayName: string;
  labels: string[];
  athletes: AthleteStats[];
}

export interface TeamPlayerStats {
  teamId: string;
  categories: PlayerStatCategory[];
}

export interface MomentumPoint {
  minute: number;
  value: number;
  displayClock?: string;
  winProb?: number;
}

export interface MatchContext {
  weather?: {
    temp: string;
    condition: string;
  };
  venue?: {
    name: string;
    city: string;
    state: string;
    indoor: boolean;
  };
  attendance?: number;
}

export interface Situation {
  down?: number;
  distance?: number;
  yardLine?: number;
  possessionId?: string;
  possessionText?: string;
  downDistanceText?: string;
  isRedZone?: boolean;
  balls?: number;
  strikes?: number;
  outs?: number;
  onFirst?: boolean;
  onSecond?: boolean;
  onThird?: boolean;
  isBonus?: boolean;
  isPowerPlay?: boolean;
  ballX?: number;
  ballY?: number;
  playerId?: string;
}

export interface Drive {
  description: string;
  result?: string;
  yards?: number;
  plays?: number;
  timeElapsed?: string;
  teamId?: string;
  startYardLine?: number;
}

export interface LastPlay {
  id: string;
  text: string;
  clock: string;
  type: string;
  statYardage?: number;
  probability?: {
    homeWinPercentage: number;
  };
}

export interface MatchLeader {
  name: string;
  displayName: string;
  leaders: Array<{
    displayValue: string;
    value: number;
    athlete: {
      id: string;
      fullName: string;
      displayName: string;
      shortName: string;
      headshot?: string;
      position?: { abbreviation: string };
    };
    team?: { id: string };
  }>;
}

export interface Match {
  id: string;
  leagueId: string;
  sport: Sport;
  startTime: string | Date;
  status: MatchStatus | string;
  period?: number;
  displayClock?: string;
  minute?: string;
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number;
  awayScore: number;
  odds?: MatchOdds;
  events?: MatchEvent[];
  stats?: StatItem[];
  advancedMetrics?: AdvancedMetrics;
  playerStats?: TeamPlayerStats[];
  leaders?: MatchLeader[];
  momentum?: MomentumPoint[];
  context?: MatchContext;
  situation?: Situation;
  currentDrive?: Drive;
  lastPlay?: LastPlay;
  regulationPeriods?: number;
  win_probability?: { home: number; away: number };
  weather_info?: any;
  current_odds?: any;
  opening_odds?: any;
  closing_odds?: MatchOdds;
  goalies?: GoalieMatchupData; // New Field for Goalie Data
  canonical_id?: string;
}

export interface GoalieProfile {
  id: string;
  name: string;
  status: 'confirmed' | 'expected' | 'projected' | 'unconfirmed';
  source?: string;
  stats?: {
    gaa: string;
    svPct: string;
    record: string;
    reasoning?: string;
    bettingInsight?: string;
  };
  headshot?: string;
}

export interface GoalieMatchupData {
  home: GoalieProfile;
  away: GoalieProfile;
}

export interface Game extends Match {
  league: string;
  time: string;
  venue: string;
  topPerformers?: any[];
}

export interface League {
  id: string;
  name: string;
  sport: Sport;
  apiEndpoint: string;
  oddsKey?: string;
}

export interface Bet {
  id: string;
  matchId: string;
  selection: string;
  odds: string;
  stake: number;
  status: 'PENDING' | 'WON' | 'LOST' | 'PUSH';
  timestamp: number;
  sport?: string;
  marketType?: string;
  analysis?: string;
}

export type ConfidenceTier = 'ELITE' | 'STRONG' | 'LEAN' | 'SPEC' | 'PASS';

export interface UnifiedConfidence {
  score: number;
  tier: ConfidenceTier;
  label: string;
}

export interface AnalysisFactor {
  signal: string;
  weight: 'high' | 'medium' | 'low';
  detail: string;
  direction: 'supporting' | 'opposing';
}

export interface RestContext {
  daysRest: number;
  isBackToBack: boolean;
}

export interface DripVolatility {
  volatility_score: number;
  volatility_grade: string;
  projected_swing: string;
  swing_probability: string;
  recommended_side: string;
  reasoning: string[];
  middle_strategy: string;
}

export interface DripLiveMiddle {
  gap_points: number;
  middle_zone: string;
  base_hit_rate: string;
  adjustments: { factor: string; impact: string }[];
  adjusted_hit_rate: string;
  ev_per_220: string;
  quality_grade: string;
  recommendation: string;
  reasoning: string;
  hedge_instruction: string;
}

export interface DripDetection {
  pre_game: DripVolatility;
  live?: DripLiveMiddle | null;
}

export interface EnhancedEdgeAnalysis {
  pick: string;
  confidence: UnifiedConfidence;
  summary: string;
  factors: AnalysisFactor[];
  counterFactors: AnalysisFactor[];
  lineMovement?: {
    open: string;
    current: string;
    direction: 'sharp' | 'fade' | 'neutral';
  };
  restContext?: {
    home: RestContext;
    away: RestContext;
  };
  sources?: { title: string; url: string }[];
  drip_detection?: DripDetection;
}

export interface MatchIntelligence {
  summary: string;
  tacticalAnalysis: string;
  prediction: {
    pick: string;
    confidence: UnifiedConfidence;
    reasoning: string;
    betType: string;
  };
  context?: string;
  bettingInsight?: string;
  keyMatchup?: string;
  thought_trace?: string;
}

export interface AIAnalysis {
  summary: string;
  bettingInsight: string;
  keyMatchup: string;
  prediction: string;
}

export interface QuickInsight {
  context: string;
  summary: string;
}

export interface InjuryReport {
  id: string;
  name: string;
  position: string;
  status: string;
  description: string;
  headshot?: string;
  player?: string;
  team?: string;
  impact?: string;
  details?: string;
  returnTimeline?: string;
  analysis?: string;
}

export interface BettingFactor {
  title: string;
  description: string;
  trend: 'HOME_POSITIVE' | 'AWAY_POSITIVE' | 'NEUTRAL';
  confidence?: number;
}

export interface LineMovement {
  opening?: string;
  current?: string;
  direction?: string;
  notes?: string;
}

export interface WeatherCondition {
  temp: string;
  condition: string;
  wind: string;
  humidity: string;
  pressure?: string;
  impact?: string;
}

export interface FatigueMetrics {
  team: string;
  daysRest: number;
  milesTraveled: number;
  timeZonesCrossed: number;
  gamesInLast7Days: number;
  fatigueScore: number;
  note: string;
}

export interface OfficialStats {
  crewName: string;
  referee: string;
  homeWinPct: number;
  overPct: number;
  foulsPerGame: number;
  bias: string;
  keyTendency: string;
}

export interface TeamNews {
  text: string;
  sources?: { title: string; uri: string }[];
}

export interface MatchNews {
  matchId: string;
  report: string;
  keyInjuries: InjuryReport[];
  bettingFactors: BettingFactor[];
  lineMovement?: LineMovement;
  weather?: WeatherCondition;
  fatigue?: { home: FatigueMetrics; away: FatigueMetrics };
  officials?: OfficialStats;
  sources: { title: string; url: string }[];
  status: 'pending' | 'ready' | 'failed';
  generatedAt: string;
  expiresAt: string;
}

export interface MatchThesis {
  summary: string;
  keyFactors: { title: string; description: string; impact: 'high' | 'medium' | 'low' }[];
  recommendedPlays: {
    label: string;
    odds: string;
    confidence: UnifiedConfidence;
  }[];
  sources?: { title: string; url: string }[];
}

export interface NarrativeIntel {
  headline: string;
  mainRant: string;
  psychologyFactors: { title: string; value: string }[];
  analogies: string[];
  blazingPick: {
    selection: string;
    confidence: UnifiedConfidence;
    reason: string
  };
  sources?: { title: string; url: string }[];
}

export interface ShotEvent {
  id: number;
  x: number;
  y: number;
  type: 'goal' | 'shot';
  teamId: 'home' | 'away';
  period: number;
  timeInPeriod: string;
  shooterName: string;
}

export interface HockeyGameData {
  gameId: string;
  shots: ShotEvent[];
  homeTeamAbbrev: string;
  awayTeamAbbrev: string;
}

export interface GameLeader {
  name: string;
  value: string;
  stats: string;
}