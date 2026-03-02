import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export const SOCCER_LEAGUES = ['epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'mls', 'ucl', 'uel'] as const;
export type SoccerLeagueId = (typeof SOCCER_LEAGUES)[number];

export interface MatchOddsSnapshot {
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  drawMoneyline: number | null;
  spread: number | null;
  homeSpreadPrice: number | null;
  awaySpreadPrice: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
}

export interface GameFlowSnapshot {
  drainVersion: string | null;
  homeGoals1H: number | null;
  awayGoals1H: number | null;
  homeGoals2H: number | null;
  awayGoals2H: number | null;
  htResult: string | null;
  ftResult: string | null;
  htFtResult: string | null;
  btts: boolean | null;
  btts1H: boolean | null;
  btts2H: boolean | null;
  homeScoredBothHalves: boolean | null;
  awayScoredBothHalves: boolean | null;
  firstGoalTeam: string | null;
  firstGoalInterval: string | null;
  firstGoalMinute: number | null;
  lastGoalMinute: number | null;
  lastGoalTeam: string | null;
  lateGoals: number | null;
  stoppageTimeGoals: number | null;
  penaltyAwarded: boolean | null;
  totalPenalties: number | null;
  scoreless: boolean | null;
  goals1HPct: number | null;
}

export interface BoxScoreRow {
  key: string;
  label: string;
  home: string;
  away: string;
}

export interface MatchEvent {
  minute: number | null;
  minuteLabel: string;
  type: 'goal' | 'card' | 'substitution' | 'other';
  teamSide: 'home' | 'away' | 'neutral';
  teamName: string | null;
  playerName: string | null;
  detail: string | null;
  raw: unknown;
}

export interface TeamLineup {
  side: 'home' | 'away';
  teamName: string;
  formation: string | null;
  starters: string[];
  substitutes: string[];
}

export interface SoccerMatchCard {
  id: string;
  slug: string;
  leagueId: string;
  leagueName: string;
  startTime: string;
  startDate: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  referee: string | null;
  matchday: string | null;
  odds: MatchOddsSnapshot;
  gameFlow: GameFlowSnapshot;
}

export interface SoccerMatchDetail extends SoccerMatchCard {
  boxScore: BoxScoreRow[];
  timeline: MatchEvent[];
  events: MatchEvent[];
  lineups: TeamLineup[];
  bet365TeamOdds: Bet365TeamOddsSnapshot | null;
  playerScorerOdds: PlayerScorerOddsRow[];
  raw: Record<string, unknown>;
}

export interface Bet365TeamOddsSnapshot {
  homeFractional: string | null;
  drawFractional: string | null;
  awayFractional: string | null;
  homeDecimal: number | null;
  drawDecimal: number | null;
  awayDecimal: number | null;
  ouHandicap: number | null;
  overFractional: string | null;
  underFractional: string | null;
  overDecimal: number | null;
  underDecimal: number | null;
  dcHomeDrawFractional: string | null;
  dcDrawAwayFractional: string | null;
  dcHomeAwayFractional: string | null;
  ftResult: string | null;
  totalGoals: number | null;
}

export interface PlayerScorerOddsRow {
  id: string;
  playerName: string;
  pool: string;
  oddsFractional: string | null;
  oddsDecimal: number | null;
  impliedProb: number | null;
  scored: boolean | null;
  goalsScored: number | null;
  firstGoal: boolean | null;
  lastGoal: boolean | null;
  result: string | null;
  profitDecimal: number | null;
}

export interface TeamDirectoryItem {
  slug: string;
  teamName: string;
  leagueId: string;
  leagueName: string;
  matchCount: number;
}

export interface TeamSeasonRow {
  matchId: string;
  matchSlug: string;
  startTime: string;
  opponent: string;
  isHome: boolean;
  teamScore: number | null;
  oppScore: number | null;
  result: 'W' | 'D' | 'L' | '—';
  atsResult: 'W' | 'P' | 'L' | '—';
  ouResult: 'O' | 'P' | 'U' | '—';
  spread: number | null;
  total: number | null;
  moneyline: number | null;
}

export interface TeamAggregateStats {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  avgPossession: number | null;
  avgXgFor: number | null;
  avgXgAgainst: number | null;
}

export interface TeamTrendStats {
  bttsRate: number | null;
  firstGoalRate: number | null;
  scoredBothHalvesRate: number | null;
  lateGoalRate: number | null;
  htFtDistribution: Array<{ key: string; count: number }>;
  mlRange: { min: number | null; max: number | null; avg: number | null };
  spreadRange: { min: number | null; max: number | null; avg: number | null };
  totalRange: { min: number | null; max: number | null; avg: number | null };
}

export interface TeamPagePayload {
  teamName: string;
  teamSlug: string;
  leagueId: string | null;
  leagueName: string | null;
  rows: TeamSeasonRow[];
  aggregate: TeamAggregateStats;
  trends: TeamTrendStats;
}

type UnknownRecord = Record<string, unknown>;

const LEAGUE_LABELS: Record<string, string> = {
  epl: 'Premier League',
  laliga: 'La Liga',
  seriea: 'Serie A',
  bundesliga: 'Bundesliga',
  ligue1: 'Ligue 1',
  mls: 'MLS',
  ucl: 'Champions League',
  uel: 'Europa League',
};

const LEGACY_LEAGUE_MAP: Record<string, string> = {
  'eng.1': 'epl',
  'esp.1': 'laliga',
  'ita.1': 'seriea',
  'ger.1': 'bundesliga',
  'fra.1': 'ligue1',
  'usa.1': 'mls',
  'uefa.champions': 'ucl',
  'uefa.europa': 'uel',
};

const BOX_SCORE_KEYS: Array<{ key: string; label: string; home: string[]; away: string[]; pct?: boolean }> = [
  { key: 'possession', label: 'Possession', home: ['home_possession', 'possession_home', 'home_possession_pct'], away: ['away_possession', 'possession_away', 'away_possession_pct'], pct: true },
  { key: 'shots', label: 'Shots', home: ['home_shots', 'shots_home'], away: ['away_shots', 'shots_away'] },
  { key: 'shots_on_target', label: 'Shots On Target', home: ['home_shots_on_target', 'shots_on_target_home'], away: ['away_shots_on_target', 'shots_on_target_away'] },
  { key: 'xg', label: 'xG', home: ['xg_home', 'home_xg'], away: ['xg_away', 'away_xg'] },
  { key: 'passes', label: 'Passes', home: ['home_passes', 'passes_home'], away: ['away_passes', 'passes_away'] },
  { key: 'pass_pct', label: 'Pass Accuracy', home: ['home_pass_pct', 'pass_pct_home', 'home_pass_accuracy'], away: ['away_pass_pct', 'pass_pct_away', 'away_pass_accuracy'], pct: true },
  { key: 'corners', label: 'Corners', home: ['home_corners', 'corners_home'], away: ['away_corners', 'corners_away'] },
  { key: 'fouls', label: 'Fouls', home: ['home_fouls', 'fouls_home'], away: ['away_fouls', 'fouls_away'] },
  { key: 'tackles', label: 'Tackles', home: ['home_tackles', 'tackles_home'], away: ['away_tackles', 'tackles_away'] },
  { key: 'clearances', label: 'Clearances', home: ['home_clearances', 'clearances_home'], away: ['away_clearances', 'clearances_away'] },
  { key: 'saves', label: 'Saves', home: ['home_saves', 'saves_home'], away: ['away_saves', 'saves_away'] },
];

const EMPTY_ODDS: MatchOddsSnapshot = {
  homeMoneyline: null,
  awayMoneyline: null,
  drawMoneyline: null,
  spread: null,
  homeSpreadPrice: null,
  awaySpreadPrice: null,
  total: null,
  overPrice: null,
  underPrice: null,
};

const EMPTY_GAME_FLOW: GameFlowSnapshot = {
  drainVersion: null,
  homeGoals1H: null,
  awayGoals1H: null,
  homeGoals2H: null,
  awayGoals2H: null,
  htResult: null,
  ftResult: null,
  htFtResult: null,
  btts: null,
  btts1H: null,
  btts2H: null,
  homeScoredBothHalves: null,
  awayScoredBothHalves: null,
  firstGoalTeam: null,
  firstGoalInterval: null,
  firstGoalMinute: null,
  lastGoalMinute: null,
  lastGoalTeam: null,
  lateGoals: null,
  stoppageTimeGoals: null,
  penaltyAwarded: null,
  totalPenalties: null,
  scoreless: null,
  goals1HPct: null,
};

const parseFloatSafe = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/[^0-9+.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseIntSafe = (value: unknown): number | null => {
  const numeric = parseFloatSafe(value);
  if (numeric === null) return null;
  return Math.round(numeric);
};

const parseBooleanSafe = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 't', 'yes', 'y', '1'].includes(normalized)) return true;
    if (['false', 'f', 'no', 'n', '0'].includes(normalized)) return false;
  }
  return null;
};

