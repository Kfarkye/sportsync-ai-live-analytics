import { useQuery } from '@tanstack/react-query';
import { fetchTeamHistoryRows, type TeamSeasonRow } from '@/lib/postgamePages';

const FIVE_MIN = 1000 * 60 * 5;
const TEN_MIN = 1000 * 60 * 10;

export const useTeamHistory = (teamSlug: string, leagueId?: string | null) =>
  useQuery<TeamSeasonRow[]>({
    queryKey: ['postgame', 'team-history', teamSlug, leagueId ?? 'all'],
    queryFn: () => fetchTeamHistoryRows(teamSlug, leagueId ?? undefined),
    staleTime: FIVE_MIN,
    gcTime: TEN_MIN,
    enabled: Boolean(teamSlug),
    refetchOnWindowFocus: false,
  });
