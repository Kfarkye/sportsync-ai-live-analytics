/**
 * useEnhancedEspn Hook
 * 
 * Client-side hooks for consuming enhanced ESPN API features:
 * - Team injuries
 * - Team rosters  
 * - Team news
 * - Standings
 * - League leaders
 * - Predictor/Win probability
 * - Head-to-head history
 */

import { useQuery } from '@tanstack/react-query';
import { Sport, RankingItem } from '@/types';
import {
    fetchTeamLastFive,
    fetchTeamInjuries,
    fetchTeamRoster,
    fetchTeamNews,
    fetchRankings,
    fetchStandings,
    fetchLeagueLeaders,
    fetchPredictor,
    fetchHeadToHead
} from '../services/espnService';

// ============================================================================
// TEAM RECENT FORM
// ============================================================================

interface UseTeamFormOptions {
    teamId: string;
    sport: Sport;
    leagueId: string;
    enabled?: boolean;
}

export const useTeamForm = ({ teamId, sport, leagueId, enabled = true }: UseTeamFormOptions) => {
    return useQuery({
        queryKey: ['team-form', teamId, leagueId],
        queryFn: () => fetchTeamLastFive(teamId, sport, leagueId),
        enabled: enabled && !!teamId,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
};

// ============================================================================
// TEAM INJURIES
// ============================================================================

export const useTeamInjuries = ({ teamId, sport, leagueId, enabled = true }: UseTeamFormOptions) => {
    return useQuery({
        queryKey: ['team-injuries', teamId, leagueId],
        queryFn: () => fetchTeamInjuries(teamId, sport, leagueId),
        enabled: enabled && !!teamId,
        staleTime: 10 * 60 * 1000, // 10 minutes
    });
};

// ============================================================================
// TEAM ROSTER
// ============================================================================

export const useTeamRoster = ({ teamId, sport, leagueId, enabled = true }: UseTeamFormOptions) => {
    return useQuery({
        queryKey: ['team-roster', teamId, leagueId],
        queryFn: () => fetchTeamRoster(teamId, sport, leagueId),
        enabled: enabled && !!teamId,
        staleTime: 60 * 60 * 1000, // 1 hour (rosters don't change often)
    });
};

// ============================================================================
// TEAM NEWS
// ============================================================================

interface UseTeamNewsOptions extends UseTeamFormOptions {
    limit?: number;
}

export const useTeamNews = ({ teamId, sport, leagueId, limit = 10, enabled = true }: UseTeamNewsOptions) => {
    return useQuery({
        queryKey: ['team-news', teamId, leagueId, limit],
        queryFn: () => fetchTeamNews(teamId, sport, leagueId, limit),
        enabled: enabled && !!teamId,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
};

// ============================================================================
// RANKINGS
// ============================================================================

interface UseRankingsOptions {
    sport: Sport;
    leagueId: string;
    enabled?: boolean;
}

export const useRankings = ({ sport, leagueId, enabled = true }: UseRankingsOptions) => {
    return useQuery<RankingItem[]>({
        queryKey: ['rankings', leagueId],
        queryFn: () => fetchRankings(sport, leagueId),
        enabled,
        staleTime: 30 * 60 * 1000, // 30 minutes
    });
};

// ============================================================================
// STANDINGS
// ============================================================================

export const useStandings = ({ sport, leagueId, enabled = true }: UseRankingsOptions) => {
    return useQuery({
        queryKey: ['standings', leagueId],
        queryFn: () => fetchStandings(sport, leagueId),
        enabled,
        staleTime: 30 * 60 * 1000, // 30 minutes
    });
};

// ============================================================================
// LEAGUE LEADERS
// ============================================================================

interface UseLeagueLeadersOptions extends UseRankingsOptions {
    category?: string;
}

export const useLeagueLeaders = ({ sport, leagueId, category, enabled = true }: UseLeagueLeadersOptions) => {
    return useQuery({
        queryKey: ['league-leaders', leagueId, category],
        queryFn: () => fetchLeagueLeaders(sport, leagueId, category),
        enabled,
        staleTime: 30 * 60 * 1000, // 30 minutes
    });
};

// ============================================================================
// PREDICTOR / WIN PROBABILITY
// ============================================================================

interface UsePredictorOptions {
    matchId: string;
    sport: Sport;
    leagueId: string;
    enabled?: boolean;
}

export const usePredictor = ({ matchId, sport, leagueId, enabled = true }: UsePredictorOptions) => {
    return useQuery({
        queryKey: ['predictor', matchId],
        queryFn: () => fetchPredictor(matchId, sport, leagueId),
        enabled: enabled && !!matchId,
        staleTime: 30 * 1000, // 30 seconds for live data
        refetchInterval: 30 * 1000,
    });
};

// ============================================================================
// HEAD TO HEAD
// ============================================================================

interface UseHeadToHeadOptions {
    team1Id: string;
    team2Id: string;
    sport: Sport;
    leagueId: string;
    limit?: number;
    enabled?: boolean;
}

export const useHeadToHead = ({
    team1Id,
    team2Id,
    sport,
    leagueId,
    limit = 10,
    enabled = true
}: UseHeadToHeadOptions) => {
    return useQuery({
        queryKey: ['h2h', team1Id, team2Id, leagueId],
        queryFn: () => fetchHeadToHead(team1Id, team2Id, sport, leagueId, limit),
        enabled: enabled && !!team1Id && !!team2Id,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
};

// ============================================================================
// COMBINED MATCH CONTEXT HOOK
// ============================================================================

interface UseMatchContextOptions {
    matchId: string;
    homeTeamId: string;
    awayTeamId: string;
    sport: Sport;
    leagueId: string;
    enabled?: boolean;
}

/**
 * Fetches all contextual data for a match in parallel
 */
export const useMatchContext = ({
    matchId,
    homeTeamId,
    awayTeamId,
    sport,
    leagueId,
    enabled = true
}: UseMatchContextOptions) => {
    const homeForm = useTeamForm({ teamId: homeTeamId, sport, leagueId, enabled });
    const awayForm = useTeamForm({ teamId: awayTeamId, sport, leagueId, enabled });
    const homeInjuries = useTeamInjuries({ teamId: homeTeamId, sport, leagueId, enabled });
    const awayInjuries = useTeamInjuries({ teamId: awayTeamId, sport, leagueId, enabled });
    const predictor = usePredictor({ matchId, sport, leagueId, enabled });
    const h2h = useHeadToHead({ team1Id: homeTeamId, team2Id: awayTeamId, sport, leagueId, enabled });

    return {
        homeForm,
        awayForm,
        homeInjuries,
        awayInjuries,
        predictor,
        h2h,
        isLoading: homeForm.isLoading || awayForm.isLoading || homeInjuries.isLoading ||
            awayInjuries.isLoading || predictor.isLoading || h2h.isLoading,
        isError: homeForm.isError || awayForm.isError || homeInjuries.isError ||
            awayInjuries.isError || predictor.isError || h2h.isError,
    };
};