const parseStringSafe = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

const readValue = (row: UnknownRecord, keys: string[]): unknown => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
};

const parseJsonSafe = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (Array.isArray(value) || typeof value === 'object') return value;
  return null;
};

const normalizeLeagueId = (leagueId: string | null): string => {
  if (!leagueId) return 'soccer';
  const lower = leagueId.toLowerCase();
  return LEGACY_LEAGUE_MAP[lower] ?? lower;
};

export const leagueLabel = (leagueId: string): string => LEAGUE_LABELS[normalizeLeagueId(leagueId)] ?? leagueId.toUpperCase();

export const slugifyTeam = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const isoDateFromStart = (startTime: string | null): string => {
  if (!startTime) return '';
  const parsed = new Date(startTime);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

export const buildMatchSlug = (row: UnknownRecord): string => {
  const league = normalizeLeagueId(parseStringSafe(readValue(row, ['league_id'])));
  const home = slugifyTeam(parseStringSafe(readValue(row, ['home_team'])) ?? 'home');
  const away = slugifyTeam(parseStringSafe(readValue(row, ['away_team'])) ?? 'away');
  const date = isoDateFromStart(parseStringSafe(readValue(row, ['start_time'])));
  return `${league}-${home}-vs-${away}-${date}`;
};

export const parseMatchSlug = (
  slug: string,
): { leagueId: string | null; homeSlug: string; awaySlug: string; date: string } | null => {
  const normalized = slug.trim().toLowerCase();
  const dateMatch = normalized.match(/^(.*)-(\d{4}-\d{2}-\d{2})$/);
  if (!dateMatch) return null;

  const prefix = dateMatch[1] ?? '';
  const date = dateMatch[2] ?? '';
  const vsIndex = prefix.indexOf('-vs-');
  if (vsIndex < 0) return null;

  const left = prefix.slice(0, vsIndex);
  const awaySlug = prefix.slice(vsIndex + 4);
  if (!awaySlug) return null;

  const league = SOCCER_LEAGUES.find((candidate) => left.startsWith(`${candidate}-`));
  if (!league) {
    return {
      leagueId: null,
      homeSlug: left,
      awaySlug,
      date,
    };
  }

  const homeSlug = left.slice(league.length + 1);
  if (!homeSlug) return null;

  return {
    leagueId: league,
    homeSlug,
    awaySlug,
    date,
  };
};

const normalizeMinute = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9+]/g, '');
    if (!cleaned) return null;
    if (cleaned.includes('+')) {
      const [a, b] = cleaned.split('+');
      const first = Number(a);
      const second = Number(b);
      if (Number.isFinite(first) && Number.isFinite(second)) return first + second;
    }
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const minuteLabelFromValue = (minute: number | null): string => (minute === null ? '—' : `${minute}'`);

