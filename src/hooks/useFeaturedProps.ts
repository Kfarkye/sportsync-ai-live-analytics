/**
 * useFeaturedProps — Featured player props for sidebar widget
 *
 * Fetches upcoming player props with ESPN headshots from player_prop_bets.
 * Curates a visually premium selection: distinct players, varied stat types.
 * Falls back gracefully — returns empty array if no data.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface FeaturedProp {
    player_name: string;
    team: string;
    bet_type: string;
    line_value: number;
    odds_american: number;
    side: string;
    headshot_url: string;
    event_date: string;
    league: string;
}

/** Human-readable stat labels */
export const STAT_LABELS: Record<string, string> = {
    points: 'PTS',
    rebounds: 'REB',
    assists: 'AST',
    threes_made: '3PM',
    steals: 'STL',
    blocks: 'BLK',
    pra: 'PRA',
    pts_rebs: 'P+R',
    pts_asts: 'P+A',
    rebs_asts: 'R+A',
    turnovers: 'TO',
    double_double: 'DD',
    triple_double: 'TD',
};

export function useFeaturedProps(limit = 4) {
    return useQuery<FeaturedProp[]>({
        queryKey: ['featured-props', limit],
        queryFn: async () => {
            if (!isSupabaseConfigured()) return [];

            // Fetch upcoming props with headshots, prioritizing star players (highest lines)
            const { data, error } = await supabase
                .from('player_prop_bets')
                .select('player_name, team, bet_type, line_value, odds_american, side, headshot_url, event_date, league')
                .gte('event_date', new Date().toISOString().split('T')[0])
                .not('headshot_url', 'is', null)
                .in('bet_type', ['points', 'rebounds', 'assists', 'threes_made', 'pra', 'steals', 'blocks'])
                .in('side', ['over'])  // Overs are more engaging visually
                .order('event_date', { ascending: true })
                .order('line_value', { ascending: false })  // Highest lines = biggest names
                .limit(80);  // Fetch enough to deduplicate

            if (error || !data) return [];

            // Curate: unique players, prefer highest lines (star power)
            const seen = new Set<string>();
            const curated: FeaturedProp[] = [];

            for (const row of data) {
                if (curated.length >= limit) break;
                if (seen.has(row.player_name)) continue;
                seen.add(row.player_name);
                curated.push(row as FeaturedProp);
            }

            return curated;
        },
        enabled: isSupabaseConfigured(),
        staleTime: 5 * 60_000,       // 5 min
        refetchInterval: 10 * 60_000, // 10 min
    });
}

export default useFeaturedProps;
