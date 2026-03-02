import { useQuery } from '@tanstack/react-query';
import {
  fetchLeagueMatches,
  fetchMatchBySlug,
  fetchSoccerHub,
  fetchTeamMatches,
  fetchTeamsInLeague,
  type SoccerMatchCard,
  type SoccerMatchDetail,
  type TeamDirectoryItem,
  type TeamPagePayload,
} from '@/lib/postgame';

const FIVE_MIN = 1000 * 60 * 5;
const TEN_MIN = 1000 * 60 * 10;

export const useSoccerHub = () =>
  useQuery({
    queryKey: ['postgame', 'hub'],
    queryFn: fetchSoccerHub,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN,
    refetchOnWindowFocus: false,
  });

export const useLeagueMatches = (leagueId: string) =>
  useQuery<SoccerMatchCard[]>({
    queryKey: ['postgame', 'league', leagueId],
    queryFn: () => fetchLeagueMatches(leagueId),
    staleTime: FIVE_MIN,
    gcTime: TEN_MIN,
    enabled: Boolean(leagueId),
    refetchOnWindowFocus: false,
  });

export const useTeamsInLeague = (leagueId: string) =>
  useQuery<TeamDirectoryItem[]>({
    queryKey: ['postgame', 'league', leagueId, 'teams'],
    queryFn: () => fetchTeamsInLeague(leagueId),
    staleTime: TEN_MIN,
    gcTime: TEN_MIN,
    enabled: Boolean(leagueId),
    refetchOnWindowFocus: false,
  });

export const useMatchBySlug = (slug: string) =>
  useQuery<SoccerMatchDetail | null>({
    queryKey: ['postgame', 'match', slug],
    queryFn: () => fetchMatchBySlug(slug),
    staleTime: FIVE_MIN,
    gcTime: TEN_MIN,
    enabled: Boolean(slug),
    refetchOnWindowFocus: false,
  });

export const useTeamPage = (teamSlug: string, leagueId?: string | null) =>
  useQuery<TeamPagePayload | null>({
    queryKey: ['postgame', 'team', teamSlug, leagueId ?? 'all'],
    queryFn: () => fetchTeamMatches(teamSlug, leagueId ?? undefined),
    staleTime: FIVE_MIN,
    gcTime: TEN_MIN,
    enabled: Boolean(teamSlug),
    refetchOnWindowFocus: false,
  });