const resolveTeamSide = (value: unknown, homeTeam: string, awayTeam: string): 'home' | 'away' | 'neutral' => {
  const team = parseStringSafe(value)?.toLowerCase() ?? '';
  if (!team) return 'neutral';
  const home = homeTeam.toLowerCase();
  const away = awayTeam.toLowerCase();
  if (team.includes(home) || home.includes(team)) return 'home';
  if (team.includes(away) || away.includes(team)) return 'away';
  if (team === 'home') return 'home';
  if (team === 'away') return 'away';
  return 'neutral';
};

const normalizeEventObject = (
  value: unknown,
  type: MatchEvent['type'],
  homeTeam: string,
  awayTeam: string,
): MatchEvent | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as UnknownRecord;
  const minute = normalizeMinute(readValue(record, ['minute', 'min', 'clock', 'time', 'display_minute']));
  const teamName = parseStringSafe(readValue(record, ['team', 'team_name', 'club', 'side']));
  const playerName = parseStringSafe(readValue(record, ['player', 'player_name', 'name']));
  const detail = parseStringSafe(readValue(record, ['detail', 'description', 'note', 'type', 'event']));

  return {
    minute,
    minuteLabel: minuteLabelFromValue(minute),
    type,
    teamSide: resolveTeamSide(teamName, homeTeam, awayTeam),
    teamName,
    playerName,
    detail,
    raw: value,
  };
};

const extractEventsFromPayload = (
  payload: unknown,
  type: MatchEvent['type'],
  homeTeam: string,
  awayTeam: string,
): MatchEvent[] => {
  const rows: MatchEvent[] = [];
  const parsed = parseJsonSafe(payload);
  if (!parsed) return rows;

  const processNode = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) processNode(item);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as UnknownRecord;

    if (Array.isArray(record.events)) {
      processNode(record.events);
      return;
    }

    const nestedKeys = ['home', 'away', 'home_events', 'away_events', 'cards', 'goals', 'substitutions'];
    let consumedNested = false;
    for (const key of nestedKeys) {
      const nestedValue = record[key];
      if (Array.isArray(nestedValue)) {
        consumedNested = true;
        processNode(nestedValue);
      }
    }
    if (consumedNested) return;

    const normalized = normalizeEventObject(record, type, homeTeam, awayTeam);
    if (normalized) rows.push(normalized);
  };

  processNode(parsed);
  return rows;
};

const extractTimeline = (events: MatchEvent[]): MatchEvent[] =>
  events
    .filter((event) => event.type === 'goal' && event.minute !== null)
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));

const extractLineupFromPayload = (payload: unknown, side: 'home' | 'away', teamName: string): TeamLineup | null => {
  const parsed = parseJsonSafe(payload);
  if (!parsed || typeof parsed !== 'object') return null;

  const record = parsed as UnknownRecord;
  const startersNode = readValue(record, ['starters', 'starting_xi', 'startingXI', 'starting_lineup']);
  const subsNode = readValue(record, ['subs', 'substitutes', 'bench']);

  const extractPlayerNames = (node: unknown): string[] => {
    if (!node) return [];
    if (Array.isArray(node)) {
      const names: string[] = [];
      for (const item of node) {
        if (typeof item === 'string') {
          const normalized = parseStringSafe(item);
          if (normalized) names.push(normalized);
        } else if (item && typeof item === 'object') {
          const entry = item as UnknownRecord;
          const candidate = parseStringSafe(readValue(entry, ['name', 'player', 'player_name', 'displayName']));
          if (candidate) names.push(candidate);
        }
      }
      return names;
    }
    return [];
  };

  const starters = extractPlayerNames(startersNode);
  const substitutes = extractPlayerNames(subsNode);
  const formation = parseStringSafe(readValue(record, ['formation', 'shape']));

  if (starters.length === 0 && substitutes.length === 0) return null;

  return {
    side,
    teamName,
    formation,
    starters,
    substitutes,
  };
};

