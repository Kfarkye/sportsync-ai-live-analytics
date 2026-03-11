
import { Match, MatchStatus, Sport, Drive } from '@/types';
import { getCanonicalMatchId } from './matchRegistry';

/**
 * Checks if a game is currently in progress.
 * Includes delayed and suspended states.
 */
export const isGameInProgress = (status: MatchStatus | string): boolean => {
  const normalized = String(status || '').toUpperCase();

  // Guard: check finished first — once finished, never "in progress"
  if (isGameFinished(normalized)) return false;

  const inProgressStatuses = [
    MatchStatus.LIVE,
    'STATUS_IN_PROGRESS',
    'STATUS_HALFTIME',
    'STATUS_END_PERIOD',
    'STATUS_Q1',
    'STATUS_Q2',
    'STATUS_Q3',
    'STATUS_Q4',
    'STATUS_FIRST_QUARTER',
    'STATUS_SECOND_QUARTER',
    'STATUS_THIRD_QUARTER',
    'STATUS_FOURTH_QUARTER',
    'STATUS_OVERTIME',
    'STATUS_EXTRA_TIME',
    'STATUS_PENALTY_SHOOTOUT',
    'STATUS_TOP',
    'STATUS_BOT',
    'STATUS_MID_INNING',
    'STATUS_END_INNING',
    'STATUS_DELAYED',
    'STATUS_RAIN_DELAY',
    'STATUS_PLAY_SUSPENDED',
    'STATUS_FIRST_HALF',
    'STATUS_SECOND_HALF',
    'LIVE',
    'HALFTIME',
    'IN_PROGRESS'
  ];
  if (inProgressStatuses.includes(normalized)) return true;
  if (/^STATUS_Q[1-4]$/.test(normalized)) return true;
  if (/^Q[1-4]$/.test(normalized)) return true;
  if (/^P[1-9]$/.test(normalized)) return true;
  if (normalized.includes('IN_PROGRESS')) return true;
  if (normalized.includes('FIRST_HALF') || normalized.includes('SECOND_HALF')) return true;
  if (normalized.includes('TOP') || normalized.includes('BOT') || normalized.includes('INNING')) return true;
  return false;
};

/**
 * Match-level "actually live" check that augments status-only detection
 * with a staleness heuristic. If a game's start time is 5+ hours ago
 * and the status is a break state (halftime, end-of-period), it is
 * almost certainly over — the ingestion just hasn't caught up.
 */
const STALE_GAME_MS = 5 * 60 * 60 * 1000; // 5 hours
const BREAK_STATUSES = ['STATUS_HALFTIME', 'STATUS_END_PERIOD', 'HALFTIME', 'END_PERIOD'];

export const isMatchActuallyLive = (match: Match): boolean => {
  if (isGameFinished(match.status)) return false;
  if (!isGameInProgress(match.status)) return false;

  // Staleness guard: break states that persist long past game start are stale data
  const normalized = String(match.status || '').toUpperCase();
  if (BREAK_STATUSES.includes(normalized) && match.startTime) {
    const startMs = new Date(match.startTime).getTime();
    if (!isNaN(startMs) && Date.now() - startMs > STALE_GAME_MS) {
      return false; // Game started 5+ hours ago, break status is stale
    }
  }

  return true;
};

/**
 * Checks if a game is scheduled (not yet started).
 */
export const isGameScheduled = (status: MatchStatus | string): boolean => {
  return !isGameInProgress(status) && !isGameFinished(status);
};

/**
 * Checks if a game is in a break (Halftime, End of Period).
 */
export const isGameInBreak = (status: MatchStatus | string): boolean => {
  const breakStatuses = ['STATUS_HALFTIME', 'STATUS_END_PERIOD', 'HALFTIME', 'END_PERIOD'];
  return breakStatuses.includes(String(status));
};

/**
 * Checks if a game is finished.
 */
