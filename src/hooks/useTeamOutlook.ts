import { useQuery } from '@tanstack/react-query';
import { slugifyTeam } from '@/lib/postgamePages';
import { supabase } from '@/lib/supabase';

const FIVE_MIN = 1000 * 60 * 5;
const TEN_MIN = 1000 * 60 * 10;
const FINAL_STATUSES = new Set(['STATUS_FINAL', 'STATUS_FULL_TIME']);
const INACTIVE_UPCOMING_STATUSES = new Set(['STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_CANCELED', 'STATUS_POSTPONED']);
const CUP_LEAGUES = new Set(['uefa.champions', 'uefa.europa']);

const LEAGUE_ALIASES: Record<string, string[]> = {
  'eng.1': ['eng.1', 'epl'],
  'esp.1': ['esp.1', 'laliga'],
  'ita.1': ['ita.1', 'seriea'],
  'ger.1': ['ger.1', 'bundesliga'],
  'fra.1': ['fra.1', 'ligue1'],
  'usa.1': ['usa.1', 'mls'],
  'uefa.champions': ['uefa.champions', 'ucl'],
  'uefa.europa': ['uefa.europa', 'uel'],
};

const LEAGUE_CANONICAL_LOOKUP = (() => {
  const lookup = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(LEAGUE_ALIASES)) {
    lookup.set(canonical, canonical);
    for (const alias of aliases) {
      lookup.set(alias, canonical);
    }
  }
  return lookup;
})();

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

const toCount = (value: unknown): number => Math.max(0, toInteger(value));

const toText = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

const toObjectArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is UnknownRecord => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    : [];

const roundPct = (value: number): number => Math.round(value * 10) / 10;

const clampPct = (value: number | null): number | null => {
  if (value === null || Number.isNaN(value)) return null;
  return roundPct(Math.max(0, Math.min(100, value)));
};

const sanitizeLikeToken = (input: string): string =>
  input.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

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

const normalizeLeagueId = (leagueId: string | null | undefined): string => {
  if (!leagueId) return 'soccer';
  const normalized = leagueId.trim().toLowerCase();
  return LEAGUE_CANONICAL_LOOKUP.get(normalized) ?? normalized;
};

const leagueScope = (leagueId: string | null | undefined): string[] => {
  if (!leagueId) return [];
  const canonical = normalizeLeagueId(leagueId);
  const aliases = LEAGUE_ALIASES[canonical] ?? [canonical];
  return Array.from(new Set([canonical, ...aliases]));
};

const sortByStartAsc = (a: MatchRow, b: MatchRow): number => {
  const left = a.start_time ? new Date(a.start_time).getTime() : 0;
  const right = b.start_time ? new Date(b.start_time).getTime() : 0;
  return left - right;
};

const sortByStartDesc = (a: MatchRow, b: MatchRow): number => -sortByStartAsc(a, b);

const eventKeyFromId = (id: string | null): string | null => {
  if (!id) return null;
  const base = id.split('_')[0] ?? '';
  if (/^\d+$/.test(base)) return base;
  return id;
};

const matchDedupeKey = (row: MatchRow): string => {
  const league = normalizeLeagueId(row.league_id);
  const eventKey = eventKeyFromId(row.id);
  if (eventKey) return `${league}::${eventKey}`;

  const date = row.start_time ? row.start_time.slice(0, 10) : 'nodate';
  const home = (row.home_team ?? 'home').trim().toLowerCase();
  const away = (row.away_team ?? 'away').trim().toLowerCase();
  return `${league}::${date}::${home}::${away}`;
};

const rowCompletenessScore = (row: MatchRow): number => {
  let score = 0;
  if (row.home_score !== null) score += 5;
  if (row.away_score !== null) score += 5;
  if (row.id) score += 2;
  if (row.home_team_id || row.away_team_id) score += 2;
  if (row.start_time) score += 1;
  return score;
};