const extractLineups = (row: UnknownRecord, homeTeam: string, awayTeam: string): TeamLineup[] => {
  const output: TeamLineup[] = [];

  const homePayload = readValue(row, ['home_lineup', 'lineup_home', 'home_lineups']);
  const awayPayload = readValue(row, ['away_lineup', 'lineup_away', 'away_lineups']);

  const unifiedPayload = parseJsonSafe(readValue(row, ['lineups', 'lineup', 'lineups_json']));
  if (unifiedPayload && typeof unifiedPayload === 'object' && !Array.isArray(unifiedPayload)) {
    const unifiedRecord = unifiedPayload as UnknownRecord;
    const parsedHome = extractLineupFromPayload(unifiedRecord.home, 'home', homeTeam);
    const parsedAway = extractLineupFromPayload(unifiedRecord.away, 'away', awayTeam);
    if (parsedHome) output.push(parsedHome);
    if (parsedAway) output.push(parsedAway);
  }

  const parsedHome = extractLineupFromPayload(homePayload, 'home', homeTeam);
  const parsedAway = extractLineupFromPayload(awayPayload, 'away', awayTeam);
  if (parsedHome) output.push(parsedHome);
  if (parsedAway) output.push(parsedAway);

  const deduped = new Map<string, TeamLineup>();
  for (const lineup of output) {
    deduped.set(`${lineup.side}-${lineup.teamName}`, lineup);
  }

  return Array.from(deduped.values());
};

const formatStatValue = (value: number | null, pct: boolean | undefined): string => {
  if (value === null) return '—';
  if (pct) {
    const normalized = value <= 1 ? value * 100 : value;
    return `${normalized.toFixed(1)}%`;
  }
  if (Math.abs(value % 1) > 0) return value.toFixed(2);
  return String(Math.round(value));
};

const extractBoxScore = (row: UnknownRecord): BoxScoreRow[] => {
  const rows: BoxScoreRow[] = [];
  for (const config of BOX_SCORE_KEYS) {
    const homeVal = parseFloatSafe(readValue(row, config.home));
    const awayVal = parseFloatSafe(readValue(row, config.away));
    if (homeVal === null && awayVal === null) continue;

    rows.push({
      key: config.key,
      label: config.label,
      home: formatStatValue(homeVal, config.pct),
      away: formatStatValue(awayVal, config.pct),
    });
  }
  return rows;
};

const extractOdds = (row: UnknownRecord): MatchOddsSnapshot => ({
  homeMoneyline: parseIntSafe(readValue(row, ['dk_home_ml', 'home_ml', 'moneyline_home'])),
  awayMoneyline: parseIntSafe(readValue(row, ['dk_away_ml', 'away_ml', 'moneyline_away'])),
  drawMoneyline: parseIntSafe(readValue(row, ['dk_draw_ml', 'draw_ml', 'moneyline_draw'])),
  spread: parseFloatSafe(readValue(row, ['dk_spread', 'spread', 'home_spread'])),
  homeSpreadPrice: parseIntSafe(readValue(row, ['dk_home_spread_price', 'home_spread_price'])),
  awaySpreadPrice: parseIntSafe(readValue(row, ['dk_away_spread_price', 'away_spread_price'])),
  total: parseFloatSafe(readValue(row, ['dk_total', 'total', 'total_line'])),
  overPrice: parseIntSafe(readValue(row, ['dk_over_price', 'over_price'])),
  underPrice: parseIntSafe(readValue(row, ['dk_under_price', 'under_price'])),
});

const extractGameFlow = (row: UnknownRecord): GameFlowSnapshot => ({
  drainVersion: parseStringSafe(readValue(row, ['drain_version'])) ?? null,
  homeGoals1H: parseIntSafe(readValue(row, ['home_goals_1h'])),
  awayGoals1H: parseIntSafe(readValue(row, ['away_goals_1h'])),
  homeGoals2H: parseIntSafe(readValue(row, ['home_goals_2h'])),
  awayGoals2H: parseIntSafe(readValue(row, ['away_goals_2h'])),
  htResult: parseStringSafe(readValue(row, ['ht_result'])) ?? null,
  ftResult: parseStringSafe(readValue(row, ['ft_result'])) ?? null,
  htFtResult: parseStringSafe(readValue(row, ['ht_ft_result'])) ?? null,
  btts: parseBooleanSafe(readValue(row, ['btts'])),
  btts1H: parseBooleanSafe(readValue(row, ['btts_1h'])),
  btts2H: parseBooleanSafe(readValue(row, ['btts_2h'])),
  homeScoredBothHalves: parseBooleanSafe(readValue(row, ['home_scored_both_halves'])),
  awayScoredBothHalves: parseBooleanSafe(readValue(row, ['away_scored_both_halves'])),
  firstGoalTeam: parseStringSafe(readValue(row, ['first_goal_team'])) ?? null,
  firstGoalInterval: parseStringSafe(readValue(row, ['first_goal_interval'])) ?? null,
  firstGoalMinute: normalizeMinute(readValue(row, ['first_goal_minute'])),
  lastGoalMinute: normalizeMinute(readValue(row, ['last_goal_minute'])),
  lastGoalTeam: parseStringSafe(readValue(row, ['last_goal_team'])) ?? null,
  lateGoals: parseIntSafe(readValue(row, ['late_goals'])),
  stoppageTimeGoals: parseIntSafe(readValue(row, ['stoppage_time_goals'])),
  penaltyAwarded: parseBooleanSafe(readValue(row, ['penalty_awarded'])),
  totalPenalties: parseIntSafe(readValue(row, ['total_penalties'])),
  scoreless: parseBooleanSafe(readValue(row, ['scoreless'])),
  goals1HPct: parseFloatSafe(readValue(row, ['goals_1h_pct'])),
});

