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

      if (error) throw error;
      return normalizePayload(data, teamName, teamSlug);
    },
    staleTime: FIVE_MIN,
    gcTime: TEN_MIN,
    enabled: Boolean(teamSlug),
    refetchOnWindowFocus: false,
  });
