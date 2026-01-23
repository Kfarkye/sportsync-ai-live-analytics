
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getDbMatchId } from '../utils/matchUtils';

export interface LiveGameState {
    id: string;
    league_id: string;
    sport: string;
    game_status: string;
    period: number;
    clock: string;
    home_score: number;
    away_score: number;
    situation: any;
    last_play: any;
    current_drive: any;
    deterministic_signals: any;
    ai_analysis: any;
    opening_odds?: any;
    odds?: {
        current?: any;
        opening?: any;
    };
    updated_at: string;
}

export function useLiveGameState(matchId: string | undefined, leagueId?: string) {
    const [state, setState] = useState<LiveGameState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const normalizedId = matchId ? (leagueId ? getDbMatchId(matchId, leagueId) : matchId) : undefined;

    useEffect(() => {
        if (!normalizedId) {
            setState(null);
            setLoading(false);
            return;
        }

        // Reset state immediately on ID change to prevent cross-game leakage
        setState(null);
        setLoading(true);
        setError(null);
        const fetchInitialState = async () => {
            try {
                setLoading(true);
                const { data, error: fetchError } = await supabase
                    .from('live_game_state')
                    .select('*')
                    .eq('id', normalizedId)
                    .maybeSingle(); // Hardened: returns null instead of 406/PGRST116 if row is missing

                if (fetchError) {
                    console.error('Error fetching live game state:', fetchError);
                    setError(fetchError.message);
                } else {
                    setState(data);
                }
            } catch (err: any) {
                console.error('Network or Parse Error:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchInitialState();

        // 2. Real-time Subscription
        const channel = supabase
            .channel(`live_game_state:${normalizedId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'live_game_state',
                    filter: `id=eq.${normalizedId}`
                },
                (payload) => {
                    if (payload.new) {
                        setState(payload.new as LiveGameState);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [normalizedId]);

    return { state, loading, error };
}