const extractEvents = (row: UnknownRecord, homeTeam: string, awayTeam: string): MatchEvent[] => {
  const goalsPayload = readValue(row, ['goal_events', 'goals', 'goals_json']);
  const cardsPayload = readValue(row, ['card_events', 'cards', 'cards_json']);
  const subsPayload = readValue(row, ['substitution_events', 'substitutions', 'subs_json']);

  const goalEvents = extractEventsFromPayload(goalsPayload, 'goal', homeTeam, awayTeam);
  const cardEvents = extractEventsFromPayload(cardsPayload, 'card', homeTeam, awayTeam);
  const subEvents = extractEventsFromPayload(subsPayload, 'substitution', homeTeam, awayTeam);

  const merged = [...goalEvents, ...cardEvents, ...subEvents]
    .sort((a, b) => {
      const left = a.minute ?? Number.MAX_SAFE_INTEGER;
      const right = b.minute ?? Number.MAX_SAFE_INTEGER;
      return left - right;
    });

  return merged;
};

const rowId = (row: UnknownRecord): string => {
  const direct = parseStringSafe(readValue(row, ['id', 'match_id', 'event_id']));
  if (direct) return direct;
  return buildMatchSlug(row);
};

const toBaseCard = (row: UnknownRecord): SoccerMatchCard => {
  const leagueId = normalizeLeagueId(parseStringSafe(readValue(row, ['league_id'])));
  const startTime = parseStringSafe(readValue(row, ['start_time'])) ?? '';

  return {
    id: rowId(row),
    slug: buildMatchSlug(row),
    leagueId,
    leagueName: leagueLabel(leagueId),
    startTime,
    startDate: isoDateFromStart(startTime),
    homeTeam: parseStringSafe(readValue(row, ['home_team'])) ?? 'Home',
    awayTeam: parseStringSafe(readValue(row, ['away_team'])) ?? 'Away',
    homeScore: parseIntSafe(readValue(row, ['home_score'])),
    awayScore: parseIntSafe(readValue(row, ['away_score'])),
    venue: parseStringSafe(readValue(row, ['venue'])),
    referee: parseStringSafe(readValue(row, ['referee'])),
    matchday: parseStringSafe(readValue(row, ['matchday'])),
    odds: extractOdds(row),
    gameFlow: extractGameFlow(row),
  };
};

const toMatchDetail = (row: UnknownRecord): SoccerMatchDetail => {
  const base = toBaseCard(row);
  const events = extractEvents(row, base.homeTeam, base.awayTeam);

  return {
    ...base,
    boxScore: extractBoxScore(row),
    timeline: extractTimeline(events),
    events,
    lineups: extractLineups(row, base.homeTeam, base.awayTeam),
    bet365TeamOdds: null,
    playerScorerOdds: [],
    raw: row,
  };
};

const mapBet365TeamOdds = (row: UnknownRecord): Bet365TeamOddsSnapshot => ({
  homeFractional: parseStringSafe(readValue(row, ['b365_home_frac'])),
  drawFractional: parseStringSafe(readValue(row, ['b365_draw_frac'])),
  awayFractional: parseStringSafe(readValue(row, ['b365_away_frac'])),
  homeDecimal: parseFloatSafe(readValue(row, ['b365_home_dec'])),
  drawDecimal: parseFloatSafe(readValue(row, ['b365_draw_dec'])),
  awayDecimal: parseFloatSafe(readValue(row, ['b365_away_dec'])),
  ouHandicap: parseFloatSafe(readValue(row, ['b365_ou_handicap'])),
  overFractional: parseStringSafe(readValue(row, ['b365_over_frac'])),
  underFractional: parseStringSafe(readValue(row, ['b365_under_frac'])),
  overDecimal: parseFloatSafe(readValue(row, ['b365_over_dec'])),
  underDecimal: parseFloatSafe(readValue(row, ['b365_under_dec'])),
  dcHomeDrawFractional: parseStringSafe(readValue(row, ['b365_dc_home_draw_frac'])),
  dcDrawAwayFractional: parseStringSafe(readValue(row, ['b365_dc_draw_away_frac'])),
  dcHomeAwayFractional: parseStringSafe(readValue(row, ['b365_dc_home_away_frac'])),
  ftResult: parseStringSafe(readValue(row, ['ft_result'])),
  totalGoals: parseIntSafe(readValue(row, ['total_goals'])),
});

const mapPlayerScorerOddsRow = (row: UnknownRecord, index: number): PlayerScorerOddsRow => ({
  id: parseStringSafe(readValue(row, ['id'])) ?? `row-${index}`,
  playerName: parseStringSafe(readValue(row, ['player_name'])) ?? 'Unknown',
  pool: parseStringSafe(readValue(row, ['pool'])) ?? 'unknown',
  oddsFractional: parseStringSafe(readValue(row, ['odds_fractional'])),
  oddsDecimal: parseFloatSafe(readValue(row, ['odds_decimal'])),
  impliedProb: parseFloatSafe(readValue(row, ['implied_prob'])),
  scored: parseBooleanSafe(readValue(row, ['scored'])),
  goalsScored: parseIntSafe(readValue(row, ['goals_scored'])),
  firstGoal: parseBooleanSafe(readValue(row, ['first_goal'])),
  lastGoal: parseBooleanSafe(readValue(row, ['last_goal'])),
  result: parseStringSafe(readValue(row, ['result'])),
  profitDecimal: parseFloatSafe(readValue(row, ['profit_decimal'])),
});

