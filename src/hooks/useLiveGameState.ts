
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getDbMatchId } from '../utils/matchUtils';
import type { LiveMatchState } from '@/types';

export function useLiveGameState(matchId: string | undefined, leagueId?: string) {
    const [state, setState] = useState<LiveMatchState | null>(null);
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
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Network or Parse Error';
                console.error('Network or Parse Error:', err);
                setError(message);
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
                        setState(payload.new as LiveMatchState);
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
