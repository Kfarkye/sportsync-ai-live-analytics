import { useQuery } from '@tanstack/react-query';
import { slugifyTeam } from '@/lib/postgamePages';
import { supabase } from '@/lib/supabase';

const FIVE_MIN = 1000 * 60 * 5;
const TEN_MIN = 1000 * 60 * 10;

type UnknownRecord = Record<string, unknown>;

export interface TeamOutlookProfileRow {
  leagueId: string;
  games: number;
  gamesWithLine: number;
  overCount: number;
  underCount: number;
  pushCount: number;
  overRate: number | null;
  underRate: number | null;
  avgLine: number | null;
  avgActual: number | null;
  band23: number;
  band23Pct: number | null;
}

export interface TeamOutlookGoalDistRow {
  total: number | string;
  games: number;
  pct: number;
}

export interface TeamOutlookBand {
  totalGames: number;
  band23: number;
  band23Pct: number | null;
}

export interface TeamOutlookFixtureRow {
  id: string;
  homeTeam: string;
  awayTeam: string;
  leagueId: string;
  startTime: string;
  venue: 'Home' | 'Away';
  opponent: string;
  teamEspnId: string | null;
  opponentEspnId: string | null;
  oppOverRate: number | null;
  oppUnderRate: number | null;
  oppOuSample: number;
  oppAvgActual: number | null;
  oppForm: string | null;
  oppWins: number | null;
  oppDraws: number | null;
  oppLosses: number | null;
}

export interface TeamOutlookData {
  team: string;
  teamSlug: string;
  teamEspnId: string | null;
  goalDistLeagueId: string | null;
  profile: TeamOutlookProfileRow[];
  goalDist: TeamOutlookGoalDistRow[];
  band: TeamOutlookBand;
  fixtures: TeamOutlookFixtureRow[];
}

interface MatchRow {
  id: string | null;
  home_team: string | null;
  away_team: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  league_id: string | null;
  start_time: string | null;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
}

interface OuTrendRow {
  team_name: string | null;
  league_id: string | null;
  games_with_line: number | null;
  over_count: number | null;
  under_count: number | null;
  push_count: number | null;
  over_rate: number | null;
  under_rate: number | null;
  avg_posted_total: number | null;
  avg_actual_total: number | null;
}