const enrichV6Odds = async (match: SoccerMatchDetail): Promise<SoccerMatchDetail> => {
  const matchId = parseStringSafe(readValue(match.raw, ['match_id'])) ?? match.id;
  const espnEventId = parseStringSafe(readValue(match.raw, ['espn_event_id'])) ?? match.id.split('_')[0];

  const [teamOddsRes, playerOddsRes] = await Promise.all([
    supabase
      .from('soccer_bet365_team_odds')
      .select('*')
      .or(`match_id.eq.${matchId},espn_event_id.eq.${espnEventId}`)
      .limit(1),
    supabase
      .from('soccer_player_odds')
      .select('*')
      .or(`match_id.eq.${matchId},espn_event_id.eq.${espnEventId}`)
      .order('pool', { ascending: true })
      .order('odds_decimal', { ascending: true })
      .limit(300),
  ]);

  const teamOdds =
    teamOddsRes.error || !teamOddsRes.data || teamOddsRes.data.length === 0
      ? null
      : mapBet365TeamOdds((teamOddsRes.data[0] ?? {}) as UnknownRecord);

  const playerOdds =
    playerOddsRes.error || !playerOddsRes.data
      ? []
      : playerOddsRes.data.map((row, index) => mapPlayerScorerOddsRow((row ?? {}) as UnknownRecord, index));

  return {
    ...match,
    bet365TeamOdds: teamOdds,
    playerScorerOdds: playerOdds,
  };
};

const postgameSelect = '*';

const ensureConfigured = (): void => {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
};

const nextUtcDateIso = (date: string): string => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
};

const currentDayIso = (): string => new Date().toISOString().slice(0, 10);

export async function fetchRecentSoccerMatches(limit = 30): Promise<SoccerMatchCard[]> {
  ensureConfigured();
  const { data, error } = await supabase
    .from('soccer_postgame')
    .select(postgameSelect)
    .order('start_time', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => toBaseCard((row ?? {}) as UnknownRecord));
}

export async function fetchLeagueMatches(leagueId: string): Promise<SoccerMatchCard[]> {
  ensureConfigured();
  const normalizedLeague = normalizeLeagueId(leagueId);

  const { data, error } = await supabase
    .from('soccer_postgame')
    .select(postgameSelect)
    .eq('league_id', normalizedLeague)
    .order('start_time', { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data ?? []).map((row) => toBaseCard((row ?? {}) as UnknownRecord));
}

export async function fetchMatchBySlug(slug: string): Promise<SoccerMatchDetail | null> {
  ensureConfigured();
  const parsed = parseMatchSlug(slug);
  if (!parsed) return null;

  const dayStart = `${parsed.date}T00:00:00.000Z`;
  const dayEnd = nextUtcDateIso(parsed.date);

  let query = supabase
    .from('soccer_postgame')
    .select(postgameSelect)
    .gte('start_time', dayStart)
    .lt('start_time', dayEnd)
    .order('start_time', { ascending: true });

  if (parsed.leagueId) {
    query = query.eq('league_id', parsed.leagueId);
  }

  const { data, error } = await query;

  if (error) throw error;

  const rows = (data ?? []).map((row) => toMatchDetail((row ?? {}) as UnknownRecord));
  const exact = rows.find((row) => row.slug === slug);
  if (exact) return enrichV6Odds(exact);

  const found =
    rows.find(
      (row) => slugifyTeam(row.homeTeam) === parsed.homeSlug && slugifyTeam(row.awayTeam) === parsed.awaySlug,
    ) ?? null;

  if (!found) return null;
  return enrichV6Odds(found);
}

export async function fetchTeamsInLeague(leagueId: string): Promise<TeamDirectoryItem[]> {
  ensureConfigured();
  const normalizedLeague = normalizeLeagueId(leagueId);

  const { data, error } = await supabase
    .from('soccer_postgame')
    .select('league_id,home_team,away_team')
    .eq('league_id', normalizedLeague)
    .limit(1000);

  if (error) throw error;

  const counter = new Map<string, TeamDirectoryItem>();

  for (const row of data ?? []) {
    const record = (row ?? {}) as UnknownRecord;
    const home = parseStringSafe(readValue(record, ['home_team']));
    const away = parseStringSafe(readValue(record, ['away_team']));

    for (const name of [home, away]) {
      if (!name) continue;
      const slug = slugifyTeam(name);
      const existing = counter.get(slug);
      if (existing) {
        existing.matchCount += 1;
      } else {
        counter.set(slug, {
          slug,
          teamName: name,
          leagueId: normalizedLeague,
          leagueName: leagueLabel(normalizedLeague),
          matchCount: 1,
        });
      }
    }
  }

  return Array.from(counter.values()).sort((a, b) => a.teamName.localeCompare(b.teamName));
}

const teamFromRow = (row: SoccerMatchCard, teamSlug: string): { name: string; isHome: boolean } | null => {
  const homeSlug = slugifyTeam(row.homeTeam);
  const awaySlug = slugifyTeam(row.awayTeam);
  if (homeSlug === teamSlug) return { name: row.homeTeam, isHome: true };
  if (awaySlug === teamSlug) return { name: row.awayTeam, isHome: false };
  return null;
};

const avg = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
};