const dedupeMatches = (rows: MatchRow[]): MatchRow[] => {
  const map = new Map<string, MatchRow>();

  for (const row of rows) {
    const key = matchDedupeKey(row);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }

    const existingScore = rowCompletenessScore(existing);
    const incomingScore = rowCompletenessScore(row);
    if (incomingScore > existingScore) {
      map.set(key, row);
      continue;
    }
    if (incomingScore < existingScore) continue;

    if (sortByStartDesc(row, existing) < 0) continue;
    map.set(key, row);
  }

  return Array.from(map.values());
};

const isTeamSide = (name: string | null | undefined, teamName: string, teamSlug: string): boolean => {
  if (!name) return false;
  return name === teamName || slugifyTeam(name) === teamSlug;
};

const chooseBestOuRow = (current: OuTrendRow | undefined, incoming: OuTrendRow): OuTrendRow => {
  if (!current) return incoming;
  const currentGames = toCount(current.games_with_line);
  const incomingGames = toCount(incoming.games_with_line);
  if (incomingGames > currentGames) return incoming;
  if (incomingGames < currentGames) return current;

  const currentPush = toCount(current.push_count);
  const incomingPush = toCount(incoming.push_count);
  if (incomingPush !== currentPush) {
    return incomingPush < currentPush ? incoming : current;
  }

  return current;
};

const resolveTeamName = async (teamSlug: string, leagueId?: string | null): Promise<string> => {
  const search = sanitizeLikeToken(teamSlug.replace(/-/g, ' '));
  if (!search) return humanizeTeamSlug(teamSlug);

  let query = supabase
    .from('matches')
    .select('home_team, away_team, league_id')
    .or(`home_team.ilike.%${search}%,away_team.ilike.%${search}%`)
    .order('start_time', { ascending: false })
    .limit(300);

  const scope = leagueScope(leagueId);
  if (scope.length > 0) {
    query = query.in('league_id', scope);
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
    if (slugifyTeam(candidate) === teamSlug) return candidate;
  }

  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? humanizeTeamSlug(teamSlug);
};