interface RollingFormRow {
  team_name: string | null;
  league_id: string | null;
  form_string: string | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toInteger = (value: unknown): number => {
  const parsed = toNumber(value);
  return parsed === null ? 0 : Math.trunc(parsed);
};

const toText = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

const toObjectArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.filter((entry): entry is UnknownRecord => typeof entry === 'object' && entry !== null && !Array.isArray(entry)) : [];

const humanizeTeamSlug = (teamSlug: string): string => {
  const upperTokens = new Set(['fc', 'cf', 'ac', 'afc', 'sc', 'cf']);
  return teamSlug
    .split('-')
    .filter(Boolean)
    .map((token) => {
      if (upperTokens.has(token)) return token.toUpperCase();
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ')
    .trim();
};

const sanitizeLikeToken = (input: string): string =>
  input.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

const resolveTeamName = async (teamSlug: string, leagueId?: string | null): Promise<string> => {
  const search = sanitizeLikeToken(teamSlug.replace(/-/g, ' '));
  if (!search) return humanizeTeamSlug(teamSlug);

  let query = supabase
    .from('matches')
    .select('home_team, away_team, league_id')
    .or(`home_team.ilike.%${search}%,away_team.ilike.%${search}%`)
    .order('start_time', { ascending: false })
    .limit(200);

  if (leagueId) {
    query = query.eq('league_id', leagueId);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    return humanizeTeamSlug(teamSlug);
  }

  const counts = new Map<string, number>();
  for (const row of data as Array<{ home_team?: string | null; away_team?: string | null }>) {
    if (row.home_team) counts.set(row.home_team, (counts.get(row.home_team) ?? 0) + 1);
    if (row.away_team) counts.set(row.away_team, (counts.get(row.away_team) ?? 0) + 1);
  }

  for (const candidate of counts.keys()) {
    if (slugifyTeam(candidate) === teamSlug) {
      return candidate;
    }
  }

  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? humanizeTeamSlug(teamSlug);
};

const normalizePayload = (raw: unknown, teamName: string, teamSlug: string): TeamOutlookData => {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as UnknownRecord;

  const profile = toObjectArray(payload.profile).map((row) => ({
    leagueId: toText(row.league_id) ?? 'soccer',
    games: toInteger(row.games),
    gamesWithLine: toInteger(row.games_with_line),
    overCount: toInteger(row.over_count),
    underCount: toInteger(row.under_count),
    pushCount: toInteger(row.push_count),
    overRate: toNumber(row.over_rate),
    underRate: toNumber(row.under_rate),
    avgLine: toNumber(row.avg_line),
    avgActual: toNumber(row.avg_actual),
    band23: toInteger(row.band_23),
    band23Pct: toNumber(row.band_23_pct),
  }));

  const goalDist = toObjectArray(payload.goal_dist).map((row) => ({
    total: toText(row.total) ?? '0',
    games: toInteger(row.games),
    pct: toNumber(row.pct) ?? 0,
  }));

  const bandRaw = (payload.band && typeof payload.band === 'object' ? payload.band : {}) as UnknownRecord;
  const band = {
    totalGames: toInteger(bandRaw.total_games),
    band23: toInteger(bandRaw.band_23),
    band23Pct: toNumber(bandRaw.band_23_pct),
  };

  const fixtures = toObjectArray(payload.fixtures).map((row) => ({
    id: toText(row.id) ?? '',
    homeTeam: toText(row.home_team) ?? 'Home',
    awayTeam: toText(row.away_team) ?? 'Away',
    leagueId: toText(row.league_id) ?? 'soccer',
    startTime: toText(row.start_time) ?? '',
    venue: (toText(row.venue) === 'Home' ? 'Home' : 'Away') as 'Home' | 'Away',
    opponent: toText(row.opponent) ?? 'Opponent',
    teamEspnId: toText(row.team_espn_id),
    opponentEspnId: toText(row.opponent_espn_id),
    oppOverRate: toNumber(row.opp_over_rate),
    oppUnderRate: toNumber(row.opp_under_rate),
    oppOuSample: toInteger(row.opp_ou_sample),
    oppAvgActual: toNumber(row.opp_avg_actual),
    oppForm: toText(row.opp_form),
    oppWins: toNumber(row.opp_w),
    oppDraws: toNumber(row.opp_d),
    oppLosses: toNumber(row.opp_l),
  }));

  return {
    team: toText(payload.team) ?? teamName,
    teamSlug,
    teamEspnId: toText(payload.team_espn_id),
    goalDistLeagueId: toText(payload.goal_dist_league_id),
    profile,
    goalDist,
    band,
    fixtures,
  };
};

const isMissingRpcError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return normalized.includes('get_team_outlook') && normalized.includes('could not find');
};

const isTeamSide = (name: string | null | undefined, teamName: string, teamSlug: string): boolean => {
  if (!name) return false;
  return name === teamName || slugifyTeam(name) === teamSlug;
};

const formatPct = (value: number): number => Math.round(value * 10) / 10;

const fetchTeamOutlookFallback = async (
  teamName: string,
  teamSlug: string,
  leagueId?: string | null,
): Promise<TeamOutlookData> => {
  let completedQuery = supabase
    .from('matches')
    .select('id,home_team,away_team,home_team_id,away_team_id,league_id,start_time,status,home_score,away_score')
    .or(`home_team.eq.${teamName},away_team.eq.${teamName}`)
    .in('status', ['STATUS_FINAL', 'STATUS_FULL_TIME'])
    .not('home_score', 'is', null)
    .not('away_score', 'is', null)
    .order('start_time', { ascending: false })
    .limit(500);

  if (leagueId) completedQuery = completedQuery.eq('league_id', leagueId);

  let upcomingQuery = supabase
    .from('matches')
    .select('id,home_team,away_team,home_team_id,away_team_id,league_id,start_time,status,home_score,away_score')
    .or(`home_team.eq.${teamName},away_team.eq.${teamName}`)
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(50);

  if (leagueId) upcomingQuery = upcomingQuery.eq('league_id', leagueId);

  let teamOuQuery = supabase
    .from('mv_team_ou_vs_line')
    .select('team_name,league_id,games_with_line,over_count,under_count,push_count,over_rate,under_rate,avg_posted_total,avg_actual_total')
    .eq('team_name', teamName);

  if (leagueId) teamOuQuery = teamOuQuery.eq('league_id', leagueId);

  const [{ data: completedRowsRaw }, { data: upcomingRowsRaw }, { data: teamOuRaw }] = await Promise.all([
    completedQuery,
    upcomingQuery,
    teamOuQuery,
  ]);

  const completedRows = (completedRowsRaw ?? []) as MatchRow[];
  const upcomingAllRows = (upcomingRowsRaw ?? []) as MatchRow[];
  const teamOuRows = (teamOuRaw ?? []) as OuTrendRow[];

  const upcomingRows = upcomingAllRows
    .filter((row) => !['STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_CANCELED', 'STATUS_POSTPONED'].includes(row.status ?? ''))
    .slice(0, 5);

  const profileLeagueStats = new Map<string, { games: number; band23: number }>();
  for (const row of completedRows) {
    const league = row.league_id ?? 'soccer';
    const total = (row.home_score ?? 0) + (row.away_score ?? 0);
    const current = profileLeagueStats.get(league) ?? { games: 0, band23: 0 };
    current.games += 1;
    if (total >= 2 && total <= 3) current.band23 += 1;
    profileLeagueStats.set(league, current);
  }

  const teamOuByLeague = new Map<string, OuTrendRow>();
  for (const row of teamOuRows) {
    if (!row.league_id) continue;
    teamOuByLeague.set(row.league_id, row);
  }

  const profileLeagues = new Set<string>([
    ...Array.from(profileLeagueStats.keys()),
    ...Array.from(teamOuByLeague.keys()),
  ]);

  const profile: TeamOutlookProfileRow[] = Array.from(profileLeagues)
    .map((league) => {
      const gamesStat = profileLeagueStats.get(league) ?? { games: 0, band23: 0 };
      const ou = teamOuByLeague.get(league);
      const bandPct = gamesStat.games > 0 ? formatPct((gamesStat.band23 / gamesStat.games) * 100) : null;
      return {
        leagueId: league,
        games: gamesStat.games,
        gamesWithLine: toInteger(ou?.games_with_line),
        overCount: toInteger(ou?.over_count),
        underCount: toInteger(ou?.under_count),
        pushCount: toInteger(ou?.push_count),
        overRate: toNumber(ou?.over_rate),
        underRate: toNumber(ou?.under_rate),
        avgLine: toNumber(ou?.avg_posted_total),
        avgActual: toNumber(ou?.avg_actual_total),
        band23: gamesStat.band23,
        band23Pct: bandPct,
      };
    })
    .sort((a, b) => b.games - a.games);

  const primaryLeague = (() => {
    const ranked = Array.from(profileLeagueStats.entries()).sort((a, b) => b[1].games - a[1].games);
    const nonCup = ranked.find(([league]) => league !== 'uefa.champions' && league !== 'uefa.europa');
    return nonCup?.[0] ?? ranked[0]?.[0] ?? null;
  })();

  const primaryLeagueGames = completedRows.filter((row) => (row.league_id ?? 'soccer') === primaryLeague);
  const goalDistCounts = new Map<number, number>();
  for (const row of primaryLeagueGames) {
    const total = (row.home_score ?? 0) + (row.away_score ?? 0);
    goalDistCounts.set(total, (goalDistCounts.get(total) ?? 0) + 1);
  }

  const goalDistTotalGames = primaryLeagueGames.length;
  const goalDist: TeamOutlookGoalDistRow[] = Array.from(goalDistCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([total, games]) => ({
      total,
      games,
      pct: goalDistTotalGames > 0 ? formatPct((games / goalDistTotalGames) * 100) : 0,
    }));

  const allGamesCount = completedRows.length;
  const allBand23 = completedRows.reduce((count, row) => {
    const total = (row.home_score ?? 0) + (row.away_score ?? 0);
    return total >= 2 && total <= 3 ? count + 1 : count;
  }, 0);

  const band: TeamOutlookBand = {
    totalGames: allGamesCount,
    band23: allBand23,
    band23Pct: allGamesCount > 0 ? formatPct((allBand23 / allGamesCount) * 100) : null,
  };

  const opponents = Array.from(new Set(upcomingRows.map((row) => {
    const isHome = isTeamSide(row.home_team, teamName, teamSlug);
    return isHome ? row.away_team : row.home_team;
  }).filter((name): name is string => Boolean(name))));

  const opponentLeagues = Array.from(new Set(upcomingRows.map((row) => row.league_id).filter((name): name is string => Boolean(name))));

  const [oppOuResult, oppFormResult] = await Promise.all([
    opponents.length > 0 && opponentLeagues.length > 0
      ? supabase
          .from('mv_team_ou_vs_line')
          .select('team_name,league_id,games_with_line,over_count,under_count,push_count,over_rate,under_rate,avg_posted_total,avg_actual_total')
          .in('team_name', opponents)
          .in('league_id', opponentLeagues)
      : Promise.resolve({ data: [] as OuTrendRow[] }),
    opponents.length > 0 && opponentLeagues.length > 0
      ? supabase
          .from('mv_team_rolling_form')
          .select('team_name,league_id,form_string,wins,draws,losses')
          .in('team_name', opponents)
          .in('league_id', opponentLeagues)
      : Promise.resolve({ data: [] as RollingFormRow[] }),
  ]);

  const oppOuByKey = new Map<string, OuTrendRow>();
  for (const row of ((oppOuResult.data ?? []) as OuTrendRow[])) {
    if (!row.team_name || !row.league_id) continue;
    oppOuByKey.set(`${row.team_name}::${row.league_id}`, row);
  }

  const oppFormByKey = new Map<string, RollingFormRow>();
  for (const row of ((oppFormResult.data ?? []) as RollingFormRow[])) {
    if (!row.team_name || !row.league_id) continue;
    oppFormByKey.set(`${row.team_name}::${row.league_id}`, row);
  }

  const fixtures: TeamOutlookFixtureRow[] = upcomingRows.map((row) => {
    const isHome = isTeamSide(row.home_team, teamName, teamSlug);
    const opponent = isHome ? row.away_team : row.home_team;
    const league = row.league_id ?? 'soccer';
    const key = `${opponent ?? ''}::${league}`;
    const oppOu = oppOuByKey.get(key);
    const oppForm = oppFormByKey.get(key);
    return {
      id: row.id ?? '',
      homeTeam: row.home_team ?? 'Home',
      awayTeam: row.away_team ?? 'Away',
      leagueId: league,
      startTime: row.start_time ?? '',
      venue: isHome ? 'Home' : 'Away',
      opponent: opponent ?? 'Opponent',
      teamEspnId: isHome ? (row.home_team_id ?? null) : (row.away_team_id ?? null),
      opponentEspnId: isHome ? (row.away_team_id ?? null) : (row.home_team_id ?? null),
      oppOverRate: toNumber(oppOu?.over_rate),
      oppUnderRate: toNumber(oppOu?.under_rate),
      oppOuSample: toInteger(oppOu?.games_with_line),
      oppAvgActual: toNumber(oppOu?.avg_actual_total),
      oppForm: toText(oppForm?.form_string),
      oppWins: toNumber(oppForm?.wins),
      oppDraws: toNumber(oppForm?.draws),
      oppLosses: toNumber(oppForm?.losses),
    };
  });

  const freshestMatch = completedRows[0] ?? upcomingRows[0] ?? null;
  const teamEspnId = freshestMatch
    ? isTeamSide(freshestMatch.home_team, teamName, teamSlug)
      ? freshestMatch.home_team_id
      : freshestMatch.away_team_id
    : null;

  return {
    team: teamName,
    teamSlug,
    teamEspnId: teamEspnId ?? null,
    goalDistLeagueId: primaryLeague,
    profile,
    goalDist,
    band,
    fixtures,
  };
};

export const useTeamOutlook = (teamSlug: string, leagueId?: string | null) =>
  useQuery<TeamOutlookData | null>({
    queryKey: ['postgame', 'team-outlook', teamSlug, leagueId ?? 'all'],
    queryFn: async () => {
      if (!teamSlug) return null;

      const teamName = await resolveTeamName(teamSlug, leagueId ?? undefined);
      const { data, error } = await supabase.rpc('get_team_outlook', {
        p_team_name: teamName,
        p_league_id: leagueId ?? null,
      });

      if (error) {
        if (isMissingRpcError(error.message)) {
          return fetchTeamOutlookFallback(teamName, teamSlug, leagueId ?? null);
        }
        throw error;
      }
      return normalizePayload(data, teamName, teamSlug);
    },
    staleTime: FIVE_MIN,
    gcTime: TEN_MIN,
    enabled: Boolean(teamSlug),
    refetchOnWindowFocus: false,
  });