const minMaxAvg = (values: Array<number | null>): { min: number | null; max: number | null; avg: number | null } => {
  const filtered = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (filtered.length === 0) return { min: null, max: null, avg: null };
  return {
    min: Math.min(...filtered),
    max: Math.max(...filtered),
    avg: filtered.reduce((sum, value) => sum + value, 0) / filtered.length,
  };
};

const atsOutcome = (
  isHome: boolean,
  homeScore: number | null,
  awayScore: number | null,
  spread: number | null,
): 'W' | 'P' | 'L' | '—' => {
  if (homeScore === null || awayScore === null || spread === null) return '—';

  const margin = isHome ? homeScore - awayScore : awayScore - homeScore;
  const line = isHome ? spread : -spread;
  const graded = margin + line;

  if (graded > 0) return 'W';
  if (graded < 0) return 'L';
  return 'P';
};

const ouOutcome = (homeScore: number | null, awayScore: number | null, total: number | null): 'O' | 'P' | 'U' | '—' => {
  if (homeScore === null || awayScore === null || total === null) return '—';
  const score = homeScore + awayScore;
  if (score > total) return 'O';
  if (score < total) return 'U';
  return 'P';
};

const matchResult = (teamScore: number | null, oppScore: number | null): 'W' | 'D' | 'L' | '—' => {
  if (teamScore === null || oppScore === null) return '—';
  if (teamScore > oppScore) return 'W';
  if (teamScore < oppScore) return 'L';
  return 'D';
};

const parseTeamStats = (detail: SoccerMatchDetail, isHome: boolean): {
  possession: number | null;
  xgFor: number | null;
  xgAgainst: number | null;
} => {
  const possessionRow = detail.boxScore.find((row) => row.key === 'possession');
  const xgRow = detail.boxScore.find((row) => row.key === 'xg');

  const parseDisplayed = (value: string): number | null => parseFloatSafe(value.replace('%', ''));

  const ownPossession = parseDisplayed(isHome ? possessionRow?.home ?? '' : possessionRow?.away ?? '');
  const ownXg = parseDisplayed(isHome ? xgRow?.home ?? '' : xgRow?.away ?? '');
  const oppXg = parseDisplayed(isHome ? xgRow?.away ?? '' : xgRow?.home ?? '');

  return {
    possession: ownPossession,
    xgFor: ownXg,
    xgAgainst: oppXg,
  };
};