const normalizePayload = (raw: unknown, teamName: string, teamSlug: string): TeamOutlookData => {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as UnknownRecord;

  const profileMap = new Map<string, TeamOutlookProfileRow>();
  for (const row of toObjectArray(payload.profile)) {
    const league = normalizeLeagueId(toText(row.league_id));
    const next: TeamOutlookProfileRow = {
      leagueId: league,
      games: toCount(row.games),
      gamesWithLine: toCount(row.games_with_line),
      overCount: toCount(row.over_count),
      underCount: toCount(row.under_count),
      pushCount: toCount(row.push_count),
      overRate: clampPct(toNumber(row.over_rate)),
      underRate: clampPct(toNumber(row.under_rate)),
      avgLine: toNumber(row.avg_line),
      avgActual: toNumber(row.avg_actual),
      band23: toCount(row.band_23),
      band23Pct: clampPct(toNumber(row.band_23_pct)),
    };

    const existing = profileMap.get(league);
    if (!existing) {
      profileMap.set(league, next);
      continue;
    }

    const existingScore = existing.gamesWithLine * 10 + existing.games;
    const nextScore = next.gamesWithLine * 10 + next.games;
    if (nextScore > existingScore) {
      profileMap.set(league, next);
    }
  }

  const profile = Array.from(profileMap.values()).sort((a, b) => b.games - a.games);

  const goalDist = toObjectArray(payload.goal_dist)
    .map((row) => ({
      total: toText(row.total) ?? '0',
      games: toCount(row.games),
      pct: clampPct(toNumber(row.pct)) ?? 0,
    }))
    .sort((a, b) => Number(a.total) - Number(b.total));

  const bandRaw = (payload.band && typeof payload.band === 'object' ? payload.band : {}) as UnknownRecord;
  const band: TeamOutlookBand = {
    totalGames: toCount(bandRaw.total_games),
    band23: toCount(bandRaw.band_23),
    band23Pct: clampPct(toNumber(bandRaw.band_23_pct)),
  };

  const fixtureRows = toObjectArray(payload.fixtures).map((row) => ({
    id: toText(row.id) ?? '',
    homeTeam: toText(row.home_team) ?? 'Home',
    awayTeam: toText(row.away_team) ?? 'Away',
    leagueId: normalizeLeagueId(toText(row.league_id)),
    startTime: toText(row.start_time) ?? '',
    venue: (toText(row.venue) === 'Home' ? 'Home' : 'Away') as 'Home' | 'Away',
    opponent: toText(row.opponent) ?? 'Opponent',
    teamEspnId: toText(row.team_espn_id),
    opponentEspnId: toText(row.opponent_espn_id),
    oppOverRate: clampPct(toNumber(row.opp_over_rate)),
    oppUnderRate: clampPct(toNumber(row.opp_under_rate)),
    oppOuSample: toCount(row.opp_ou_sample),
    oppAvgActual: toNumber(row.opp_avg_actual),
    oppForm: toText(row.opp_form),
    oppWins: toNumber(row.opp_w),
    oppDraws: toNumber(row.opp_d),
    oppLosses: toNumber(row.opp_l),
  }));

  const fixtures = dedupeMatches(
    fixtureRows.map((row) => ({
      id: row.id,
      home_team: row.homeTeam,
      away_team: row.awayTeam,
      home_team_id: row.venue === 'Home' ? row.teamEspnId : row.opponentEspnId,
      away_team_id: row.venue === 'Home' ? row.opponentEspnId : row.teamEspnId,
      league_id: row.leagueId,
      start_time: row.startTime,
      status: null,
      home_score: null,
      away_score: null,
    })),
  )
    .map((deduped) => fixtureRows.find((row) => row.id === deduped.id))
    .filter((row): row is TeamOutlookFixtureRow => Boolean(row))
    .sort((a, b) => {
      const left = a.startTime ? new Date(a.startTime).getTime() : 0;
      const right = b.startTime ? new Date(b.startTime).getTime() : 0;
      return left - right;
    });

  return {
    team: toText(payload.team) ?? teamName,
    teamSlug,
    teamEspnId: toText(payload.team_espn_id),
    goalDistLeagueId: normalizeLeagueId(toText(payload.goal_dist_league_id)),
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

const fetchTeamOutlookFallback = async (
  teamName: string,
  teamSlug: string,
  leagueId?: string | null,
): Promise<TeamOutlookData> => {
  const scope = leagueScope(leagueId);

  let completedQuery = supabase
    .from('matches')
    .select('id,home_team,away_team,home_team_id,away_team_id,league_id,start_time,status,home_score,away_score')
    .or(`home_team.eq.${teamName},away_team.eq.${teamName}`)
    .in('status', Array.from(FINAL_STATUSES))
    .not('home_score', 'is', null)
    .not('away_score', 'is', null)
    .order('start_time', { ascending: false })
    .limit(600);

  let upcomingQuery = supabase
    .from('matches')
    .select('id,home_team,away_team,home_team_id,away_team_id,league_id,start_time,status,home_score,away_score')
    .or(`home_team.eq.${teamName},away_team.eq.${teamName}`)
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(100);

  let teamOuQuery = supabase
    .from('mv_team_ou_vs_line')
    .select('team_name,league_id,games_with_line,over_count,under_count,push_count,over_rate,under_rate,avg_posted_total,avg_actual_total')
    .eq('team_name', teamName);

  if (scope.length > 0) {
    completedQuery = completedQuery.in('league_id', scope);
    upcomingQuery = upcomingQuery.in('league_id', scope);
    teamOuQuery = teamOuQuery.in('league_id', scope);
  }

  const [{ data: completedRowsRaw }, { data: upcomingRowsRaw }, { data: teamOuRaw }] = await Promise.all([
    completedQuery,
    upcomingQuery,
    teamOuQuery,
  ]);

  const completedRows = dedupeMatches(((completedRowsRaw ?? []) as MatchRow[])).sort(sortByStartDesc);
  const upcomingRows = dedupeMatches(((upcomingRowsRaw ?? []) as MatchRow[]))
    .filter((row) => !INACTIVE_UPCOMING_STATUSES.has(row.status ?? ''))
    .sort(sortByStartAsc)
    .slice(0, 5);

  const teamOuByLeague = new Map<string, OuTrendRow>();
  for (const row of ((teamOuRaw ?? []) as OuTrendRow[])) {
    const team = row.team_name;
    if (!team || team !== teamName) continue;
    const league = normalizeLeagueId(row.league_id);
    teamOuByLeague.set(league, chooseBestOuRow(teamOuByLeague.get(league), row));
  }

  const profileLeagueStats = new Map<string, { games: number; band23: number }>();
  for (const row of completedRows) {
    const league = normalizeLeagueId(row.league_id);
    const total = (row.home_score ?? 0) + (row.away_score ?? 0);
    const current = profileLeagueStats.get(league) ?? { games: 0, band23: 0 };
    current.games += 1;
    if (total >= 2 && total <= 3) current.band23 += 1;
    profileLeagueStats.set(league, current);
  }

  const profileLeagues = new Set<string>([
    ...Array.from(profileLeagueStats.keys()),
    ...Array.from(teamOuByLeague.keys()),
  ]);

  const profile: TeamOutlookProfileRow[] = Array.from(profileLeagues)
    .map((league) => {
      const aggregate = profileLeagueStats.get(league) ?? { games: 0, band23: 0 };
      const trend = teamOuByLeague.get(league);
      const bandPct = aggregate.games > 0 ? roundPct((aggregate.band23 / aggregate.games) * 100) : null;

      return {
        leagueId: league,
        games: aggregate.games,
        gamesWithLine: toCount(trend?.games_with_line),
        overCount: toCount(trend?.over_count),
        underCount: toCount(trend?.under_count),
        pushCount: toCount(trend?.push_count),
        overRate: clampPct(toNumber(trend?.over_rate)),
        underRate: clampPct(toNumber(trend?.under_rate)),
        avgLine: toNumber(trend?.avg_posted_total),
        avgActual: toNumber(trend?.avg_actual_total),
        band23: aggregate.band23,
        band23Pct: bandPct,
      };
    })
    .sort((a, b) => b.games - a.games);

  const primaryLeague = (() => {
    const ranked = Array.from(profileLeagueStats.entries()).sort((a, b) => b[1].games - a[1].games);
    const nonCup = ranked.find(([league]) => !CUP_LEAGUES.has(league));
    return nonCup?.[0] ?? ranked[0]?.[0] ?? null;
  })();

  const primaryLeagueGames = completedRows.filter((row) => normalizeLeagueId(row.league_id) === primaryLeague);
  const goalDistCounts = new Map<number, number>();
  for (const row of primaryLeagueGames) {
    const total = (row.home_score ?? 0) + (row.away_score ?? 0);
    goalDistCounts.set(total, (goalDistCounts.get(total) ?? 0) + 1);
  }

  const primaryTotalGames = primaryLeagueGames.length;
  const goalDist: TeamOutlookGoalDistRow[] = Array.from(goalDistCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([total, games]) => ({
      total,
      games,
      pct: primaryTotalGames > 0 ? roundPct((games / primaryTotalGames) * 100) : 0,
    }));

  const allGamesCount = completedRows.length;
  const allBand23 = completedRows.reduce((count, row) => {
    const total = (row.home_score ?? 0) + (row.away_score ?? 0);
    return total >= 2 && total <= 3 ? count + 1 : count;
  }, 0);

  const band: TeamOutlookBand = {
    totalGames: allGamesCount,
    band23: allBand23,
    band23Pct: allGamesCount > 0 ? roundPct((allBand23 / allGamesCount) * 100) : null,
  };

  const opponents = Array.from(
    new Set(
      upcomingRows
        .map((row) => {
          const isHome = isTeamSide(row.home_team, teamName, teamSlug);
          return isHome ? row.away_team : row.home_team;
        })
        .filter((name): name is string => Boolean(name)),
    ),
  );

  const upcomingLeagues = Array.from(
    new Set(upcomingRows.map((row) => normalizeLeagueId(row.league_id))),
  );
  const opponentLeagueScope = Array.from(new Set(upcomingLeagues.flatMap((league) => leagueScope(league))));

  const [oppOuResult, oppFormResult] = await Promise.all([
    opponents.length > 0 && opponentLeagueScope.length > 0
      ? supabase
          .from('mv_team_ou_vs_line')
          .select('team_name,league_id,games_with_line,over_count,under_count,push_count,over_rate,under_rate,avg_posted_total,avg_actual_total')
          .in('team_name', opponents)
          .in('league_id', opponentLeagueScope)
      : Promise.resolve({ data: [] as OuTrendRow[] }),
    opponents.length > 0 && opponentLeagueScope.length > 0
      ? supabase
          .from('mv_team_rolling_form')
          .select('team_name,league_id,form_string,wins,draws,losses')
          .in('team_name', opponents)
          .in('league_id', opponentLeagueScope)
      : Promise.resolve({ data: [] as RollingFormRow[] }),
  ]);

  const oppOuByKey = new Map<string, OuTrendRow>();
  for (const row of ((oppOuResult.data ?? []) as OuTrendRow[])) {
    if (!row.team_name || !row.league_id) continue;
    const key = `${row.team_name}::${normalizeLeagueId(row.league_id)}`;
    oppOuByKey.set(key, chooseBestOuRow(oppOuByKey.get(key), row));
  }

  const oppFormByKey = new Map<string, RollingFormRow>();
  for (const row of ((oppFormResult.data ?? []) as RollingFormRow[])) {
    if (!row.team_name || !row.league_id) continue;
    const key = `${row.team_name}::${normalizeLeagueId(row.league_id)}`;
    const existing = oppFormByKey.get(key);
    if (!existing) {
      oppFormByKey.set(key, row);
      continue;
    }
    const existingMatches = toCount(existing.wins) + toCount(existing.draws) + toCount(existing.losses);
    const incomingMatches = toCount(row.wins) + toCount(row.draws) + toCount(row.losses);
    if (incomingMatches > existingMatches) {
      oppFormByKey.set(key, row);
    }
  }

  const fixtures: TeamOutlookFixtureRow[] = upcomingRows.map((row) => {
    const league = normalizeLeagueId(row.league_id);
    const isHome = isTeamSide(row.home_team, teamName, teamSlug);
    const opponent = isHome ? row.away_team : row.home_team;
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
      oppOverRate: clampPct(toNumber(oppOu?.over_rate)),
      oppUnderRate: clampPct(toNumber(oppOu?.under_rate)),
      oppOuSample: toCount(oppOu?.games_with_line),
      oppAvgActual: toNumber(oppOu?.avg_actual_total),
      oppForm: toText(oppForm?.form_string),
      oppWins: toNumber(oppForm?.wins),
      oppDraws: toNumber(oppForm?.draws),
      oppLosses: toNumber(oppForm?.losses),
    };
  });

  const freshest = completedRows[0] ?? upcomingRows[0] ?? null;
  const teamEspnId = freshest
    ? isTeamSide(freshest.home_team, teamName, teamSlug)
      ? freshest.home_team_id
      : freshest.away_team_id
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
    queryKey: ['postgame', 'team-outlook', teamSlug, leagueId ? normalizeLeagueId(leagueId) : 'all'],
    queryFn: async () => {
      if (!teamSlug) return null;

      const resolvedLeague = leagueId ? normalizeLeagueId(leagueId) : null;
      const resolvedLeagueScope = leagueScope(leagueId);
      const teamName = await resolveTeamName(teamSlug, resolvedLeague);
      const { data, error } = await supabase.rpc('get_team_outlook', {
        p_team_name: teamName,
        p_league_id: resolvedLeagueScope.length > 0 ? resolvedLeague : null,
      });

      if (error) {
        if (isMissingRpcError(error.message)) {
          return fetchTeamOutlookFallback(teamName, teamSlug, resolvedLeagueScope.length > 0 ? resolvedLeague : null);
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
