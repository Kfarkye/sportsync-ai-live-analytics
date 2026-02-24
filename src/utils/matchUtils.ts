
import { Match, MatchStatus, Sport, Drive } from '@/types';
import { getCanonicalMatchId } from './matchRegistry';

/**
 * Checks if a game is currently in progress.
 * Includes delayed and suspended states.
 */
export const isGameInProgress = (status: MatchStatus | string): boolean => {
  const inProgressStatuses = [
    MatchStatus.LIVE,
    'STATUS_IN_PROGRESS',
    'STATUS_HALFTIME',
    'STATUS_END_PERIOD',
    'STATUS_DELAYED',
    'STATUS_RAIN_DELAY',
    'STATUS_PLAY_SUSPENDED',
    'STATUS_FIRST_HALF',
    'STATUS_SECOND_HALF',
    'LIVE',
    'HALFTIME',
    'IN_PROGRESS'
  ];
  return inProgressStatuses.includes(String(status));
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
  const finishedStatuses = [
    MatchStatus.FINISHED,
    'STATUS_FINAL',
    'STATUS_FINAL_OT',
    'STATUS_FINAL_SO',
    'STATUS_FULL_TIME',
    'FINAL',
    'FINISHED',
    'FT',
    'AET',
    'PK'
  ];
  return finishedStatuses.includes(String(status));
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

export const getInitialSportContext = (): Sport => {
  const today = new Date();
  const day = today.getDay();
  const isNFLDay = day === 4 || day === 0 || day === 1;
  return isNFLDay ? Sport.NFL : Sport.NBA;
};

export const getDbMatchId = (id: string, leagueId?: string): string => {
  return getCanonicalMatchId(id, leagueId);
};
