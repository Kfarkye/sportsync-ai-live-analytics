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
    opponent?: string;
    match_id?: string;
    bet_type: string;
    line_value: number;
    odds_american: number;
    side: string;
    headshot_url: string;
    event_date: string;
    league: string;
    prop_slug?: string;
    player_slug?: string;
    detail_url?: string;
    context_tags: string[];
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

type PropRowSource = Record<string, unknown>;

const firstString = (row: PropRowSource, keys: string[]): string | undefined => {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return undefined;
};

const firstNumber = (row: PropRowSource, keys: string[]): number | undefined => {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return undefined;
};

const formatSigned = (value: number, digits = 1): string => {
    const rounded = Number(value.toFixed(digits));
    return rounded > 0 ? `+${rounded}` : `${rounded}`;
};

const buildContextTags = (row: PropRowSource): string[] => {
    const tags: string[] = [];

    const restDays = firstNumber(row, ['rest_days', 'days_rest', 'team_rest_days']);
    if (restDays !== undefined) {
        tags.push(`${Math.round(restDays)} rest day${Math.round(restDays) === 1 ? '' : 's'}`);
    }

    const oppDefDelta = firstNumber(row, ['opp_l5_def_delta', 'opponent_l5_def_delta', 'opp_vs_pos_delta']);
    if (oppDefDelta !== undefined) {
        tags.push(`Opp L5 ${formatSigned(oppDefDelta)} vs ${String(row.bet_type || 'stat').toUpperCase()}`);
    }

    const paceDelta = firstNumber(row, ['pace_delta', 'pace_matchup_delta', 'expected_pace_delta']);
    if (paceDelta !== undefined) {
        const direction = paceDelta > 0 ? 'Fast' : paceDelta < 0 ? 'Slow' : 'Neutral';
        tags.push(`${direction} pace ${Math.abs(paceDelta).toFixed(1)}`);
    }

    const injury = firstString(row, ['injury_context', 'usage_context', 'lineup_context']);
    if (injury) {
        tags.push(injury.length > 34 ? `${injury.slice(0, 33)}…` : injury);
    }

    return tags.slice(0, 3);
};

export function useFeaturedProps(limit = 4) {
    return useQuery<FeaturedProp[]>({
        queryKey: ['featured-props', limit],
        queryFn: async () => {
            if (!isSupabaseConfigured()) return [];

            // Fetch upcoming props with headshots, prioritizing star players (highest lines)
            const { data, error } = await supabase
                .from('player_prop_bets')
                .select('*')
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

            for (const raw of data as PropRowSource[]) {
                if (curated.length >= limit) break;
                const playerName = firstString(raw, ['player_name', 'playerName']);
                if (!playerName || seen.has(playerName)) continue;

                const team = firstString(raw, ['team']) || 'TBD';
                const eventDate = firstString(raw, ['event_date', 'eventDate']) || new Date().toISOString().split('T')[0];
                const betType = firstString(raw, ['bet_type', 'betType']) || 'points';
                const side = firstString(raw, ['side']) || 'over';
                const headshot = firstString(raw, ['headshot_url', 'headshotUrl']) || '';
                const lineValue = firstNumber(raw, ['line_value', 'lineValue']) ?? 0;
                const oddsAmerican = firstNumber(raw, ['odds_american', 'oddsAmerican']) ?? 0;
                const league = firstString(raw, ['league', 'league_id']) || 'unknown';

                seen.add(playerName);
                curated.push({
                    player_name: playerName,
                    team,
                    opponent: firstString(raw, ['opponent']),
                    match_id: firstString(raw, ['match_id', 'matchId']),
                    bet_type: betType,
                    line_value: lineValue,
                    odds_american: oddsAmerican,
                    side,
                    headshot_url: headshot,
                    event_date: eventDate,
                    league,
                    prop_slug: firstString(raw, ['prop_slug', 'propSlug']),
                    player_slug: firstString(raw, ['player_slug', 'playerSlug']),
                    detail_url: firstString(raw, ['detail_url', 'deep_link']),
                    context_tags: buildContextTags(raw),
                });
            }

            return curated;
        },
        enabled: isSupabaseConfigured(),
        staleTime: 5 * 60_000,       // 5 min
        refetchInterval: 10 * 60_000, // 10 min
    });
}

export default useFeaturedProps;
