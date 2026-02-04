/**
 * useEnhancedOdds Hook
 * 
 * Client-side hook for consuming enhanced Odds API features:
 * - Player props
 * - Line shopping
 * - Line movement/historical odds
 * - Alternate lines
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Sport } from '../types';
import type {
    PlayerProp,
    LineMovementPoint,
    OddsApiEvent
} from '../types/odds';
import { LEAGUES } from '../constants';

// ============================================================================
// HELPERS
// ============================================================================

const getOddsKey = (sport: Sport, leagueId?: string): string => {
    if (leagueId) {
        const league = LEAGUES.find(l => l.id === leagueId);
        if (league?.oddsKey) return league.oddsKey;
    }

    const sportLeague = LEAGUES.find(l => l.sport === sport);
    return sportLeague?.oddsKey || 'basketball_nba';
};

// ============================================================================
// PLAYER PROPS HOOK
// ============================================================================

interface UsePlayerPropsOptions {
    sport: Sport;
    eventId: string;
    enabled?: boolean;
}

export const usePlayerProps = ({ sport, eventId, enabled = true }: UsePlayerPropsOptions) => {
    return useQuery({
        queryKey: ['player-props', eventId],
        queryFn: async (): Promise<PlayerProp[]> => {
            if (!isSupabaseConfigured()) return [];

            const { data, error } = await supabase.functions.invoke('get-odds', {
                body: {
                    action: 'player_props',
                    sport: sport.toLowerCase(),
                    eventId,
                }
            });

            if (error) throw error;
            return data?.props || [];
        },
        enabled: enabled && !!eventId,
        staleTime: 60 * 1000, // 1 minute
        gcTime: 5 * 60 * 1000, // 5 minutes
    });
};

// ============================================================================
// ALTERNATE LINES HOOK
// ============================================================================

interface UseAlternateLinesOptions {
    sport: Sport;
    eventId: string;
    enabled?: boolean;
}

export const useAlternateLines = ({ sport, eventId, enabled = true }: UseAlternateLinesOptions) => {
    return useQuery({
        queryKey: ['alternate-lines', eventId],
        queryFn: async () => {
            if (!isSupabaseConfigured()) return null;

            const { data, error } = await supabase.functions.invoke('get-odds', {
                body: {
                    action: 'alternate_lines',
                    sport: sport.toLowerCase(),
                    eventId,
                }
            });

            if (error) throw error;
            return data;
        },
        enabled: enabled && !!eventId,
        staleTime: 60 * 1000,
    });
};

// ============================================================================
// LINE MOVEMENT HOOK
// ============================================================================

interface UseLineMovementOptions {
    sport: Sport;
    eventId: string;
    hoursBack?: number;
    enabled?: boolean;
}

export const useLineMovement = ({
    sport,
    eventId,
    hoursBack = 24,
    enabled = true
}: UseLineMovementOptions) => {
    return useQuery({
        queryKey: ['line-movement', eventId, hoursBack],
        queryFn: async (): Promise<LineMovementPoint[]> => {
            if (!isSupabaseConfigured()) return [];

            const movements: LineMovementPoint[] = [];
            const now = new Date();

            // Sample every 6 hours
            for (let i = hoursBack; i >= 0; i -= 6) {
                const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);

                try {
                    const { data, error } = await supabase.functions.invoke('get-odds', {
                        body: {
                            action: 'historical',
                            sport: sport.toLowerCase(),
                            date: timestamp.toISOString(),
                        }
                    });

                    if (!error && data?.data?.[0]?.bookmakers?.[0]) {
                        const event = data.data.find((e: unknown) => e.id === eventId);
                        if (event?.bookmakers?.[0]) {
                            const book = event.bookmakers[0];
                            const spreads = book.markets.find((m: unknown) => m.key === 'spreads');
                            const totals = book.markets.find((m: unknown) => m.key === 'totals');
                            const h2h = book.markets.find((m: unknown) => m.key === 'h2h');

                            movements.push({
                                timestamp: timestamp.toISOString(),
                                homeSpread: spreads?.outcomes?.[0]?.point || 0,
                                awaySpread: spreads?.outcomes?.[1]?.point || 0,
                                total: totals?.outcomes?.find((o: unknown) => o.name === 'Over')?.point || 0,
                                homeML: h2h?.outcomes?.[0]?.price || 0,
                                awayML: h2h?.outcomes?.[1]?.price || 0,
                                bookmaker: book.title
                            });
                        }
                    }
                } catch (e) {
                    console.warn('Historical data fetch failed for', timestamp);
                }
            }

            return movements;
        },
        enabled: enabled && !!eventId,
        staleTime: 5 * 60 * 1000, // 5 minutes (historical data doesn't change)
    });
};

// ============================================================================
// AVAILABLE MARKETS HOOK
// ============================================================================

interface UseAvailableMarketsOptions {
    sport: Sport;
    eventId: string;
    enabled?: boolean;
}

export const useAvailableMarkets = ({ sport, eventId, enabled = true }: UseAvailableMarketsOptions) => {
    return useQuery({
        queryKey: ['available-markets', eventId],
        queryFn: async () => {
            if (!isSupabaseConfigured()) return null;

            const { data, error } = await supabase.functions.invoke('get-odds', {
                body: {
                    action: 'available_markets',
                    sport: sport.toLowerCase(),
                    eventId,
                }
            });

            if (error) throw error;
            return data;
        },
        enabled: enabled && !!eventId,
        staleTime: 5 * 60 * 1000,
    });
};

// ============================================================================
// ODDS SCORES HOOK (Alternative to ESPN)
// ============================================================================

interface UseOddsScoresOptions {
    sport: Sport;
    leagueId?: string;
    daysFrom?: number;
    enabled?: boolean;
}

export const useOddsScores = ({
    sport,
    leagueId,
    daysFrom = 1,
    enabled = true
}: UseOddsScoresOptions) => {
    const sportKey = getOddsKey(sport, leagueId);

    return useQuery({
        queryKey: ['odds-scores', sportKey, daysFrom],
        queryFn: async () => {
            if (!isSupabaseConfigured()) return [];

            const { data, error } = await supabase.functions.invoke('get-odds', {
                body: {
                    action: 'scores',
                    sport: sportKey,
                    daysFrom,
                }
            });

            if (error) throw error;
            return data || [];
        },
        enabled,
        staleTime: 30 * 1000, // 30 seconds for live scores
        refetchInterval: 30 * 1000,
    });
};

// ============================================================================
// FEATURED ODDS HOOK
// ============================================================================

interface UseFeaturedOddsOptions {
    sport: Sport;
    leagueId?: string;
    regions?: string;
    enabled?: boolean;
}

export const useFeaturedOdds = ({
    sport,
    leagueId,
    regions = 'us,us2',
    enabled = true
}: UseFeaturedOddsOptions) => {
    const sportKey = getOddsKey(sport, leagueId);

    return useQuery({
        queryKey: ['featured-odds', sportKey, regions],
        queryFn: async (): Promise<OddsApiEvent[]> => {
            if (!isSupabaseConfigured()) return [];

            const { data, error } = await supabase.functions.invoke('get-odds', {
                body: {
                    action: 'featured_odds',
                    sport: sportKey,
                    regions,
                }
            });

            if (error) throw error;
            return data || [];
        },
        enabled,
        staleTime: 15 * 1000, // 15 seconds
        refetchInterval: 15 * 1000,
    });
};

// ============================================================================
// FIND EVENT BY TEAMS HOOK
// ============================================================================

interface UseFindEventOptions {
    sport: Sport;
    homeTeam: string;
    awayTeam: string;
    enabled?: boolean;
}

export const useFindEvent = ({ sport, homeTeam, awayTeam, enabled = true }: UseFindEventOptions) => {
    return useQuery({
        queryKey: ['find-event', sport, homeTeam, awayTeam],
        queryFn: async () => {
            if (!isSupabaseConfigured()) return null;

            const { data, error } = await supabase.functions.invoke('get-odds', {
                body: {
                    sport: sport.toLowerCase(),
                    homeTeam,
                    awayTeam,
                }
            });

            if (error) throw error;
            return data;
        },
        enabled: enabled && !!homeTeam && !!awayTeam,
        staleTime: 5 * 60 * 1000,
    });
};