export async function fetchTeamMatches(teamSlug: string, league?: string): Promise<TeamPagePayload | null> {
  ensureConfigured();

  let query = supabase
    .from('soccer_postgame')
    .select(postgameSelect)
    .order('start_time', { ascending: false })
    .limit(1200);

  if (league) {
    query = query.eq('league_id', normalizeLeagueId(league));
  }

  const { data, error } = await query;
  if (error) throw error;

  const details = (data ?? [])
    .map((row) => toMatchDetail((row ?? {}) as UnknownRecord))
    .filter((detail) => slugifyTeam(detail.homeTeam) === teamSlug || slugifyTeam(detail.awayTeam) === teamSlug);

  if (details.length === 0) return null;

  const first = details[0];
  if (!first) return null;

  const fallbackSide = teamFromRow(first, teamSlug);
  const fallbackName = fallbackSide?.name ?? first.homeTeam;
  const fallbackLeague = league ? normalizeLeagueId(league) : first.leagueId;

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;

  const possessions: number[] = [];
  const xgFor: number[] = [];
  const xgAgainst: number[] = [];

  let bttsMatches = 0;
  let firstGoalMatches = 0;
  let bothHalvesMatches = 0;
  let lateGoalMatches = 0;

  const htFt = new Map<string, number>();
  const mlValues: Array<number | null> = [];
  const spreadValues: Array<number | null> = [];
  const totalValues: Array<number | null> = [];

  const rows: TeamSeasonRow[] = details.map((detail) => {
    const side = teamFromRow(detail, teamSlug);
    const isHome = side?.isHome ?? true;
    const teamName = side?.name ?? fallbackName;

    const teamScore = isHome ? detail.homeScore : detail.awayScore;
    const oppScore = isHome ? detail.awayScore : detail.homeScore;

    const result = matchResult(teamScore, oppScore);
    if (result === 'W') wins += 1;
    if (result === 'D') draws += 1;
    if (result === 'L') losses += 1;

    goalsFor += teamScore ?? 0;
    goalsAgainst += oppScore ?? 0;

    const stats = parseTeamStats(detail, isHome);
    if (stats.possession !== null) possessions.push(stats.possession);
    if (stats.xgFor !== null) xgFor.push(stats.xgFor);
    if (stats.xgAgainst !== null) xgAgainst.push(stats.xgAgainst);

    if (detail.gameFlow.btts !== null) {
      bttsMatches += detail.gameFlow.btts ? 1 : 0;
    }

    if (detail.gameFlow.firstGoalTeam) {
      const firstGoalSide = resolveTeamSide(detail.gameFlow.firstGoalTeam, detail.homeTeam, detail.awayTeam);
      if ((isHome && firstGoalSide === 'home') || (!isHome && firstGoalSide === 'away')) {
        firstGoalMatches += 1;
      }
    }

    const scoredBoth = isHome ? detail.gameFlow.homeScoredBothHalves : detail.gameFlow.awayScoredBothHalves;
    if (scoredBoth !== null && scoredBoth) bothHalvesMatches += 1;

    if ((detail.gameFlow.lateGoals ?? 0) > 0) lateGoalMatches += 1;

    const htFtKey = detail.gameFlow.htFtResult ?? '—';
    htFt.set(htFtKey, (htFt.get(htFtKey) ?? 0) + 1);

    const moneyline = isHome ? detail.odds.homeMoneyline : detail.odds.awayMoneyline;
    mlValues.push(moneyline);
    spreadValues.push(detail.odds.spread);
    totalValues.push(detail.odds.total);

    return {
      matchId: detail.id,
      matchSlug: detail.slug,
      startTime: detail.startTime,
      opponent: isHome ? detail.awayTeam : detail.homeTeam,
      isHome,
      teamScore,
      oppScore,
      result,
      atsResult: atsOutcome(isHome, detail.homeScore, detail.awayScore, detail.odds.spread),
      ouResult: ouOutcome(detail.homeScore, detail.awayScore, detail.odds.total),
      spread: detail.odds.spread,
      total: detail.odds.total,
      moneyline,
    };
  });

  const totalMatches = rows.length;

  const trends: TeamTrendStats = {
    bttsRate: totalMatches > 0 ? (bttsMatches / totalMatches) * 100 : null,
    firstGoalRate: totalMatches > 0 ? (firstGoalMatches / totalMatches) * 100 : null,
    scoredBothHalvesRate: totalMatches > 0 ? (bothHalvesMatches / totalMatches) * 100 : null,
    lateGoalRate: totalMatches > 0 ? (lateGoalMatches / totalMatches) * 100 : null,
    htFtDistribution: Array.from(htFt.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count),
    mlRange: minMaxAvg(mlValues),
    spreadRange: minMaxAvg(spreadValues),
    totalRange: minMaxAvg(totalValues),
  };

  return {
    teamName: fallbackName,
    teamSlug,
    leagueId: fallbackLeague,
    leagueName: leagueLabel(fallbackLeague),
    rows,
    aggregate: {
      matches: totalMatches,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      avgPossession: avg(possessions),
      avgXgFor: avg(xgFor),
      avgXgAgainst: avg(xgAgainst),
    },
    trends,
  };
}

export async function fetchSoccerHub(): Promise<{
  leagues: Array<{ leagueId: string; leagueName: string; matchCount: number }>;
  recentMatches: SoccerMatchCard[];
}> {
  ensureConfigured();

  const [{ data: leagueRows, error: leagueErr }, recentMatches] = await Promise.all([
    supabase
      .from('soccer_postgame')
      .select('league_id')
      .in('league_id', [...SOCCER_LEAGUES])
      .limit(4000),
    fetchRecentSoccerMatches(48),
  ]);

  if (leagueErr) throw leagueErr;

  const leagueCounts = new Map<string, number>();
  for (const row of leagueRows ?? []) {
    const record = (row ?? {}) as UnknownRecord;
    const leagueId = normalizeLeagueId(parseStringSafe(readValue(record, ['league_id'])));
    if (!SOCCER_LEAGUES.includes(leagueId as SoccerLeagueId)) continue;
    leagueCounts.set(leagueId, (leagueCounts.get(leagueId) ?? 0) + 1);
  }

  const leagues = [...SOCCER_LEAGUES].map((leagueId) => ({
    leagueId,
    leagueName: leagueLabel(leagueId),
    matchCount: leagueCounts.get(leagueId) ?? 0,
  }));

  return { leagues, recentMatches };
}

export async function fetchPolyOddsSnapshot(limit = 30): Promise<Array<Record<string, unknown>>> {
  ensureConfigured();
  const { data, error } = await supabase
    .from('poly_odds')
    .select('*')
    .order('game_start_time', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}

export function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

export function formatSignedNumber(value: number | null, decimals = 1): string {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}`;
}

export function formatMatchDateLabel(startTime: string): string {
  if (!startTime) return '—';
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return startTime;
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const hasPostgameForToday = async (): Promise<boolean> => {
  ensureConfigured();
  const today = currentDayIso();
  const tomorrow = nextUtcDateIso(today).slice(0, 10);
  const { count, error } = await supabase
    .from('soccer_postgame')
    .select('id', { count: 'exact', head: true })
    .gte('start_time', `${today}T00:00:00.000Z`)
    .lt('start_time', `${tomorrow}T00:00:00.000Z`);

  if (error) throw error;
  return (count ?? 0) > 0;
};

export const POSTGAME_SSG_ROUTES = {
  hub: '/soccer',
  league: (leagueId: string): string => `/league/${normalizeLeagueId(leagueId)}`,
  team: (teamSlug: string, leagueId?: string): string =>
    leagueId ? `/team/${teamSlug}?league=${normalizeLeagueId(leagueId)}` : `/team/${teamSlug}`,
  match: (slug: string): string => `/match/${slug}`,
};