export const isGameFinished = (status: MatchStatus | string): boolean => {
  const normalized = String(status || '').toUpperCase();
  const finishedStatuses = [
    MatchStatus.FINISHED,
    'STATUS_FINAL',
    'STATUS_FINAL_OT',
    'STATUS_FINAL_SO',
    'STATUS_FINAL_PEN',
    'STATUS_FINAL_ET',
    'STATUS_FULL_TIME',
    'STATUS_COMPLETE',
    'FINAL',
    'FINISHED',
    'FT',
    'AET',
    'PK',
    'FULL_TIME',
    'COMPLETE',
  ];
  if (finishedStatuses.includes(normalized)) return true;
  // Catch any ESPN variant: STATUS_FINAL_*, FINAL_*
  if (normalized.startsWith('STATUS_FINAL') || normalized.startsWith('FINAL_')) return true;
  return false;
};

/**
 * Returns human-readable break status text.
 */
export const getBreakStatusText = (status: MatchStatus | string): string | null => {
  if (status === 'STATUS_HALFTIME' || status === 'HALFTIME') return 'Halftime';
  if (status === 'STATUS_END_PERIOD' || status === 'END_PERIOD') return 'End of Period';
  return null;
};

/**
 * Formats the current period/quarter for display.
 * Handles OT logic across different sports.
 */
export const getPeriodDisplay = (match: Match): string => {
  const breakText = getBreakStatusText(match.status);
  if (breakText) return breakText;

  const period = match.period || 0;
  if (period === 0) return '';

  const isOvertime = (match.sport === Sport.NBA && period > 4) ||
    (match.sport === Sport.NFL && period > 4) ||
    (match.sport === Sport.HOCKEY && period > 3);

  if (isOvertime) {
    const otPeriod = match.sport === Sport.HOCKEY ? period - 3 : period - 4;
    return otPeriod === 1 ? 'OT' : `${otPeriod}OT`;
  }

  if (match.sport === Sport.BASEBALL) {
    const outs = match.situation?.outs;
    const base = match.displayClock || (period ? `INNING ${period}` : '');
    if (!base) return outs !== undefined && outs !== null ? `${outs} OUTS` : '';
    return outs !== undefined && outs !== null ? `${base} • ${outs} OUTS` : base;
  }
  if (match.sport === Sport.HOCKEY) return `P${period}`;
  if (match.sport === Sport.SOCCER) return `${period === 1 ? '1st' : '2nd'} Half`;
  if (match.sport === Sport.TENNIS) return `Set ${period}`;

  return `Q${period}`;
};

/**
 * Extracts and parses play count from a drive description if explicit count is missing.
 */
export const parsePlayCountFromDescription = (description: string | undefined): number | null => {
  if (!description || typeof description !== 'string') return null;
  const match = description.match(/^(\d+)\s*play/i);
  return match ? parseInt(match[1], 10) : null;
};

/**
 * Safely determines the play count for a drive.
 */
export const getDrivePlayCount = (drive: Drive | undefined): number | string => {
  if (!drive) return '-';
  if (typeof drive.plays === 'number' && drive.plays > 0) return drive.plays;
  const parsedPlays = parsePlayCountFromDescription(drive.description);
  return parsedPlays !== null ? parsedPlays : (drive.plays ?? '-');
};

export const getInitialDateContext = (): Date => new Date();

const APP_STATE_STORAGE_KEY = 'sharpedge_app_state_v1';

const readPersistedSport = (): Sport | 'all' | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(APP_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { selectedSport?: Sport | 'all' } };
    const candidate = parsed?.state?.selectedSport;
    if (candidate === 'all') return 'all';
    return candidate && Object.values(Sport).includes(candidate as Sport) ? (candidate as Sport) : null;
  } catch {
    return null;
  }
};

export const hasPersistedSportContext = (): boolean => readPersistedSport() !== null;

export const getInitialSportContext = (): Sport => {
  const persisted = readPersistedSport();
  if (persisted) return persisted as Sport;
  return Sport.SOCCER;
};

export const getDbMatchId = (id: string, leagueId?: string): string => {
  return getCanonicalMatchId(id, leagueId);
};
