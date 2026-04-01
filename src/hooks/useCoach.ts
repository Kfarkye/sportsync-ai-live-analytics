import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Sport } from '@/types';

interface Coach {
    id: string;
    team_id: string;
    team_name: string;
    team_abbrev: string;
    coach_name: string;
    sport: string;
    league_id: string;
}

/**
 * Hook to fetch coach data for a team
 * Ground truth data - simple lookup, cached aggressively
 */
export const useCoach = (teamId: string, sport: Sport) => {
    const sportKey = sport.toUpperCase();

    return useQuery<Coach | null>({
        queryKey: ['coach', teamId, sportKey],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('coaches')
                .select('*')
                .eq('team_id', teamId)
                .eq('sport', sportKey)
                .maybeSingle();

            if (error) {
                console.warn('[useCoach] Error fetching coach:', error);
                return null;
            }

            return data;
        },
        staleTime: 1000 * 60 * 60 * 24, // 24 hours - coaches rarely change
        gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days cache
        enabled: !!teamId && !!sport,
    });
};

/**
 * Hook to fetch coaches for both teams in a matchup
 * Returns { homeCoach, awayCoach }
 */
export const useMatchupCoaches = (
    homeTeamId: string,
    awayTeamId: string,
    sport: Sport
) => {
    const sportKey = sport.toUpperCase();

    return useQuery<{ homeCoach: Coach | null; awayCoach: Coach | null }>({
        queryKey: ['matchup-coaches', homeTeamId, awayTeamId, sportKey],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('coaches')
                .select('*')
                .eq('sport', sportKey)
                .in('team_id', [homeTeamId, awayTeamId]);

            if (error) {
                console.warn('[useMatchupCoaches] Error:', error);
                return { homeCoach: null, awayCoach: null };
            }

            const homeCoach = data?.find(c => c.team_id === homeTeamId) || null;
            const awayCoach = data?.find(c => c.team_id === awayTeamId) || null;

            return { homeCoach, awayCoach };
        },
        staleTime: 1000 * 60 * 60 * 24, // 24 hours
        gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days
        enabled: !!homeTeamId && !!awayTeamId && !!sport,
    });
};

export type { Coach };
